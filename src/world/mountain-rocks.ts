import { Box3, Triangle, Vector3 } from 'three';
import { roadRibbonData } from './road-ribbons';
import { makeGradedBridgeColliders } from './roads';
import { gridSample } from './terrain';
import type { IslandData, PropDescriptor, Vec2, Vec3 } from './types';

interface TrailFace {
  triangle: Triangle;
  bounds: Box3;
}

const SEARCH_RADIUS = 15.4;
const STEP = .35;
const OFFSET_LIMIT = Math.round(SEARCH_RADIUS / STEP);
const SITE_OFFSETS = Array.from({ length: (OFFSET_LIMIT * 2 + 1) ** 2 }, (_, i) => {
  const span = OFFSET_LIMIT * 2 + 1;
  const x = (i % span - OFFSET_LIMIT) * STEP;
  const z = (Math.floor(i / span) - OFFSET_LIMIT) * STEP;
  return { x, z, distance: Math.hypot(x, z) };
}).filter(({ distance }) => distance > 0 && distance <= SEARCH_RADIUS);

function toWorld(position: Vec3, yaw: number, x: number, z: number): Vec2 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: position.x + x * c + z * s, z: position.z - x * s + z * c };
}

function mountainTrailFaces(island: IslandData): TrailFace[] {
  const faces: TrailFace[] = [];
  const add = (a: Vector3, b: Vector3, c: Vector3) => {
    faces.push({ triangle: new Triangle(a, b, c), bounds: new Box3().setFromPoints([a, b, c]) });
  };
  const { positions, supportIndices } = roadRibbonData(island, 'trail');
  const vertex = (i: number) => new Vector3(positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!);
  for (let i = 0; i < supportIndices.length; i += 3) {
    add(vertex(supportIndices[i]!), vertex(supportIndices[i + 1]!), vertex(supportIndices[i + 2]!));
  }
  const bridgePrefixes = island.roads.filter(road => road.from === 'mt-gigga' || road.to === 'mt-gigga')
    .map(road => 'bridge-' + road.id + '-');
  const gradedDecks = makeGradedBridgeColliders(island);
  for (const bridge of island.props) {
    if (bridge.kind !== 'bridge' || !bridgePrefixes.some(prefix => bridge.id.startsWith(prefix))) continue;
    const graded = gradedDecks.get(bridge.id);
    const { position, rotationY } = graded?.transform ?? bridge.transform;
    const vertices = graded?.vertices;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], index) => {
      if (vertices) {
        // Each graded corner stores its top vertex followed by its bottom vertex.
        const i = index * 6;
        return new Vector3(position.x + vertices[i]!, position.y + vertices[i + 1]!, position.z + vertices[i + 2]!);
      }
      const point = toWorld(position, rotationY, x! * bridge.size.x / 2, z! * bridge.size.z / 2);
      return new Vector3(point.x, position.y + bridge.size.y / 2, point.z);
    });
    add(corners[0]!, corners[1]!, corners[2]!);
    add(corners[1]!, corners[2]!, corners[3]!);
  }
  return faces;
}

function crossesTrail(faces: readonly TrailFace[], rock: PropDescriptor,
  position: Vec3, margin: number): boolean {
  const x = rock.size.x / 2 + margin;
  const z = rock.size.z / 2 + margin;
  const low = -rock.size.y / 2 - 1.6;
  const high = rock.size.y / 2 + .13;
  const { rotationY } = rock.transform;
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  const width = Math.abs(c) * x + Math.abs(s) * z;
  const depth = Math.abs(s) * x + Math.abs(c) * z;
  const box = new Box3(new Vector3(-x, low, -z), new Vector3(x, high, z));
  const local = new Triangle();
  const intoRock = (point: Vector3, target: Vector3) => {
    const dx = point.x - position.x, dz = point.z - position.z;
    target.set(dx * c - dz * s, point.y - position.y, dx * s + dz * c);
  };
  return faces.some(({ triangle, bounds }) => {
    if (position.x + width < bounds.min.x || position.x - width > bounds.max.x ||
      position.z + depth < bounds.min.z || position.z - depth > bounds.max.z ||
      position.y + high < bounds.min.y || position.y + low > bounds.max.y) return false;
    intoRock(triangle.a, local.a);
    intoRock(triangle.b, local.b);
    intoRock(triangle.c, local.c);
    return box.intersectsTriangle(local);
  });
}

function touchesScenery(rock: PropDescriptor, position: Vec3, other: PropDescriptor, gap: number): boolean {
  if (rock === other) return false;
  const { position: at, rotationY: yaw } = other.transform;
  const dx = at.x - position.x, dz = at.z - position.z;
  if (Math.abs(at.y - position.y) >= (rock.size.y + other.size.y) / 2 ||
    Math.hypot(dx, dz) >= (Math.hypot(rock.size.x, rock.size.z) + Math.hypot(other.size.x, other.size.z)) / 2 + gap) {
    return false;
  }
  const rotation = rock.transform.rotationY;
  const widthOn = (size: Vec3, rotated: number, axis: number): number =>
    (size.x * Math.abs(Math.cos(rotated - axis)) + size.z * Math.abs(Math.sin(rotated - axis))) / 2;
  return [rotation, rotation + Math.PI / 2, yaw, yaw + Math.PI / 2].every(axis =>
    Math.abs(dx * Math.cos(axis) - dz * Math.sin(axis)) <
      widthOn(rock.size, rotation, axis) + widthOn(other.size, yaw, axis) + gap);
}

function seatIsSupported(island: IslandData, rock: PropDescriptor, position: Vec3,
  ground: number, scale: number): boolean {
  let supported = 0;
  for (const x of [-.3, .3]) {
    for (const z of [-.3, .3]) {
      const point = toWorld(position, rock.transform.rotationY, x * rock.size.x, z * rock.size.z);
      const height = gridSample(island, point.x, point.z);
      if (height > ground - .9 * scale && height < ground + rock.size.y * .6) supported++;
    }
  }
  return supported >= 2;
}

/** Move only rocks intruding into the mountain trail's standing and shoulder space. */
export function clearMountainRocks(island: IslandData): void {
  const summit = island.pois.find(poi => poi.id === 'mt-gigga')?.center;
  if (!summit) return;
  const scale = island.size / 600;
  const faces = mountainTrailFaces(island);
  const solids = island.props.filter(prop => prop.collidable && prop.body.type === 'static');
  const foliage = solids.filter(prop => prop.poiId === 'mt-gigga' &&
    (prop.kind === 'tree-pine' || prop.kind === 'bush')).map(prop => prop.transform.position);
  const moves = solids.filter(prop => prop.poiId === 'mt-gigga' && prop.kind === 'rock' &&
    crossesTrail(faces, prop, prop.transform.position, .32 * scale));
  for (const rock of moves) {
    const origin = rock.transform.position;
    const originGround = gridSample(island, origin.x, origin.z);
    const originRadius = Math.hypot(origin.x - summit.x, origin.z - summit.z);
    const range = SEARCH_RADIUS * scale + Math.hypot(rock.size.x, rock.size.z);
    const nearby = faces.filter(({ bounds }) => bounds.min.x <= origin.x + range && bounds.max.x >= origin.x - range &&
      bounds.min.z <= origin.z + range && bounds.max.z >= origin.z - range);
    let best: Vec3 | undefined;
    let bestScore = Infinity;
    for (const offset of SITE_OFFSETS) {
      const distance = offset.distance * scale;
      if (distance >= bestScore) continue;
      const x = origin.x + offset.x * scale;
      const z = origin.z + offset.z * scale;
      const ground = gridSample(island, x, z);
      const rise = ground - originGround;
      const score = distance + Math.abs(rise) * 1.5;
      if (score >= bestScore || Math.abs(rise) > 4 * scale ||
        Math.abs(Math.hypot(x - summit.x, z - summit.z) - originRadius) > 10 * scale) continue;
      const candidate = { x, y: origin.y + rise, z };
      if (foliage.some(point => Math.hypot(point.x - x, point.z - z) < 5 * scale) ||
        crossesTrail(nearby, rock, candidate, .50 * scale) ||
        !seatIsSupported(island, rock, candidate, ground, scale) ||
        solids.some(other => touchesScenery(rock, candidate, other, .2 * scale))) continue;
      best = candidate;
      bestScore = score;
    }
    if (best) rock.transform.position = best;
  }
}
