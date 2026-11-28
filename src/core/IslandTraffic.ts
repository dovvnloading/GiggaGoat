import type { RigidBody } from '@dimforge/rapier3d-compat';
import { PhysicsWorld, RAPIER, collisionGroups, type Vec3 } from '../physics';
import type { IslandData } from '../world/types';
import { islandTrafficLanes, type DrivingPose, type TrafficLane } from '../world/traffic-lanes';
import type { HappeningSite } from './IslandHappenings';
import type { TrafficEmitter } from '../audio/TrafficAudio';
import type { RecordPlayback } from './NoniSession';

export type FleetModel =
  | 'delivery'
  | 'van'
  | 'taxi'
  | 'tractor'
  | 'firetruck'
  | 'garbage-truck'
  | 'ambulance'
  | 'sedan-sports'
  | 'hatchback-sports'
  | 'suv'
  | 'truck';
type Stop = 'village' | 'pier' | 'city' | 'pines' | 'dam' | 'bakery' | 'records';
type Livery = 'post' | 'bakery' | 'records' | 'express';
interface Service {
  name: string;
  model: FleetModel;
  origin: Stop;
  offset: number;
  lane: 0 | 1;
  cruise: number;
  stops: Stop[];
  livery?: Livery;
}
const SERVICES: readonly Service[] = [
  {
    name: 'Island Post',
    model: 'delivery',
    origin: 'village',
    offset: -24,
    lane: 0,
    cruise: 8.1,
    stops: ['village', 'city', 'pines'],
    livery: 'post',
  },
  {
    name: 'EAP’s Bakery',
    model: 'delivery',
    origin: 'bakery',
    offset: -34,
    lane: 1,
    cruise: 7.9,
    stops: ['bakery', 'pier', 'village'],
    livery: 'bakery',
  },
  {
    name: 'Noni’s Metal Records',
    model: 'delivery',
    origin: 'records',
    offset: 23,
    lane: 0,
    cruise: 8.4,
    stops: ['records', 'pier'],
    livery: 'records',
  },
  {
    name: 'Cape Express',
    model: 'van',
    origin: 'village',
    offset: -35,
    lane: 1,
    cruise: 8.8,
    stops: ['village', 'pier', 'city', 'pines'],
    livery: 'express',
  },
  {
    name: 'Meter cab',
    model: 'taxi',
    origin: 'pier',
    offset: 32,
    lane: 1,
    cruise: 9.8,
    stops: ['city', 'pier'],
  },
  {
    name: 'Orchard tractor',
    model: 'tractor',
    origin: 'village',
    offset: 43,
    lane: 0,
    cruise: 6.3,
    stops: ['village', 'pines'],
  },
  {
    name: 'Island fire brigade',
    model: 'firetruck',
    origin: 'dam',
    offset: -15,
    lane: 1,
    cruise: 8.2,
    stops: ['dam', 'city'],
  },
  {
    name: 'Kerbside recycling',
    model: 'garbage-truck',
    origin: 'city',
    offset: -27,
    lane: 0,
    cruise: 7.2,
    stops: ['village', 'pier', 'city'],
  },
  {
    name: 'Coast ambulance',
    model: 'ambulance',
    origin: 'pines',
    offset: -38,
    lane: 0,
    cruise: 9.1,
    stops: ['city'],
  },
  { name: 'Harbour GT', model: 'sedan-sports', origin: 'pier', offset: -68, lane: 0, cruise: 10.4, stops: [] },
  {
    name: 'Hillclimb hatch',
    model: 'hatchback-sports',
    origin: 'dam',
    offset: 89,
    lane: 0,
    cruise: 10.1,
    stops: [],
  },
  {
    name: 'Pines trail crew',
    model: 'suv',
    origin: 'pines',
    offset: -12,
    lane: 1,
    cruise: 8.5,
    stops: ['pines', 'dam'],
  },
  { name: 'Dock pickup', model: 'truck', origin: 'dam', offset: -143, lane: 0, cruise: 8.7, stops: ['pier'] },
  {
    name: 'Village cab',
    model: 'taxi',
    origin: 'city',
    offset: 112,
    lane: 1,
    cruise: 9.6,
    stops: ['city', 'village'],
  },
  {
    name: 'Coastal sport',
    model: 'sedan-sports',
    origin: 'pines',
    offset: 164,
    lane: 1,
    cruise: 10.2,
    stops: [],
  },
  {
    name: 'Harbour rally',
    model: 'hatchback-sports',
    origin: 'pier',
    offset: 179,
    lane: 1,
    cruise: 9.9,
    stops: [],
  },
];
/** Native chassis lengths and roof heights in the shipped Car Kit's metres. */
const DIMENSIONS: Record<FleetModel, readonly [number, number, number]> = {
  delivery: [1.5, 1.65, 3.25],
  van: [1.5, 1.35, 2.75],
  taxi: [1.5, 1.25, 2.75],
  tractor: [1.34, 1.5, 2.3],
  firetruck: [1.5, 1.65, 3.4],
  'garbage-truck': [1.6, 1.6, 3.5],
  ambulance: [1.5, 1.8, 3.25],
  'sedan-sports': [1.3, 1.08, 2.55],
  'hatchback-sports': [1.3, 1.1, 2.85],
  suv: [1.5, 1.3, 2.55],
  truck: [1.5, 1.3, 2.95],
};
export interface TrafficVehicle {
  readonly service: Service;
  readonly lane: TrafficLane;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly length: number;
  readonly stops: readonly number[];
  readonly pose: DrivingPose;
  readonly previous: DrivingPose;
  distance: number;
  odometer: number;
  lastStep: number;
  speed: number;
  braking: boolean;
  stopIndex: number;
  nextStopAt: number;
  dwell: number;
  hailed: number;
  answeredAt: number;
  serviceCount: number;
  body?: RigidBody;
}
export interface TrafficObstacle {
  position: Vec3;
  radius: number;
  height: number;
}
interface Tick {
  enabled: boolean;
  player: TrafficObstacle;
  residents: readonly { position: Vec3; radius: number; height: number }[];
  obstacles: readonly TrafficObstacle[];
  seaLevel: number;
  wet: number;
}
const blankPose = (): DrivingPose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, curvature: 0 });

export class IslandTraffic {
  readonly lanes: TrafficLane[];
  readonly vehicles: TrafficVehicle[] = [];
  readonly scale: number;
  enabled = true;
  private readonly ahead = blankPose();
  private time = 0;

  constructor(
    island: IslandData,
    sites: readonly HappeningSite[],
    private readonly physics?: PhysicsWorld
  ) {
    this.scale = island.size / 600;
    this.lanes = islandTrafficLanes(island);
    if (this.lanes.length !== 2) return;
    const poi = (id: string) => island.pois.find((p) => p.id === id)!.center;
    const town = poi('downtown-bleatsville');
    const village = poi('hoofington');
    const stops = {
      village,
      pier: poi('baa-ardwalk'),
      city: town,
      dam: poi('the-dam'),
      pines: poi('whispering-pines'),
      bakery: sites.find((s) => s.definition.id === 'honey-rolls')?.position ?? village,
      records: sites.find((s) => s.definition.id === 'needle-drop')?.position ?? town,
    };
    for (const service of SERVICES) {
      const lane = this.lanes[service.lane]!,
        scale = 1.22 * this.scale;
      let distance = lane.ahead(0, lane.nearest(stops[service.origin]) + service.offset * this.scale);
      // Seed variants can put two stops closer together. Keep a clear initial headway.
      while (
        this.vehicles.some(
          (car) =>
            car.lane === lane &&
            Math.min(lane.ahead(car.distance, distance), lane.ahead(distance, car.distance)) < 12 * this.scale
        )
      )
        distance = lane.ahead(0, distance + 13 * this.scale);
      const pose = lane.sample(distance, blankPose());
      const schedule = [...new Set(service.stops.map((stop) => lane.nearest(stops[stop])))].sort(
        (a, b) => a - b
      );
      const [width, height, length] = DIMENSIONS[service.model];
      const stopIndex = Math.max(
        0,
        schedule.findIndex((s) => s > distance)
      );
      const car: TrafficVehicle = {
        service,
        lane,
        scale,
        width: width * scale,
        height: height * scale,
        length: length * scale,
        stops: schedule,
        pose,
        previous: { ...pose },
        distance,
        odometer: 0,
        lastStep: 0,
        speed: service.cruise * this.scale,
        braking: false,
        stopIndex,
        nextStopAt: schedule.length ? lane.ahead(distance, schedule[stopIndex]!) : Infinity,
        dwell: 0,
        hailed: 0,
        answeredAt: -Infinity,
        serviceCount: 0,
      };
      this.vehicles.push(car);
    }
  }

  /** A close bleat gets one driver's acknowledgement. Dispatches and cabs pause for the caller. */
  driverNear(p: Vec3, range = 13 * this.scale): TrafficVehicle | undefined {
    if (!this.enabled) return;
    let nearest: TrafficVehicle | undefined;
    for (const car of this.vehicles) {
      const d = Math.hypot(car.pose.x - p.x, car.pose.z - p.z, car.pose.y + car.height * 0.5 - p.y);
      if (d < range) {
        nearest = car;
        range = d;
      }
    }
    return nearest;
  }
  hail(p: Vec3): boolean {
    const nearest = this.driverNear(p);
    if (!nearest || this.time - nearest.answeredAt <= 9) return false;
    nearest.answeredAt = this.time;
    nearest.hailed = nearest.service.livery || nearest.service.model === 'taxi' ? 4 : 1.1;
    return true;
  }

  sounds(listener: Vec3): { emitters: TrafficEmitter[]; radio?: RecordPlayback } {
    const emitters: TrafficEmitter[] = [];
    let radio: RecordPlayback | undefined;
    if (this.enabled)
      for (const car of this.vehicles) {
        const p = car.pose,
          dx = listener.x - p.x,
          dz = listener.z - p.z,
          dy = listener.y - p.y - car.height * 0.45;
        const d = Math.hypot(dx, dz, dy) / this.scale;
        if (d >= 35) continue;
        const gain = (1 - d / 35) ** 2,
          age = this.time - car.answeredAt;
        const heavy = ['delivery', 'garbage-truck', 'tractor', 'firetruck', 'truck'].includes(
          car.service.model
        );
        const speed = car.speed / this.scale,
          approach = (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / Math.max(1, d * this.scale);
        emitters.push({
          id: car.service.name,
          position: p,
          engine: heavy ? 'diesel' : 'motor',
          gain,
          rate: (heavy ? 0.77 : 0.89) + speed * 0.041 + 0.067 * approach,
          acknowledgement: age < 0.7 ? car.answeredAt : undefined,
        });
        if (car.service.livery === 'records' && age < 9 && d < 17)
          radio = { side: 1, age, gain: 0.56 * (1 - d / 17) ** 2 };
      }
    emitters.sort((a, b) => b.gain - a.gain);
    emitters.length = Math.min(2, emitters.length);
    return { emitters, radio };
  }

  step(dt: number, tick: Tick): void {
    this.time += dt;
    this.enabled = tick.enabled;
    const unit = this.scale;
    for (const car of this.vehicles) {
      const p = car.pose;
      Object.assign(car.previous, p);
      car.lastStep = 0;
      if (!tick.enabled) {
        if (car.body?.isEnabled()) car.body.setEnabled(false);
        continue;
      }
      const player = tick.player,
        dx = player.position.x - p.x,
        dz = player.position.z - p.z,
        near = dx * dx + dz * dz < 55 ** 2 * unit ** 2;
      const lane = car.lane;
      let gap = lane.length,
        leaderLength = 0;
      for (const other of this.vehicles) {
        if (other === car || other.lane !== lane) continue;
        const lead = lane.ahead(car.distance, other.distance);
        if (lead < gap) {
          gap = lead;
          leaderLength = other.length;
        }
      }
      const look = lane.sample(car.distance + Math.max(3 * unit, car.speed * 0.75), this.ahead);
      const curve = Math.max(Math.abs(p.curvature), Math.abs(look.curvature));
      const spacing = Math.min(1.16, 0.64 + gap / (310 * unit));
      let target = Math.min(
        car.service.cruise * unit * spacing * (1 - 0.21 * tick.wet),
        Math.sqrt((3.8 * unit) / Math.max(0.001, curve))
      );
      let clearance = gap - (car.length + leaderLength) * 0.5 - 2.8 * unit;
      // Look down the vehicle's own swept lane. Tall flyovers and the goat on a roof stay clear.
      const check = (pos: Vec3, radius: number, bottom: number, top: number) => {
        if (bottom > p.y + car.height - 0.18 * unit || top < p.y + 0.19 * unit) return;
        const dx = pos.x - p.x,
          dz = pos.z - p.z;
        const along = dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw);
        if (along < -0.15 * car.length || along > car.length + 22 * unit) return;
        const across = Math.abs(dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw));
        if (across > car.width * 0.5 + radius + 0.23 * unit) return;
        clearance = Math.min(clearance, along - car.length * 0.5 - radius - 0.85 * unit);
      };
      if (near) {
        check(
          player.position,
          player.radius,
          player.position.y - player.height * 0.4,
          player.position.y + player.height * 0.5
        );
        for (const actor of tick.residents)
          check(actor.position, actor.radius, actor.position.y, actor.position.y + actor.height);
        for (const obj of tick.obstacles)
          check(obj.position, obj.radius, obj.position.y - obj.height * 0.5, obj.position.y + obj.height * 0.5);
      }
      const stop = car.stops[car.stopIndex];
      if (car.dwell > 0) {
        car.dwell = Math.max(0, car.dwell - dt);
        target = 0;
      } else if (stop !== undefined) {
        const remaining = Math.max(0, car.nextStopAt - car.odometer);
        if (remaining < 0.14 * unit && car.speed < 0.55 * unit) {
          car.dwell = car.service.model === 'garbage-truck' ? 5 : 3.5;
          car.stopIndex = (car.stopIndex + 1) % car.stops.length;
          car.serviceCount++;
          target = 0;
          car.nextStopAt += lane.ahead(stop, car.stops[car.stopIndex]!) || lane.length;
        } else clearance = Math.min(clearance, remaining);
      }
      if (car.hailed > 0) {
        car.hailed = Math.max(0, car.hailed - dt);
        target = 0;
      }
      if (look.y < tick.seaLevel + 0.12 * unit) target = 0;
      const brake = 5.8 * unit;
      target = Math.min(target, Math.sqrt(2 * brake * Math.max(0, clearance - 0.035 * unit)));
      car.braking =
        car.speed > target + 0.22 * unit || car.dwell > 0 || car.hailed > 0 || clearance < 0.35 * unit;
      const previousSpeed = car.speed;
      car.speed += Math.min(2.1 * unit * dt, Math.max(-brake * dt, target - car.speed));
      car.lastStep = Math.min(Math.max(0, clearance), 0.5 * (car.speed + previousSpeed) * dt);
      if (car.lastStep + 0.00001 < car.speed * dt && clearance < 0.15 * unit) car.speed = car.lastStep / dt;
      car.distance = lane.ahead(0, car.distance + car.lastStep);
      car.odometer += car.lastStep;
      lane.sample(car.distance, p);
      this.moveBody(car, near, player);
    }
  }

  private moveBody(car: TrafficVehicle, near: boolean, player: TrafficObstacle): void {
    if (!this.physics) return;
    if (!near) {
      if (car.body?.isEnabled()) car.body.setEnabled(false);
      return;
    }
    const p = car.pose;
    const h = car.height,
      base = { x: p.x, y: p.y, z: p.z };
    const sy = Math.sin(p.yaw * 0.5),
      cy = Math.cos(p.yaw * 0.5),
      sp = Math.sin(p.pitch * 0.5),
      cp = Math.cos(p.pitch * 0.5);
    const rotation = { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
    // A re-enabled car must not sweep in from its previous location or materialize around the player.
    if (!car.body?.isEnabled()) {
      const dx = p.x - player.position.x,
        dz = p.z - player.position.z;
      if (
        Math.abs(dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) < car.width * 0.5 + player.radius &&
        Math.abs(dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) < car.length * 0.5 + player.radius &&
        Math.abs(p.y + h * 0.5 - player.position.y) < h * 0.5 + player.radius
      )
        return;
      if (!car.body) {
        car.body = this.physics.raw.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        this.physics.raw.createCollider(
          RAPIER.ColliderDesc.roundCuboid(car.width * 0.46, h * 0.42, car.length * 0.46, 0.065 * car.scale)
            .setTranslation(0, h * 0.52, 0)
            .setFriction(0.95)
            .setCollisionGroups(collisionGroups('terrain', 'goat')),
          car.body
        );
      }
      car.body.setTranslation(base, false);
      car.body.setRotation(rotation, false);
      car.body.setEnabled(true);
    }
    car.body.setNextKinematicTranslation(base);
    car.body.setNextKinematicRotation(rotation);
  }
  dispose(): void {
    for (const car of this.vehicles) if (car.body?.isValid()) this.physics?.removeBody(car.body);
    this.vehicles.length = 0;
  }
}
