import type { IslandData, Vec3 } from '../world/types';
import { gridSample } from '../world/terrain';
import { boardwalkPierDecks } from '../world/boardwalk';
import { LANTERN_HEIGHT } from '../world/lantern';
import type { PlayerIntent } from './Game';
import { TravelTrials, type TrialBests } from './TravelTrials';

export const RIDES = {
  boat: {
    name: 'Gullwing Runabout',
    port: 'Baa-ardwalk marina',
    hint: 'Cruise the coast. Pull up to a beach to go ashore.',
  },
  plane: {
    name: 'Saltwind Floatplane',
    port: 'Baa-ardwalk seaplane berth',
    hint: 'Build speed on the water, then climb over the island.',
  },
  balloon: {
    name: 'Honeycomb Balloon',
    port: 'Hoofington meadow',
    hint: 'Fire the burner, drift with the wind and trim your course.',
  },
  tram: {
    name: 'Summit Cable Car',
    port: 'Mt. Gigga foothills',
    hint: 'Ride the cable to the summit and step out at either end.',
  },
} as const;
export type Ride = keyof typeof RIDES;
export const rideIds = Object.keys(RIDES) as Ride[];
export interface Craft {
  kind: Ride;
  position: Vec3;
  home: Vec3;
  stop: Vec3;
  heading: number;
  homeHeading: number;
  speed: number;
  vertical: number;
  bank: number;
  pitch: number;
}
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const approach = (n: number, goal: number, step: number) => n + clamp(goal - n, -step, step);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const seatHeight = { boat: 0.71, plane: 1.38, balloon: 0.34, tram: 0.29 };

function cableProfile(t: number): number {
  const span = Math.min(3, Math.floor(t * 4)),
    f = t * 4 - span;
  const start = Math.sin((span * Math.PI) / 4),
    end = Math.sin(((span + 1) * Math.PI) / 4);
  return (1 - f) * start + f * end - 0.035 * f * (1 - f);
}

/** Deterministic vehicle motion, boarding and landings, in metres and seconds. */
export class IslandTravel {
  readonly trials: TravelTrials;
  readonly craft: Record<Ride, Craft>;
  readonly summit: Vec3;
  readonly cableLift: number;
  active: Ride | null = null;
  cableT = 0;
  private cableGoal = 1;
  private readonly moored: Partial<Record<Ride, Vec3>> = {};
  private note = '';
  private noteUntil = 0;
  private readonly cell = 12;
  private readonly obstacles = new Map<
    string,
    Array<{ x: number; z: number; hx: number; hz: number; top: number; base: number; breakableId?: string }>
  >();
  constructor(private readonly island: IslandData, best?: TrialBests, private readonly destroyed?: ReadonlySet<string>) {
    this.trials = new TravelTrials(best);
    for (const p of island.props) {
      if (!p.collidable || p.body.type === 'dynamic') continue;
      const { position, rotationY } = p.transform;
      const c = Math.abs(Math.cos(rotationY)),
        s = Math.abs(Math.sin(rotationY));
      const hx = (p.size.x * c + p.size.z * s) / 2,
        hz = (p.size.z * c + p.size.x * s) / 2;
      const base = position.y - p.size.y / 2;
      const box = {
        x: position.x,
        z: position.z,
        hx,
        hz,
        top: base + (p.kind === 'lamp' ? LANTERN_HEIGHT : p.size.y),
        base,
        breakableId: p.breakable ? p.id : undefined,
      };
      for (
        let i = Math.floor((box.x - hx - 3) / this.cell);
        i <= Math.floor((box.x + hx + 3) / this.cell);
        i++
      )
        for (
          let j = Math.floor((box.z - hz - 3) / this.cell);
          j <= Math.floor((box.z + hz + 3) / this.cell);
          j++
        ) {
          const key = i + ',' + j;
          const list = this.obstacles.get(key);
          if (list) list.push(box);
          else this.obstacles.set(key, [box]);
        }
    }
    const poi = (id: string) => island.pois.find((p) => p.id === id)!.center;
    const openGround = (x: number, z: number, radius: number) => {
      let best = { x, y: gridSample(island, x, z), z },
        score = Infinity;
      for (let r = 0; r <= 32; r += 2)
        for (let a = 0; a < (r ? 16 : 1); a++) {
          const px = x + r * Math.cos((a * Math.PI) / 8),
            pz = z + r * Math.sin((a * Math.PI) / 8),
            y = gridSample(island, px, pz);
          if (y < island.seaLevel + 1 || this.top(px, pz, radius) > y + 0.35) continue;
          const slope = Math.max(
            ...[
              [radius, 0],
              [-radius, 0],
              [0, radius],
              [0, -radius],
            ].map(([dx, dz]) => Math.abs(gridSample(island, px + dx!, pz + dz!) - y)),
          );
          const cost = r + slope * 12;
          if (cost < score) {
            best = { x: px, y, z: pz };
            score = cost;
          }
        }
      return best;
    };
    const k = island.size / 600,
      farm = poi('hoofington'),
      mountain = poi('mt-gigga'),
      pier = boardwalkPierDecks(island).filter((p) => p.kind === 'pier');
    const berth = (side: number) => {
      const deck =
        pier
          .filter(
            (p) =>
              gridSample(island, p.transform.position.x + side * (p.size.x / 2 + 6), p.transform.position.z) <
              island.seaLevel - 1,
          )
          .sort((a, b) => a.transform.position.z - b.transform.position.z)[0] ?? pier.at(-1)!;
      const p = deck.transform.position;
      return {
        home: { x: p.x + side * (deck.size.x / 2 + 7), y: island.seaLevel, z: p.z },
        stop: { x: p.x + side * (deck.size.x / 2 - 1.8), y: p.y + deck.size.y / 2, z: p.z },
      };
    };
    const west = berth(-1),
      east = berth(1);
    const meadow = openGround(farm.x - 15 * k, farm.z + 40 * k, 4);
    const lower = openGround(mountain.x - 45 * k, mountain.z + 65 * k, 3);
    this.summit = openGround(mountain.x + 6 * k, mountain.z + 4 * k, 2.2);
    const craft = (kind: Ride, home: Vec3, stop: Vec3, heading: number): Craft => ({
      kind,
      home,
      stop,
      position: { ...home },
      heading,
      homeHeading: heading,
      speed: 0,
      vertical: 0,
      bank: 0,
      pitch: 0,
    });
    const upper = this.summit;
    this.craft = {
      boat: craft('boat', west.home, west.stop, -Math.PI / 2),
      plane: craft('plane', east.home, east.stop, Math.PI / 2),
      balloon: craft('balloon', meadow, meadow, 0.3),
      tram: craft('tram', lower, lower, Math.atan2(upper.x - lower.x, lower.z - upper.z)),
    };
    let lift = 6 * k;
    for (let i = 1; i < 64; i++) {
      const t = i / 64,
        x = lower.x + (upper.x - lower.x) * t,
        z = lower.z + (upper.z - lower.z) * t;
      const floor = Math.max(gridSample(island, x, z), this.top(x, z, 1.2));
      // Level access at both platforms, with clearance under the middle of the span.
      lift = Math.max(
        lift,
        (floor + Math.min(3, Math.min(t, 1 - t) * 32) - (lower.y + (upper.y - lower.y) * t)) /
          cableProfile(t),
      );
    }
    this.cableLift = lift;
  }

  private top(x: number, z: number, r: number, ceiling = Infinity): number {
    let y = -Infinity;
    for (const b of this.obstacles.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell)) ?? []) {
      if (b.breakableId && this.destroyed?.has(b.breakableId)) continue;
      if (Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r && b.base < ceiling)
        y = Math.max(y, b.top);
    }
    return y;
  }

  cablePoint(t: number): Vec3 {
    const a = this.craft.tram.home,
      b = this.summit;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t + cableProfile(t) * this.cableLift,
      z: a.z + (b.z - a.z) * t,
    };
  }

  station(p: Vec3): Ride | null {
    for (const id of rideIds) {
      const c = this.craft[id];
      const stops = id === 'tram' ? [c.stop, this.summit] : [c.stop, this.moored[id] ?? c.stop];
      if (stops.some((s) => distance(p, s) < 4.6 && Math.abs(p.y - s.y) < 4)) return id;
    }
    return null;
  }
  board(id: Ride, from?: Vec3): void {
    this.trials.clear();
    const c = this.craft[id];
    if (id === 'tram') {
      this.cableT = from && distance(from, this.summit) < distance(from, c.stop) ? 1 : 0;
      this.cableGoal = 1 - this.cableT;
      Object.assign(c.position, this.cablePoint(this.cableT));
    } else if (!from || !this.moored[id] || distance(from, this.moored[id]!) > 4.6)
      Object.assign(c.position, c.home);
    delete this.moored[id];
    this.active = id;
    c.heading = c.homeHeading;
    c.speed = c.vertical = c.pitch = c.bank = 0;
    this.note = '';
  }
  seat(): Vec3 {
    const c = this.craft[this.active!];
    return { ...c.position, y: c.position.y + seatHeight[c.kind] };
  }
  instruments(): string {
    if (!this.active) return '';
    const c = this.craft[this.active];
    if (c.kind === 'tram') {
      const destination = this.cableGoal ? 'Summit' : 'Foothills';
      const remaining = Math.ceil(
        (Math.abs(this.cableGoal - this.cableT) * distance(c.home, this.summit)) / 10,
      );
      return (
        destination +
        ' · ' +
        (remaining ? remaining + ' s' : 'At platform') +
        ' · ' +
        Math.round(c.position.y - this.island.seaLevel) +
        ' m'
      );
    }
    const speed = Math.round(Math.abs(c.speed) * 3.6) + ' km/h';
    const altitude = Math.round(c.position.y - this.island.seaLevel) + ' m';
    const target =
      c.kind === 'boat'
        ? { name: 'Marina', center: c.home }
        : this.island.pois.reduce((nearest, poi) =>
            distance(c.position, poi.center) < distance(c.position, nearest.center) ? poi : nearest,
          );
    const bearing = Math.atan2(target.center.x - c.position.x, c.position.z - target.center.z);
    const direction = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
      (Math.round(bearing / (Math.PI / 4)) + 8) % 8
    ];
    const range = Math.round(distance(c.position, target.center));
    const beacon =
      target.name +
      (range < 8
        ? c.kind === 'boat'
          ? ' · at berth'
          : ' · overhead'
        : ' ' + direction + ' ' + range + ' m');
    return [speed, ...(c.kind === 'boat' ? [] : [altitude]), beacon].join(' · ');
  }
  controls(pad: boolean, time: number, ride = this.active): string {
    if (ride === this.active && this.note && time < this.noteUntil) return this.note;
    switch (ride) {
      case 'boat':
        return pad ? 'Stick to throttle and steer' : 'W/S throttle · A/D steer';
      case 'plane':
        return pad
          ? 'Stick throttle/turn · A climb · RB descend'
          : 'W/S throttle · A/D turn · Space climb · Shift descend';
      case 'balloon':
        return pad
          ? 'Stick trim · A burn · RB vent'
          : 'WASD trim · Space burn · Shift vent';
      default:
        return this.cableT === this.cableGoal
          ? 'Arrived · ' + (pad ? 'X' : 'E') + ' to step out'
          : 'Riding to the ' + (this.cableGoal ? 'summit' : 'foothills');
    }
  }
  private say(text: string, time: number) {
    this.note = text;
    this.noteUntil = time + 2;
  }
  tick(dt: number, input: PlayerIntent, sea: number, time: number): number {
    if (!this.active) return 0;
    const c = this.craft[this.active],
      p = c.position;
    if (c.kind === 'tram') {
      const span = distance(c.home, this.summit);
      this.cableT = approach(this.cableT, this.cableGoal, (dt * 10) / Math.max(1, span));
      c.speed = this.cableT === this.cableGoal ? 0 : 10;
      Object.assign(p, this.cablePoint(this.cableT));
      return 0;
    }
    const turn = clamp(input.moveX ?? 0, -1, 1),
      drive = clamp(input.moveZ ?? 0, -1, 1);
    const vertical = Number(!!(input.glide || input.jump)) - Number(!!input.sprint);
    const ground = gridSample(this.island, p.x, p.z),
      floor = Math.max(ground, sea);
    const airborne = p.y - floor > 0.7;
    let dx: number, dz: number;
    if (c.kind === 'balloon') {
      c.vertical = approach(c.vertical, vertical * 6, dt * 2.8);
      const aloft = p.y > ground + 0.55 || c.vertical > 0.3;
      const yaw = input.cameraYaw ?? c.heading;
      dx = aloft ? Math.sin(yaw) * drive * 7 + Math.cos(yaw) * turn * 7 + 1.9 + Math.sin(time * 0.06) : 0;
      dz = aloft ? -Math.cos(yaw) * drive * 7 + Math.sin(yaw) * turn * 7 - 0.9 : 0;
      c.speed = Math.hypot(dx, dz);
      c.bank = approach(c.bank, turn * 0.065, dt * 0.3);
    } else {
      const boat = c.kind === 'boat',
        max = boat ? 19 : 38;
      c.speed = approach(
        c.speed,
        drive > 0 ? max * drive : drive < 0 ? (boat ? -6 : 0) : boat ? 0 : c.speed,
        dt * (drive < 0 ? 10 : drive > 0 ? 7 : 2.8),
      );
      c.heading +=
        turn *
        dt *
        (boat ? 1.55 : airborne ? 0.95 : 0.72) *
        clamp(Math.abs(c.speed) / 5, 0.18, 1) *
        (c.speed < 0 ? -1 : 1);
      c.bank = approach(c.bank, turn * (boat ? 0.1 : airborne ? 0.43 : 0), dt * 0.9);
      c.vertical = boat ? 0 : approach(c.vertical, c.speed < 13 ? -4 : vertical * 10, dt * 5.5);
      c.pitch = approach(c.pitch, boat ? 0 : c.vertical * 0.025, dt * 0.55);
      dx = Math.sin(c.heading) * c.speed;
      dz = -Math.cos(c.heading) * c.speed;
    }
    const limit = this.island.size * 0.72,
      nx = clamp(p.x + dx * dt, -limit, limit),
      nz = clamp(p.z + dz * dt, -limit, limit);
    if (Math.abs(p.x + dx * dt) > limit || Math.abs(p.z + dz * dt) > limit) {
      this.say('Edge of island chart · turn back toward shore', time);
    }
    const terrain = gridSample(this.island, nx, nz);
    const blocked =
      c.kind === 'boat'
        ? terrain > sea - 0.35 || this.top(nx, nz, 1.15, sea + 1.3) > sea + 0.1
        : this.top(nx, nz, c.kind === 'plane' ? 2.5 : 1, p.y + 1.8) > p.y + 0.45 || terrain > p.y + 0.8;
    if (blocked) {
      c.speed = 0;
      this.say(
        c.kind === 'boat'
          ? 'Shallows or pier ahead · reverse to turn'
          : 'Obstacle ahead · climb or turn away',
        time,
      );
    } else {
      p.x = nx;
      p.z = nz;
    }
    const roof = this.top(p.x, p.z, c.kind === 'plane' ? 2.5 : 1, p.y + 1);
    const groundBelow = blocked ? ground : terrain;
    const below = Math.max(sea, groundBelow, c.kind === 'boat' ? -Infinity : roof);
    p.y = c.kind === 'boat' ? sea : clamp(p.y + c.vertical * dt, below, (165 * this.island.size) / 600);
    if (p.y <= below + 0.01 && c.vertical < 0) {
      c.vertical = 0;
      c.pitch = 0;
    }
    return this.trials.tick(c, dt, groundBelow, sea);
  }

  private landing(c: Craft, sea: number): Vec3 | string {
    const p = c.position;
    if (c.kind === 'tram') {
      if (this.cableT === 0) return c.stop;
      if (this.cableT === 1) return this.summit;
      return 'Step out when the cabin reaches a platform';
    }
    if (Math.abs(c.speed) > 8 || p.y > Math.max(gridSample(this.island, p.x, p.z), sea) + 2.4)
      return 'Slow down and land to get out · Pause for station return';
    if (distance(p, c.home) < 11 && Math.abs(p.y - c.home.y) < 3) return c.stop;
    for (const r of [2.8, 4.5, 7, 10]) {
      for (let i = 0; i < 16; i++) {
        const a = c.heading + (i * Math.PI) / 8;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const y = gridSample(this.island, x, z);
        if (y > sea + .22 && Math.abs(y - p.y) < 2.8 && this.top(x, z, .7) < y + .25) return {x,y,z};
      }
    }
    return 'Bring the craft closer to a dry shore';
  }

  canDisembark(sea: number): boolean {
    return this.active !== null && typeof this.landing(this.craft[this.active], sea) !== 'string';
  }

  exit(sea: number, time: number, returnHome = false): Vec3 | null {
    if (!this.active) return null;
    const c = this.craft[this.active];
    const exit = returnHome ? c.stop : this.landing(c, sea);
    if (typeof exit === 'string') {
      this.say(exit, time);
      return null;
    }
    this.trials.clear();
    this.active = null;
    this.note = '';
    if (c.kind !== 'tram' && !returnHome && exit !== c.stop) this.moored[c.kind] = { ...exit };
    else if (c.kind !== 'tram' || returnHome) {
      Object.assign(c.position, c.home);
      c.heading = c.homeHeading;
      c.speed = c.bank = c.pitch = 0;
      if (c.kind === 'tram') this.cableT = 0;
    }
    c.speed = c.vertical = c.bank = c.pitch = 0;
    return { ...exit };
  }
}
