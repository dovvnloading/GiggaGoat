import { RAPIER, V, add, forward, mul, sub } from '../physics';
import type { Vec3 } from '../physics';
import type { Game, PlayerIntent } from './Game';

export const TOYS = [
  { id: 'gas', name: 'Fart-o-Meter', hint: 'Run to fill the tank. Vent to punt nearby props.' },
  { id: 'glob', name: 'Boog-or-Blaster', hint: 'Aim at loose cargo. The glob sticks, then pops.' },
  { id: 'brew', name: 'Toe Jam Brew', hint: 'Seven seconds of turbo soda. Hold jump to fly, release to descend.' },
  { id: 'sock', name: 'Lost Sock Magnet', hint: 'Pull nearby loose props into a swirling laundry pile.' },
  { id: 'pogo', name: 'Pogo Pickle', hint: 'Steer three spring hops. Each landing loads the next.' },
  { id: 'duck', name: 'Quacktrack', hint: 'Plant a rubber duck on solid ground. Use again to return.' },
] as const;
export type ToyId = typeof TOYS[number]['id'];
export type ToyCue = { toy: ToyId; position: Vec3; strength: number };
type Glob = { position: Vec3; direction: Vec3; life: number; stuck: boolean; target?: number; offset?: Vec3 };

export class Toybox {
  index = 0;
  gas = 100;
  brew = 0;
  magnet = 0;
  hops = 0;
  duck: { position: Vec3; heading: number } | null = null;
  glob: Glob | null = null;
  message = '';
  messageUntil = 0;
  readonly readyAt = new Map<ToyId, number>();
  readonly listeners = new Set<(cue: ToyCue) => void>();
  private nextHop = 0;
  private nextPull = 0;
  private readonly globShape = new RAPIER.Ball(.24);

  constructor(private readonly game: Game) {}
  get selected() { return TOYS[this.index]!; }
  get available(): boolean {
    return !this.game.party.match && this.game.gigs.active?.status !== 'running';
  }
  private say(text: string): void {
    this.message = text;
    this.messageUntil = this.game.physics.time + 3;
  }
  private emit(toy: ToyId, position: Vec3, strength = 1): void {
    for (const fn of this.listeners) fn({ toy, position: { ...position }, strength });
  }
  status(): string {
    const id = this.selected.id, now = this.game.physics.time;
    if (id === 'gas') return Math.floor(this.gas) + '%';
    if (id === 'brew' && this.brew > 0) return 'FLIGHT ' + Math.ceil(this.brew) + 's';
    if (id === 'sock' && this.magnet > 0) return 'PULL ' + Math.ceil(this.magnet) + 's';
    if (id === 'pogo' && this.hops) return this.hops + ' HOPS';
    if (id === 'duck' && this.duck) return 'RECALL';
    const left = Math.ceil((this.readyAt.get(id) ?? 0) - now);
    return left > 0 ? left + 's' : 'READY';
  }
  reset(): void {
    this.duck = this.glob = null;
    this.magnet = this.brew = this.hops = 0;
    this.messageUntil = 0;
  }
  input(intent: PlayerIntent): void {
    if (!this.available || this.game.buildMode) return;
    if (intent.cycleToy) {
      this.index = (this.index + TOYS.length + Math.sign(intent.cycleToy)) % TOYS.length;
      this.say(this.selected.hint);
    }
    if (!intent.useToy) return;
    const g = this.game, goat = g.goat, p = goat.torso.translation(), now = g.physics.time;
    const id = this.selected.id, facing = forward(intent.cameraYaw ?? goat.locomotion.heading);
    if ((this.readyAt.get(id) ?? 0) > now) { this.say('Recharging · ' + this.status()); return; }
    if (goat.isRagdoll) { this.say('Get back on your hooves'); return; }
    let cooldown = 0;
    switch (id) {
      case 'gas': {
        if (this.gas < 25) { this.say('Run to build pressure · 25% to vent'); return; }
        const power = this.gas / 100;
        this.gas = 0;
        const hits = this.moveProps(p, 4 + power * 5, power, false);
        this.kick(V(facing.x * 3 * power, 3 + 4 * power, facing.z * 3 * power));
        this.emit(id, p, power);
        this.say(hits ? 'Blast! Props punted: ' + hits : 'Blast! Run to refill');
        return;
      }
      case 'glob': {
        if (this.glob) return;
        const pitch = intent.cameraPitch ?? 0;
        const direction = V(facing.x * Math.cos(pitch), -Math.sin(pitch), facing.z * Math.cos(pitch));
        this.glob = { position: { ...goat.head.translation() }, direction, life: .95, stuck: false };
        this.say('Snot rocket away'); cooldown = 1.65;
        break;
      }
      case 'brew':
        this.brew = 7; cooldown = 16;
        this.kick(V(facing.x * 5, 5.8, facing.z * 5));
        this.say('Turbo fizz! Hold jump to climb'); break;
      case 'sock':
        this.magnet = 4; this.nextPull = now; cooldown = 9;
        this.say('Laundry vortex · get close to loose props'); break;
      case 'pogo':
        this.hops = 3; this.nextHop = now; cooldown = 8;
        this.say('Three hops armed · steer between landings'); break;
      case 'duck': {
        if (this.duck) {
          const anchor = this.duck;
          const clearance = new RAPIER.Capsule(.33 * goat.size, .37 * goat.size);
          const center = add(anchor.position, V(0, .98 * goat.size, 0));
          const obstruction = g.physics.raw.intersectionWithShape(center, {x:0,y:0,z:0,w:1}, clearance,
            RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, c => !goat.ownsBody(c.parent()));
          this.duck = null;
          if (obstruction || anchor.position.y < g.water.seaLevel + .2) {
            this.say('Duck spot blocked · plant a new marker');
            return;
          }
          g.teleport(anchor.position, anchor.heading);
          this.emit(id, anchor.position);
          this.say('Quack! Back at your marker');
          this.readyAt.set(id, now + 3);
          return;
        }
        const support = goat.locomotion.groundHit;
        if (!goat.locomotion.grounded || !support || support.body?.isDynamic() ||
            support.point.y < g.water.seaLevel + .2) { this.say('Plant your duck on dry, solid ground'); return; }
        this.duck = { position: { ...support.point }, heading: -goat.locomotion.heading };
        this.say('Duck planted · use again to return'); cooldown = .5;
        break;
      }
    }
    this.readyAt.set(id, now + cooldown);
    if (id !== 'pogo') this.emit(id, p);
  }

  private kick(delta: Vec3): void {
    for (const b of this.game.goat.bodies) b.applyImpulse(mul(delta, b.mass()), true);
  }

  private moveProps(center: Vec3, radius: number, power: number, pull: boolean): number {
    const g = this.game;
    let hits = 0;
    for (const [handle] of g.propByBody) {
      const b = g.physics.raw.getRigidBody(handle);
      if (!b?.isDynamic()) continue;
      const offset = sub(b.translation(), center), d = Math.hypot(offset.x, offset.y, offset.z);
      if (d >= radius || d < .15) continue;
      if (g.physics.raycast(center, offset, d, { predicate: c => c.parent()?.isFixed() === true })) continue;
      if (pull) {
        const v = b.linvel(), k = Math.min(2, d * .4);
        b.applyImpulse(mul(V((-offset.x + .65 * offset.z) * k / d - .18 * v.x,
          Math.max(-1, Math.min(1.8, 1 - offset.y)) - .12 * v.y,
          (-offset.z - .65 * offset.x) * k / d - .18 * v.z), b.mass()), true);
      } else {
        const push = (3 + 11 * power) * (1 - .55 * d / radius);
        b.applyImpulse(mul(V(offset.x / d * push, 2 + push * .48, offset.z / d * push), b.mass()), true);
      }
      hits++;
    }
    return hits;
  }

  tick(dt: number, input: PlayerIntent): void {
    if (!this.available) { this.reset(); return; }
    const g = this.game, goat = g.goat, now = g.physics.time, v = goat.torso.linvel();
    if (goat.locomotion.grounded && (input.moveX || input.moveZ) && !goat.isRagdoll) {
      this.gas = Math.min(100, this.gas + Math.min(11, Math.hypot(v.x, v.z)) * dt * 2.6);
    }
    if (this.brew > 0) {
      this.brew = Math.max(0, this.brew - dt);
      const f = forward(input.cameraYaw ?? goat.locomotion.heading);
      const x = (input.moveZ ?? 0) * f.x - (input.moveX ?? 0) * f.z;
      const z = (input.moveZ ?? 0) * f.z + (input.moveX ?? 0) * f.x;
      const scale = 24 / Math.max(1, Math.hypot(x,z));
      const delta = (target: number, speed: number) => Math.max(-60 * dt, Math.min(60 * dt, target - speed));
      if (!goat.isRagdoll) this.kick(V(delta(x * scale, v.x), delta(input.jump || input.glide ? 9 : -2.4, v.y), delta(z * scale, v.z)));
    }
    if (this.magnet > 0) {
      this.magnet = Math.max(0, this.magnet - dt);
      if (now >= this.nextPull) {
        this.moveProps(goat.torso.translation(), 10, 1, true);
        this.nextPull = now + .09;
      }
    }
    if (this.hops && !goat.isRagdoll && goat.locomotion.grounded && v.y < 1 && now >= this.nextHop) {
      this.kick(V(0, 8 + (3 - this.hops) * 1.6 - v.y, 0));
      this.hops--; this.nextHop = now + .45;
      this.emit('pogo', goat.torso.translation(), 1.2);
    }
    if (this.glob) this.updateGlob(dt);
  }

  private updateGlob(dt: number): void {
    const shot = this.glob!, g = this.game;
    shot.life -= dt;
    if (shot.stuck) {
      const body = shot.target === undefined ? null : g.physics.raw.getRigidBody(shot.target);
      if (body && shot.offset) shot.position = add(body.translation(), shot.offset);
      if (shot.life <= 0) {
        if (body?.isDynamic()) body.applyImpulse(mul(add(mul(shot.direction, 9), V(0,5,0)), body.mass()), true);
        this.emit('glob', shot.position, 1.7);
        this.glob = null;
      }
      return;
    }
    const step = dt * 24;
    const hit = g.physics.shapeCast(shot.position, {x:0,y:0,z:0,w:1}, shot.direction, this.globShape, step,
      { predicate: c => !g.goat.ownsBody(c.parent()) });
    shot.position = add(shot.position, mul(shot.direction, hit?.distance ?? step));
    if (hit) {
      shot.stuck = true; shot.life = .48;
      if (hit.body?.isDynamic()) {
        shot.target = hit.body.handle; shot.offset = sub(shot.position, hit.body.translation());
        this.say('Stuck! Stand back');
      }
    } else if (shot.life <= 0) this.glob = null;
  }
}
