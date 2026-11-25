import type { Game, PlayerIntent } from './Game';
import type { PhysicsContact, Vec3 } from '../physics';

/** Capture-only controller. The production game receives normal player input;
 * this module is imported by the evidence fixture and regression tests only. */
type Point = { x: number; z: number };
type Waypoint = readonly [number, number];
export const DOWNTOWN_TOUR_START = [8, -42] as const;
export const DOWNTOWN_TOUR_ROUTE: readonly Waypoint[] = [
  [8, -16], [6.2, -5], [6.2, 8], [8, 22], [8, 44], [8, 55.6],
  [14, 55.6], [20, 55.6], [14, 55.6], [8, 55.6], [8, 40],
];
const GOAL_RADIUS = 1.2;
const DETOUR_RADIUS = .85;
const STALL_SECONDS = 1.75;
const PROGRESS_METRES = .25;
const SIDESTEPS = [-2.4, 2.4, -3.8, 3.8] as const;
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Match PhysicsWorld's existing accumulator and max-substep drop policy. Input
 * is sampled separately for each admitted fixed tick, never once per render. */
export class TourFixedClock {
  private remainder = 0;
  constructor(readonly dt: number, readonly maxSubsteps: number) {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isInteger(maxSubsteps) || maxSubsteps < 1)
      throw new RangeError('Invalid tour clock');
  }
  advance(seconds: number, step: () => void): { steps: number; droppedSeconds: number } {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid tour frame time');
    const available = this.remainder + seconds, cap = this.dt * this.maxSubsteps;
    const admitted = Math.min(available, cap);
    const steps = Math.min(this.maxSubsteps, Math.floor((admitted + 1e-10) / this.dt));
    this.remainder = Math.max(0, admitted - steps * this.dt);
    for (let tick = 0; tick < steps; tick++) step();
    return { steps, droppedSeconds: Math.max(0, available - cap) };
  }
}

interface Reach {
  index: number; wallSeconds: number; simulationSeconds: number;
  position: Point; distance: number;
}
interface Recovery {
  index: number; attempt: number; simulationSeconds: number;
  position: Point; stalledAim: Point; goal: Point; waypoints: Point[];
}
interface Escape { origin: Point; dx: number; dz: number; distance: number; attempts: number }

/** Observe exact physical waypoint arrival, not a planned detour or a timer.
 * A blocked route gets a bounded lateral/back-step and re-approach, as a player
 * would. No teleports, prop deletion, jump exploits, speed boosts or larger
 * waypoint radius. Exhaustion is an explicit failed route. */
export class TourSteering {
  readonly reachedWaypoints: Reach[] = [];
  readonly recoveries: Recovery[] = [];
  bleatSimulationAt: number | null = null;
  bleatWallAt: number | null = null;
  failure: string | null = null;
  private index = 0;
  private best = Infinity;
  private progressAt = 0;
  private escape: Escape | undefined;
  private detours: Point[] = [];
  private lastYaw = Math.PI;
  constructor(private readonly city: Point, readonly duration: number,
    readonly route: readonly Waypoint[] = DOWNTOWN_TOUR_ROUTE) {}
  get completedRoute(): boolean { return this.index >= this.route.length; }
  get waypointIndex(): number { return this.index; }
  get goal(): Point | undefined {
    const point = this.route[this.index];
    return point ? { x: this.city.x + point[0], z: this.city.z + point[1] } : undefined;
  }
  get aim(): Point | undefined { return this.detours[0] ?? this.goal; }
  private resetProgress(seconds: number): void { this.best = Infinity; this.progressAt = seconds; }
  private recover(position: Point, goal: Point, aim: Point, seconds: number): void {
    if (!this.escape) {
      const d = distance(position, goal);
      this.escape = { origin: { ...position }, dx: (goal.x - position.x) / d,
        dz: (goal.z - position.z) / d, distance: d, attempts: 0 };
    }
    const e = this.escape;
    const lateral = SIDESTEPS[e.attempts];
    if (lateral === undefined) {
      this.failure = 'Waypoint ' + (this.index + 1) + ' blocked after ' + e.attempts + ' physical re-approaches';
      this.detours = [];
      return;
    }
    // First get behind/beside the obstructing face, then walk past it before
    // re-approaching the unchanged required waypoint.
    const point = (along: number): Point => ({
      x: e.origin.x + e.dx * along + e.dz * lateral,
      z: e.origin.z + e.dz * along - e.dx * lateral,
    });
    const pass = Math.max(2.8, Math.min(4.5, e.distance + .8));
    this.detours = [point(-.8), point(pass)];
    e.attempts++;
    this.recoveries.push({ index: this.index, attempt: e.attempts, simulationSeconds: seconds,
      position: { ...position }, stalledAim: { ...aim }, goal: { ...goal },
      waypoints: this.detours.map(p => ({ ...p })) });
    this.resetProgress(seconds);
  }
  intent(position: Point, seconds: number, wallSeconds: number, nearbyResident: boolean): PlayerIntent {
    let goal = this.goal;
    if (goal && distance(position, goal) < GOAL_RADIUS && !this.failure) {
      this.reachedWaypoints.push({ index: this.index, wallSeconds, simulationSeconds: seconds,
        position: { x: position.x, z: position.z }, distance: distance(position, goal) });
      this.index++;
      this.escape = undefined;
      this.detours = [];
      this.resetProgress(seconds);
      goal = this.goal; // Steer toward the new waypoint in this same fixed tick.
    }
    const bleat = this.bleatSimulationAt === null && seconds >= 10 &&
      (nearbyResident || seconds >= Math.max(10, this.duration * .7));
    if (bleat) { this.bleatSimulationAt = seconds; this.bleatWallAt = wallSeconds; }
    const observing = this.bleatSimulationAt !== null && seconds - this.bleatSimulationAt < 3;
    const idle = seconds < 8 || seconds >= Math.max(9, this.duration - 12) ||
      this.completedRoute || observing || this.failure !== null;
    if (idle || !goal) {
      this.resetProgress(seconds);
      return { moveX: 0, moveZ: 0, cameraYaw: this.lastYaw, climb: false, bleat };
    }
    while (this.detours.length && distance(position, this.detours[0]!) < DETOUR_RADIUS) {
      this.detours.shift();
      this.resetProgress(seconds);
    }
    let aim = this.aim!;
    let d = distance(position, aim);
    if (d < this.best - PROGRESS_METRES) {
      this.best = d; this.progressAt = seconds;
    } else if (seconds - this.progressAt >= STALL_SECONDS) {
      this.recover(position, goal, aim, seconds);
      if (this.failure) return { moveX: 0, moveZ: 0, cameraYaw: this.lastYaw, climb: false, bleat };
      aim = this.aim!;
      d = distance(position, aim);
    }
    if (d > 1e-6) this.lastYaw = Math.atan2(aim.x - position.x, position.z - aim.z);
    return { moveX: 0, moveZ: .65, cameraYaw: this.lastYaw, climb: false, bleat };
  }
}

interface ContactSummary { label: string; collider: number; body: number | null; impulse: number; events: number }
interface Trace {
  simulationSeconds: number; wallSeconds: number; index: number;
  position: Vec3; velocity: Vec3; goal: Point | undefined; aim: Point | undefined;
  grounded: boolean; ragdoll: boolean; heading: number; recoveryCount: number;
  support: { label: string; normal: Vec3; distance: number } | null;
  forwardHit: { label: string; normal: Vec3; distance: number } | null;
  contacts: ContactSummary[];
}

/** Bridge the same steering through Game.advance at the real fixed rate.
 * Capture diagnostics identify both named props and anonymous terrain/path
 * contacts, without mutating or querying private solver internals. */
export class LivingWorldTour {
  readonly steering: TourSteering;
  readonly clock: TourFixedClock;
  readonly trace: Trace[] = [];
  private ticks = 0;
  private readonly handles = new Set<number>();
  private readonly labels = new Map<number, string>();
  private readonly contacts = new Map<number, ContactSummary>();
  private readonly off: () => void;
  constructor(private readonly game: Game, duration: number,
    route: readonly Waypoint[] = DOWNTOWN_TOUR_ROUTE) {
    const city = game.island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    this.steering = new TourSteering(city, duration, route);
    this.clock = new TourFixedClock(game.physics.fixedDt, game.physics.maxSubsteps);
    this.labels.set(game.colliders.terrain.handle, 'island-terrain');
    game.colliders.paths.forEach((c, i) => this.labels.set(c.handle, 'path-support-' + i));
    for (const [id, c] of game.colliders.props) this.labels.set(c.handle, id);
    this.off = game.physics.onContact(event => this.contact(event));
  }
  get seconds(): number { return this.ticks * this.clock.dt; }
  get completedRoute(): boolean { return this.steering.completedRoute; }
  private label(collider: number, body: number | null): string {
    const record = body === null ? undefined : this.game.physics.bodyData(body);
    return record?.owner ?? this.labels.get(collider) ?? record?.kind ?? 'collider-' + collider;
  }
  private contact(event: PhysicsContact): void {
    if (event.type === 'end') return;
    const first = event.bodyA !== null && this.handles.has(event.bodyA);
    const second = event.bodyB !== null && this.handles.has(event.bodyB);
    if (first === second) return;
    const collider = first ? event.colliderB : event.colliderA;
    const body = first ? event.bodyB : event.bodyA;
    const previous = this.contacts.get(collider);
    if (previous) {
      previous.impulse = Math.max(previous.impulse, event.impulse);
      previous.events++;
    } else if (this.contacts.size < 16) {
      this.contacts.set(collider, { label: this.label(collider, body), collider,
        body, impulse: event.impulse, events: 1 });
    }
  }
  advanceFrame(seconds: number, wallSeconds: number, onInput?: (intent: PlayerIntent) => void) {
    return this.clock.advance(seconds, () => {
      const g = this.game.goat, p = g.torso.translation();
      this.handles.clear();
      for (const body of g.bodies) this.handles.add(body.handle);
      const nearby = this.game.life.residents.some(r =>
        Math.hypot(r.position.x - p.x, r.position.z - p.z) < 8 && Math.abs(r.position.y - p.y) < 3);
      const recoveriesBefore = this.steering.recoveries.length;
      const intent = this.steering.intent(p, this.seconds, wallSeconds, nearby);
      onInput?.(intent);
      const advanced = this.game.advance(this.clock.dt, intent);
      if (advanced.steps !== 1 || advanced.droppedSeconds > 0)
        throw new Error('Tour fixture must enter recording with an empty fixed-step remainder');
      this.ticks++;
      if (this.ticks === 1 || this.ticks % Math.round(1 / this.clock.dt) === 0 ||
        recoveriesBefore !== this.steering.recoveries.length) {
        const yaw = intent.cameraYaw ?? g.locomotion.heading, support = g.locomotion.groundHit;
        const ray = this.game.physics.raycast(g.torso.translation(),
          { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) }, 2.5 * g.size,
          { predicate: c => !g.ownsBody(c.parent()) });
        const describe = (hit: typeof ray) => hit ? {
          label: this.label(hit.collider.handle, hit.body?.handle ?? null),
          normal: { ...hit.normal }, distance: hit.distance,
        } : null;
        this.trace.push({ simulationSeconds: this.seconds, wallSeconds, index: this.steering.waypointIndex,
          position: { ...g.torso.translation() }, velocity: { ...g.torso.linvel() },
          goal: this.steering.goal, aim: this.steering.aim, grounded: g.locomotion.grounded,
          ragdoll: g.isRagdoll, heading: g.locomotion.heading, recoveryCount: this.steering.recoveries.length,
          support: describe(support), forwardHit: describe(ray),
          contacts: [...this.contacts.values()].map(c => ({ ...c })) });
        this.contacts.clear();
      }
    });
  }
  dispose(): void { this.off(); this.contacts.clear(); }
}
