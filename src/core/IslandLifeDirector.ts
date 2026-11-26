import { createAmbientLifePlan, findAmbientPath, isAmbientFootSupported,
  isAmbientSegmentSafe, nearestAmbientNode, type AmbientActivity, type AmbientLifePlan,
  type AmbientResidentDefinition, type AmbientResidentState, type IslandData,
  type Vec2, type Vec3 } from '../world';

export type IslandLifeEvent = 'bleat' | 'headbutt' | 'chaos';
export interface IslandLifeObstacle { position: Vec3; radius: number; height?: number }
export interface IslandLifeContext {
  time: number;
  phase: number;
  rain: number;
  tideLevel: number;
  player: { position: Vec3; radius: number };
  enabled: boolean;
  /** Nearby live bodies supplied by the integrator; original authored footprints
   * remain reserved even if their movable props have rolled elsewhere. */
  obstacles?: readonly IslandLifeObstacle[];
}
type Routine = 'day' | 'shelter' | 'night';
interface Resident {
  definition: AmbientResidentDefinition;
  state: AmbientResidentState;
  route: number[];
  routeIndex: number;
  station: number;
  cycle: number;
  dwellUntil: number;
  cooldownUntil: number;
  reactionAt: number;
  reactionKind: IslandLifeEvent | undefined;
  lookAt: Vec3;
  routine: Routine;
  detour: Vec3 | undefined;
  yieldUntil: number;
  nextYield: number;
  fleePrepared: boolean;
  reroute: boolean;
}

const turnDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
function turn(state: AmbientResidentState, target: number, dt: number, rate = 2.8): number {
  const delta = turnDelta(state.yaw, target);
  state.yaw += Math.max(-rate * dt, Math.min(rate * dt, delta));
  state.yaw = Math.atan2(Math.sin(state.yaw), Math.cos(state.yaw));
  return Math.abs(turnDelta(state.yaw, target));
}
/** A straight retreat must not initially head toward the incident, even if its
 * endpoint would eventually be farther away. This also constrains yield detours. */
function movesTowardIncident(source: Vec2, from: Vec2, to: Vec2): boolean {
  return (from.x - source.x) * (to.x - from.x) + (from.z - source.z) * (to.z - from.z) < 0;
}
function pointSegmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z, squared = dx * dx + dz * dz;
  const t = squared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / squared)) : 0;
  return Math.hypot(a.x + dx * t - point.x, a.z + dz * t - point.z);
}

function blocksMovement(point: Vec2, from: Vec2, to: Vec2, clearance: number): boolean {
  const distance = Math.hypot(point.x - from.x, point.z - from.z);
  // A resident already beside an obstacle is allowed to move out of it.
  return !(distance < clearance && Math.hypot(point.x - to.x, point.z - to.z) > distance + 1e-7) &&
    pointSegmentDistance(point, from, to) < clearance;
}

/** Fixed-simulation-time, bounded ambient activity. This class owns neither
 * Rapier bodies, currencies, save state, input sampling nor render resources. */
export class IslandLifeDirector {
  readonly plan: AmbientLifePlan;
  readonly residents: readonly AmbientResidentState[];
  private readonly actors: Resident[];
  private readonly grid: Int32Array;
  private readonly next: Int32Array;
  private readonly gridWidth: number;
  private readonly gridDepth: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly cell: number;
  private readonly proposed: Vec3 = { x: 0, y: 0, z: 0 };
  private enabled = true;
  private sheltered = false;
  private lastEvent = -Infinity;
  private lastEventPriority = -1;
  private lastTime = -Infinity;
  private disposed = false;
  private accepted = 0;
  private responses = 0;
  private routingBudget = 0;
  private routeSearches = 0;

  constructor(island: IslandData, excludedPositions: readonly Vec2[] = []) {
    this.plan = createAmbientLifePlan(island, excludedPositions);
    const nav = this.plan.navigation;
    this.actors = this.plan.residents.map(definition => {
      const p = nav.nodes[definition.initialNode]!.position;
      const state: AmbientResidentState = { id: definition.id, role: definition.role, model: definition.model,
        position: { ...p }, yaw: definition.phase * Math.PI * 2, speed: 0, distanceTravelled: 0,
        activity: 'idle', phase: definition.phase, reactionUntil: -Infinity,
        height: definition.height, radius: definition.radius };
      return { definition, state, route: [], routeIndex: 0, station: -1, cycle: 0,
        dwellUntil: 1 + definition.phase * 7, cooldownUntil: -Infinity, reactionAt: -Infinity,
        reactionKind: undefined, lookAt: { ...p }, routine: 'day', detour: undefined,
        yieldUntil: -Infinity, nextYield: 0, fleePrepared: false, reroute: false };
    });
    this.residents = this.actors.map(actor => actor.state);
    this.cell = 2.4 * nav.scale;
    this.originX = (nav.nodes.length ? Math.min(...nav.nodes.map(node => node.position.x)) : 0) - this.cell;
    this.originZ = (nav.nodes.length ? Math.min(...nav.nodes.map(node => node.position.z)) : 0) - this.cell;
    this.gridWidth = Math.ceil(((nav.nodes.length ? Math.max(...nav.nodes.map(node => node.position.x)) : 0) - this.originX) / this.cell) + 2;
    this.gridDepth = Math.ceil(((nav.nodes.length ? Math.max(...nav.nodes.map(node => node.position.z)) : 0) - this.originZ) / this.cell) + 2;
    this.grid = new Int32Array(this.gridWidth * this.gridDepth).fill(-1);
    this.next = new Int32Array(this.actors.length).fill(-1);
  }

  get stats() {
    return { residents: this.actors.length, moving: this.residents.filter(s => s.speed > .03).length,
      acceptedEvents: this.accepted, reactions: this.responses, queuedEvents: 0, routeSearches: this.routeSearches };
  }

  private fillGrid(): void {
    this.grid.fill(-1);
    for (let i = 0; i < this.actors.length; i++) {
      const p = this.actors[i]!.state.position;
      const x = Math.max(0, Math.min(this.gridWidth - 1, Math.floor((p.x - this.originX) / this.cell)));
      const z = Math.max(0, Math.min(this.gridDepth - 1, Math.floor((p.z - this.originZ) / this.cell)));
      const cell = z * this.gridWidth + x;
      this.next[i] = this.grid[cell]!; this.grid[cell] = i;
    }
  }

  private blockingResident(index: number, proposed: Vec3): number | undefined {
    const self = this.actors[index]!.state;
    const x = Math.floor((proposed.x - this.originX) / this.cell), z = Math.floor((proposed.z - this.originZ) / this.cell);
    for (let iz = Math.max(0, z - 1); iz <= Math.min(this.gridDepth - 1, z + 1); iz++)
      for (let ix = Math.max(0, x - 1); ix <= Math.min(this.gridWidth - 1, x + 1); ix++) {
        for (let other = this.grid[iz * this.gridWidth + ix]!; other >= 0; other = this.next[other]!) {
          if (other === index) continue;
          const state = this.actors[other]!.state;
          if (Math.abs(proposed.y - state.position.y) > Math.max(state.height, self.height)) continue;
          const safe = self.radius + state.radius + .12 * this.plan.navigation.scale;
          const oldDistance = Math.hypot(state.position.x - self.position.x, state.position.z - self.position.z);
          const newDistance = Math.hypot(state.position.x - proposed.x, state.position.z - proposed.z);
          if (oldDistance < safe && newDistance > oldDistance + 1e-7) continue;
          if (pointSegmentDistance(state.position, self.position, proposed) < safe) return other;
        }
      }
    return;
  }

  private routeTo(actor: Resident, station: number): boolean {
    const target = this.plan.stations[station];
    if (!target) return false;
    if (!this.routeToNode(actor, target.node)) return false;
    actor.station = station;
    return true;
  }

  private routeToNode(actor: Resident, target: number): boolean {
    if (this.routingBudget <= 0) return false;
    this.routingBudget--;
    this.routeSearches++;
    const nav = this.plan.navigation;
    const nearest = nearestAmbientNode(nav, actor.state.position, 3 * nav.scale, nav.nodes[target]?.component);
    if (nearest === undefined || !isAmbientSegmentSafe(nav, actor.state.position, nav.nodes[nearest]!.position)) return false;
    const path = findAmbientPath(nav, nearest, target);
    if (!path.length) return false;
    actor.route = path; actor.routeIndex = 0; actor.detour = undefined;
    if (Math.hypot(actor.state.position.x - nav.nodes[nearest]!.position.x,
      actor.state.position.z - nav.nodes[nearest]!.position.z) < .04 * nav.scale) actor.routeIndex = 1;
    return true;
  }

  private nextDestination(actor: Resident, time: number): boolean {
    const definition = actor.definition;
    let station = definition.home;
    if (actor.routine === 'day') {
      let found = false;
      for (let offset = 0; offset < definition.itinerary.length; offset++) {
        const candidate = definition.itinerary[(actor.cycle + offset) % definition.itinerary.length]!;
        if (this.actors.some(other => other !== actor && other.station === candidate)) continue;
        station = candidate; actor.cycle += offset + 1; found = true; break;
      }
      if (!found) { actor.dwellUntil = time + 1.3; return false; }
    }
    if (!this.routeTo(actor, station)) { actor.dwellUntil = time + .2; return false; }
    actor.reroute = false;
    if (this.plan.stations[station]?.seat && actor.routeIndex >= actor.route.length) this.arrive(actor, time);
    return true;
  }

  private stationActivity(actor: Resident): AmbientActivity {
    if (actor.routine !== 'day') return 'shelter';
    const station = this.plan.stations[actor.station];
    if (!station) return 'idle';
    if (station.kind === 'market') return actor.definition.role === 'vendor' ? 'work' : 'shop';
    if (station.kind === 'delivery') return actor.definition.role === 'delivery' ? 'work' : 'look';
    if (station.kind === 'shop') return 'shop';
    return 'idle';
  }

  private arrive(actor: Resident, time: number): void {
    const seatedVisit = this.plan.stations[actor.station]?.seat && !actor.reactionKind;
    const dwell = actor.definition.dwell * (.8 + actor.definition.phase * .4);
    actor.dwellUntil = time + (seatedVisit ? 12 + dwell : dwell);
    actor.state.speed = 0;
    actor.state.activity = actor.reactionKind ? 'startle' : this.stationActivity(actor);
  }

  private blockingObstacle(state: AmbientResidentState, next: Vec3,
    obstacles: IslandLifeContext['obstacles']): IslandLifeObstacle | undefined {
    const scale = this.plan.navigation.scale;
    for (const obstacle of obstacles ?? []) {
      const halfHeight = (obstacle.height ?? scale) / 2;
      if (obstacle.position.y + halfHeight >= next.y + .15 * scale &&
        obstacle.position.y - halfHeight <= next.y + state.height &&
        blocksMovement(obstacle.position, state.position, next, obstacle.radius + state.radius + .15 * scale)) return obstacle;
    }
    return undefined;
  }

  private updateSeat(actor: Resident, index: number, context: IslandLifeContext, dt: number): boolean {
    const { state } = actor;
    const station = this.plan.stations[actor.station], seat = station?.seat;
    if (!seat || !station) return false;
    const nav = this.plan.navigation, approach = nav.nodes[station.node]!.position;
    const stay = actor.routine === 'day' && !actor.reroute && !actor.reactionKind &&
      context.time < actor.dwellUntil && seat.floor.y > context.tideLevel + .22 * nav.scale;
    if (!state.seat && (!stay || actor.detour || actor.routeIndex < actor.route.length ||
      Math.hypot(state.position.x - approach.x, state.position.z - approach.z) > .05 * nav.scale)) return false;

    state.speed = 0;
    if (turn(state, station.yaw, dt) > .14 && !state.seat) return true;
    const progress = state.seat?.progress ?? 0;
    const nextProgress = Math.max(0, Math.min(1, progress + (stay ? dt : -dt) / 1.15));
    if (nextProgress === progress) return true;
    const t = nextProgress * nextProgress * (3 - 2 * nextProgress);
    const next = this.proposed;
    next.x = approach.x + (seat.floor.x - approach.x) * t;
    next.z = approach.z + (seat.floor.z - approach.z) * t;
    next.y = nav.surfaceAt(next.x, next.z);
    const player = context.player;
    if (this.blockingResident(index, next) !== undefined || this.blockingObstacle(state, next, context.obstacles) ||
      (Math.abs(player.position.y - next.y) < state.height + nav.scale &&
        blocksMovement(player.position, state.position, next, player.radius + state.radius + .1 * nav.scale))) return true;

    Object.assign(state.position, next);
    if (nextProgress > 0) {
      state.seat ??= { anchor: seat, progress: 0 };
      state.seat.progress = nextProgress;
      state.activity = 'sit';
    } else {
      delete state.seat;
      state.activity = actor.reactionKind === 'bleat' ? (actor.definition.phase > .38 ? 'wave' : 'look') :
        actor.reactionKind ? 'startle' : 'idle';
    }
    return true;
  }

  private prepareFlee(actor: Resident): void {
    const nav = this.plan.navigation, at = actor.state.position, source = actor.lookAt;
    // Discard the ordinary itinerary even if no valid escape exists. It may
    // point directly toward the source of the alarm.
    actor.route = []; actor.routeIndex = 0; actor.detour = undefined;
    actor.yieldUntil = -Infinity;
    let target: number | undefined, best = -Infinity;
    const sourceDistance = Math.hypot(at.x - source.x, at.z - source.z);
    for (const node of nav.nodes) {
      const distance = Math.hypot(node.position.x - at.x, node.position.z - at.z);
      if (distance < 2 * nav.scale || distance > 6 * nav.scale) continue;
      const away = Math.hypot(node.position.x - source.x, node.position.z - source.z) - sourceDistance;
      if (away < 1.5 * nav.scale || movesTowardIncident(source, at, node.position)) continue;
      const score = away - distance * .3;
      if (score > best && isAmbientSegmentSafe(nav, at, node.position)) { best = score; target = node.id; }
    }
    if (target !== undefined) actor.route = [target];
    actor.fleePrepared = true;
  }

  private yieldAway(actor: Resident, obstacle: Vec3, time: number): void {
    if (time < actor.nextYield || (actor.reactionKind &&
      (actor.reactionKind === 'bleat' || actor.routeIndex >= actor.route.length))) return;
    actor.detour = undefined;
    const nav = this.plan.navigation, p = actor.state.position;
    const dx = p.x - obstacle.x, dz = p.z - obstacle.z, distance = Math.hypot(dx, dz) || 1;
    const index = this.actors.indexOf(actor);
    // Prefer a lateral step, then a backstep/diagonal. A stationary resident
    // reserves a return to their station after letting a passer-by through.
    for (const angle of [Math.PI / 2, -Math.PI / 2, 0, Math.PI / 4, -Math.PI / 4]) {
      const sx = (dx * Math.cos(angle) - dz * Math.sin(angle)) / distance;
      const sz = (dx * Math.sin(angle) + dz * Math.cos(angle)) / distance;
      const x = p.x + sx * 1.25 * nav.scale, z = p.z + sz * 1.25 * nav.scale;
      const target = { x, y: nav.surfaceAt(x, z), z };
      const nextId = actor.route[actor.routeIndex];
      if ((actor.reactionKind && movesTowardIncident(actor.lookAt, p, target)) ||
        !isAmbientSegmentSafe(nav, p, target) ||
        this.blockingResident(index, target) !== undefined ||
        (nextId !== undefined && !isAmbientSegmentSafe(nav, target, nav.nodes[nextId]!.position))) continue;
      if (nextId === undefined && actor.route.length) actor.routeIndex = actor.route.length - 1;
      actor.detour = target; actor.nextYield = time + 2.5; return;
    }
    actor.nextYield = time + 1.3;
  }

  /** Accepted game actions only: coalesced globally and per actor, with a fixed
   * six-response cap. No event queue can accumulate under repeated commotion. */
  react(kind: IslandLifeEvent, position: Vec3, time: number, intensity = 1): number {
    const priority = kind === 'headbutt' ? 2 : kind === 'chaos' ? 1 : 0;
    if (this.disposed || !this.enabled || !Number.isFinite(time) || time < 0 || time < this.lastEvent ||
      !Number.isFinite(position.x + position.y + position.z) || !Number.isFinite(intensity) ||
      (time - this.lastEvent < .45 && priority <= this.lastEventPriority)) return 0;
    const scale = this.plan.navigation.scale, strength = Math.max(0, Math.min(1, intensity));
    const range = (kind === 'bleat' ? 10 : 8 + strength * 5) * scale;
    const candidates = this.actors.filter(actor => (time >= actor.cooldownUntil ||
      (actor.reactionKind !== undefined && priority > (actor.reactionKind === 'headbutt' ? 2 : actor.reactionKind === 'chaos' ? 1 : 0))) &&
      Math.abs(actor.state.position.y - position.y) < 3 * scale &&
      Math.hypot(actor.state.position.x - position.x, actor.state.position.z - position.z) <= range)
      .sort((a, b) => Math.hypot(a.state.position.x - position.x, a.state.position.z - position.z) -
        Math.hypot(b.state.position.x - position.x, b.state.position.z - position.z)).slice(0, 6);
    if (!candidates.length) return 0;
    this.lastEvent = time; this.lastEventPriority = priority; this.accepted++; this.responses += candidates.length;
    for (const actor of candidates) {
      actor.reactionKind = kind; actor.reactionAt = time; actor.fleePrepared = false;
      actor.state.reactionUntil = time + (kind === 'bleat' ? 2.8 : 4.8) + actor.definition.phase;
      actor.cooldownUntil = time + 8 + actor.definition.phase * 4;
      actor.lookAt.x = position.x; actor.lookAt.y = position.y; actor.lookAt.z = position.z;
      if (!actor.state.seat)
        actor.state.activity = kind === 'bleat' ? (actor.definition.phase > .38 ? 'wave' : 'look') : 'startle';
      actor.state.speed = 0;
    }
    return candidates.length;
  }

  /** Call once per deterministic physics tick. A paused/background game never
   * advances this clock, so presentation and routines resume at the same place. */
  step(dt: number, context: IslandLifeContext): void {
    if (this.disposed) return;
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(context.time)) throw new RangeError('Living-world time must be finite and non-negative');
    if (dt === 0) return;
    if (context.time < this.lastTime) return; // Stale callbacks cannot rewind actors.
    this.lastTime = context.time;
    const justEnabled = !this.enabled && context.enabled;
    this.enabled = context.enabled;
    this.sheltered = context.rain >= .48 || (this.sheltered && context.rain > .22);
    const seconds = Math.min(dt, .1), nav = this.plan.navigation, scale = nav.scale;
    // Rain, dusk and mode changes can affect the entire cast simultaneously.
    // At most one A* search/route compaction is admitted in a fixed tick.
    this.routingBudget = 1;
    this.fillGrid();
    for (let index = 0; index < this.actors.length; index++) {
      const actor = this.actors[index]!, state = actor.state, def = actor.definition;
      if (!context.enabled) { state.speed = 0; state.activity = state.seat ? 'sit' : 'idle'; continue; }
      if (justEnabled) {
        if (actor.reactionKind) {
          actor.route = []; actor.routeIndex = 0; actor.detour = undefined;
          actor.reroute = true;
        }
        actor.reactionKind = undefined; state.reactionUntil = -Infinity;
        actor.dwellUntil = context.time + def.phase;
      }
      const phase = ((context.phase % 1) + 1) % 1;
      const routine: Routine = this.sheltered ? 'shelter' :
        phase < .27 + def.phase * .025 || phase > .73 + def.phase * .04 ? 'night' : 'day';
      if (actor.routine !== routine) {
        actor.routine = routine;
        actor.reroute = true;
        actor.dwellUntil = context.time + def.phase * .25;
      }
      if (actor.reactionKind && context.time >= state.reactionUntil) {
        actor.reactionKind = undefined; actor.detour = undefined;
        actor.route = []; actor.routeIndex = 0;
        actor.reroute = true;
        actor.dwellUntil = context.time;
      }
      if (this.updateSeat(actor, index, context, seconds)) continue;
      if (actor.reroute && !actor.reactionKind && this.routingBudget > 0 && context.time >= actor.dwellUntil)
        this.nextDestination(actor, context.time);
      if (actor.reactionKind) {
        if (actor.reactionKind === 'bleat' || context.time - actor.reactionAt < .65) {
          state.speed = 0;
          turn(state, Math.atan2(actor.lookAt.x - state.position.x, actor.lookAt.z - state.position.z), seconds);
          continue;
        }
        if (!actor.fleePrepared) this.prepareFlee(actor);
        // No retreat, an invalidated route, or arrival at the retreat waypoint:
        // stay alert until recovery, never select a normal station mid-alarm.
        if (actor.routeIndex >= actor.route.length) {
          actor.detour = undefined;
          state.speed = 0; state.activity = 'startle';
          turn(state, Math.atan2(actor.lookAt.x - state.position.x, actor.lookAt.z - state.position.z), seconds);
          continue;
        }
      }
      const player = context.player;
      const nearPlayer = Math.abs(player.position.y - state.position.y) < state.height + scale &&
        Math.hypot(player.position.x - state.position.x, player.position.z - state.position.z) < player.radius + state.radius + .8 * scale;
      if (nearPlayer && !actor.reactionKind) {
        this.yieldAway(actor, player.position, context.time);
        if (!actor.detour) {
          state.speed = 0; state.activity = 'look';
          turn(state, Math.atan2(player.position.x - state.position.x, player.position.z - state.position.z), seconds);
          continue;
        }
      }
      let nextId = actor.route[actor.routeIndex];
      if (!actor.detour && nextId === undefined) {
        if (context.time >= actor.dwellUntil && (actor.routine === 'day' || actor.station !== def.home)) {
          this.nextDestination(actor, context.time); nextId = actor.route[actor.routeIndex];
        }
        if (nextId === undefined) {
          state.speed = 0; state.activity = this.stationActivity(actor);
          const station = this.plan.stations[actor.station]; if (station) turn(state, station.yaw, seconds, 1.8);
          continue;
        }
      }
      const target = actor.detour ?? (nextId !== undefined ? nav.nodes[nextId]!.position : undefined);
      if (!target || context.time < actor.yieldUntil) { state.speed = 0; continue; }
      // A dynamic detour can change the approach to an otherwise safe waypoint.
      // If the next segment would close on the incident, wait until recovery.
      if (actor.reactionKind && movesTowardIncident(actor.lookAt, state.position, target)) {
        actor.route = []; actor.routeIndex = 0; actor.detour = undefined;
        state.speed = 0; state.activity = 'startle'; continue;
      }
      const dx = target.x - state.position.x, dz = target.z - state.position.z, distance = Math.hypot(dx, dz);
      if (distance <= .025 * scale) {
        if (actor.detour) { actor.detour = undefined; actor.yieldUntil = context.time + 1.2; }
        else actor.routeIndex++;
        if (actor.routeIndex >= actor.route.length) {
          this.arrive(actor, context.time);
        }
        continue;
      }
      const angle = Math.atan2(dx, dz), heading = turn(state, angle, seconds);
      const flee = !!actor.reactionKind;
      const cruising = def.speed * (flee ? 1.65 : actor.routine !== 'day' ? 1.08 : 1);
      const desired = Math.min(cruising, Math.sqrt(2 * 1.8 * scale * distance)) * Math.max(0, Math.cos(heading));
      const speed = Math.min(desired, state.speed + seconds * 2.1 * scale);
      const travel = Math.min(distance, speed * seconds);
      const next = this.proposed;
      next.x = state.position.x + dx / distance * travel; next.z = state.position.z + dz / distance * travel;
      next.y = nav.surfaceAt(next.x, next.z);
      if (next.y < context.tideLevel + .22 * scale) { state.speed = 0; state.activity = 'look'; continue; }
      // Tiny curb/terrain joins can sit between the plan's surface samples.
      // Verify actual planted support before committing any live foot position.
      if (!isAmbientFootSupported(nav, next)) {
        state.speed = 0; actor.reroute = true; state.activity = 'look';
        actor.route = []; actor.routeIndex = 0; actor.detour = undefined;
        actor.dwellUntil = context.time + .5; continue;
      }
      const playerSafe = player.radius + state.radius + .1 * scale;
      const playerBlocks = Math.abs(player.position.y - next.y) < state.height + scale &&
        blocksMovement(player.position, state.position, next, playerSafe);
      const obstacle = this.blockingObstacle(state, next, context.obstacles);
      if (obstacle) this.yieldAway(actor, obstacle.position, context.time);
      const other = this.blockingResident(index, next);
      if (other !== undefined || playerBlocks || obstacle) {
        state.speed = 0; state.activity = flee ? 'startle' : 'look';
        if (playerBlocks) this.yieldAway(actor, player.position, context.time);
        else if (other !== undefined) {
          const yielding = index > other ? actor : this.actors[other]!;
          const obstacle = index > other ? this.actors[other]!.state.position : state.position;
          this.yieldAway(yielding, obstacle, context.time);
        }
        continue;
      }
      state.position.x = next.x; state.position.y = next.y; state.position.z = next.z;
      state.speed = travel / seconds; state.distanceTravelled += travel;
      state.activity = flee ? 'flee' : 'walk';
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const actor of this.actors) { actor.route = []; actor.detour = undefined; actor.state.speed = 0; }
    this.grid.fill(-1); this.next.fill(-1);
  }
}
