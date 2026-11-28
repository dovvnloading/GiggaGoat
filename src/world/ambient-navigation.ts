import { BufferGeometry, Float32BufferAttribute, Mesh, type Group, type Material } from 'three';
import { downtownPublicSpaceAt, downtownPublicSpaces } from './downtown-public-space';
import { makeDowntownPlacements } from './visual-downtown';
import { buildStreetDetails } from './visual-streets';
import { buildGroundDetails } from './visual-ground';
import { meshSurfaceHeight } from './visual-tide-routes';
import { roadRibbonData } from './road-ribbons';
import { terrainFaceHeight } from './terrain';
export { terrainFaceHeight as ambientTerrainHeight } from './terrain';
import kitCollision from './district-kit-collision.json';
import type { IslandData, Vec2, Vec3 } from './types';

/** Pedestrians never turn a decorative object into a new physics obstacle. */
export interface AmbientBlocker {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly yaw: number;
  readonly bottom: number;
  readonly top: number;
}
export interface AmbientNavNode { readonly id: number; readonly position: Vec3; readonly neighbors: number[]; readonly component: number }
export interface AmbientNavigation {
  readonly nodes: readonly AmbientNavNode[];
  readonly blockers: readonly AmbientBlocker[];
  readonly scale: number;
  readonly radius: number;
  readonly height: number;
  readonly surfaceAt: (x: number, z: number) => number;
  readonly walkableAt: (x: number, z: number, margin?: number) => boolean;
  readonly exclusions: readonly { position: Vec3; radius: number }[];
  readonly seaLevel: number;
}

/** Extract the actual rendered pavement triangles once, then release temporary meshes.
 * The retained sampler contains numeric triangles, no GPU resources. This follows
 * the sidewalk grades, frontage slabs and road crossings instead of guessing a lift. */
function makeSurfaceSampler(island: IslandData): (x: number, z: number) => number {
  const streets = buildStreetDetails(island), ground = buildGroundDetails(island);
  const geometries: BufferGeometry[] = [];
  const surfaces: { geometry: BufferGeometry; x: number; z: number }[] = [];
  for (const group of [streets, ground]) group.traverse(object => {
    if (object instanceof Mesh && ['paved-village-sidewalks', 'raised-stone-curbs',
      'ground-detail-city-frontages'].includes(object.name)) {
      surfaces.push({ geometry: object.geometry, x: object.position.x, z: object.position.z });
    }
  });
  const ribbons = roadRibbonData(island, 'road');
  const roads = new BufferGeometry();
  roads.setAttribute('position', new Float32BufferAttribute(ribbons.positions, 3));
  roads.setIndex(ribbons.supportIndices);
  surfaces.push({ geometry: roads, x: 0, z: 0 });
  geometries.push(roads);
  const pavedHeight = meshSurfaceHeight(surfaces, island.size / 600);
  const dispose = (group: Group): void => {
    const materials = new Set<Material>();
    group.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      // Shared palette textures belong to the renderer, not this temporary mesh.
      if ('dispose' in object && typeof object.dispose === 'function') object.dispose();
    });
    for (const material of materials) material.dispose();
    group.clear();
  };
  dispose(streets); dispose(ground); geometries.forEach(g => g.dispose());
  return (x, z) => Math.max(terrainFaceHeight(island, x, z), pavedHeight(x, z));
}

function nearDowntown(island: IslandData, x: number, z: number, halfX: number, halfZ: number): boolean {
  const city = island.pois.find(p => p.id === 'downtown-bleatsville')!.center, scale = island.size / 600;
  return Math.abs(x - city.x) < 38 * scale + halfX && Math.abs(z - city.z) < 70 * scale + halfZ;
}

/** Includes art-only furniture as well as colliders. Trimeshes are bottom aligned;
 * their actual vertex bounds prevent treating a high roof as a ground obstruction. */
export function ambientBlockers(island: IslandData): AmbientBlocker[] {
  const result: AmbientBlocker[] = [];
  const add = (id: string, position: Vec3, size: Vec3, yaw: number, bottom = position.y - size.y / 2,
    top = position.y + size.y / 2): void => {
    if (!nearDowntown(island, position.x, position.z, size.x / 2, size.z / 2)) return;
    result.push({ id, x: position.x, z: position.z, halfX: size.x / 2, halfZ: size.z / 2, yaw, bottom, top });
  };
  for (const prop of island.props) {
    if (['flower', 'grass-tuft', 'mushroom'].includes(prop.kind)) continue;
    add(prop.id, prop.transform.position, prop.size, prop.transform.rotationY);
  }
  for (const collider of island.colliders) {
    if (collider.shape === 'heightfield' || collider.id.startsWith('kit-')) continue;
    const p = collider.transform.position;
    let bottom = p.y - collider.size.y / 2, top = p.y + collider.size.y / 2;
    if (collider.vertices && !collider.transform.rotationX) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 1; i < collider.vertices.length; i += 3) {
        lo = Math.min(lo, collider.vertices[i]!); hi = Math.max(hi, collider.vertices[i]!);
      }
      bottom = p.y + lo; top = p.y + hi;
    }
    add('collider:' + collider.id, p, collider.size, collider.transform.rotationY, bottom, top);
  }
  for (const [index, place] of makeDowntownPlacements(island).entries()) {
    if (place.source || /^flower/.test(place.model)) continue;
    add('art:' + place.model + ':' + index, place.position, place.size, place.yaw);
  }
  for (const set of island.districtSets ?? []) for (const [index, piece] of set.pieces.entries()) {
    const span = kitCollision[piece.model].span;
    add('set:' + set.name + ':' + index, piece.bottom,
      { x: span[0]! * piece.length, y: span[1]! * piece.length, z: span[2]! * piece.length },
      piece.yaw, piece.bottom.y, piece.bottom.y + span[1]! * piece.length);
  }
  return result;
}

/** Exact conservative swept disc/OBB rejection. A tiny obstacle between height
 * samples is still caught; expanded rectangles intentionally err toward omission. */
export function ambientSegmentIntersectsBlocker(a: Vec2, b: Vec2, blocker: AmbientBlocker, radius: number): boolean {
  const c = Math.cos(blocker.yaw), s = Math.sin(blocker.yaw);
  const ax = c * (a.x - blocker.x) - s * (a.z - blocker.z);
  const az = s * (a.x - blocker.x) + c * (a.z - blocker.z);
  const bx = c * (b.x - blocker.x) - s * (b.z - blocker.z);
  const bz = s * (b.x - blocker.x) + c * (b.z - blocker.z);
  let enter = 0, exit = 1;
  for (const [start, delta, half] of [[ax, bx - ax, blocker.halfX + radius], [az, bz - az, blocker.halfZ + radius]]) {
    if (Math.abs(delta!) < 1e-10) { if (Math.abs(start!) > half!) return false; }
    else {
      const u = (-half! - start!) / delta!, v = (half! - start!) / delta!;
      enter = Math.max(enter, Math.min(u, v)); exit = Math.min(exit, Math.max(u, v));
      if (enter > exit) return false;
    }
  }
  return true;
}

function segmentPointDistance(a: Vec2, b: Vec2, p: Vec2): number {
  const x = b.x - a.x, z = b.z - a.z, lengthSq = x * x + z * z;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.z - a.z) * z) / lengthSq)) : 0;
  return Math.hypot(a.x + x * t - p.x, a.z + z * t - p.z);
}

/** Cheap continuous runtime support check. Static obstacle clearance is already
 * proved for the complete route segments, including any local yielding detour. */
export function isAmbientFootSupported(nav: AmbientNavigation, position: Vec3): boolean {
  const { x, y, z } = position, radius = nav.radius;
  if (!Number.isFinite(x + y + z)) return false;
  if (!nav.walkableAt(x, z, radius) || y < nav.seaLevel + .2 * nav.scale) return false;
  for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]])
    if (Math.abs(nav.surfaceAt(x + dx!, z + dz!) - y) > radius * .62 + .12 * nav.scale) return false;
  return true;
}

export function isAmbientSegmentSafe(nav: AmbientNavigation, a: Vec3, b: Vec3,
  radius = nav.radius, height = nav.height, tideLevel = nav.seaLevel): boolean {
  if (!Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z + radius + height + tideLevel) || radius < 0 || height <= 0) return false;
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(distance / (.035 * nav.scale)));
  let low = Infinity, high = -Infinity, previous = nav.surfaceAt(a.x, a.z);
  for (let step = 0; step <= steps; step++) {
    const t = step / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    // The domain has concave joins where a crossing meets a sidewalk. Reserve
    // half a sample diagonal so a shortcut cannot clip a narrow corner between
    // samples even though both endpoints are inside the walking footprint.
    if (!nav.walkableAt(x, z, radius + (distance > 1e-8 ? .18 * nav.scale : 0))) return false;
    const y = nav.surfaceAt(x, z);
    if (!Number.isFinite(y) || y < tideLevel + .2 * nav.scale) return false;
    // Small paving/kerb lips are intentional; sustained steep grades are not.
    if (step && Math.abs(y - previous) > distance / steps * .52 + .12 * nav.scale) return false;
    for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      if (Math.abs(nav.surfaceAt(x + dx!, z + dz!) - y) > radius * .62 + (distance > 1e-8 ? .08 : .12) * nav.scale) return false;
    }
    low = Math.min(low, y); high = Math.max(high, y); previous = y;
  }
  if (Math.abs(b.y - a.y) > distance * .5 + .14 * nav.scale) return false;
  for (const item of nav.exclusions) {
    if (item.position.y > high + height || item.position.y < low - .8 * nav.scale) continue;
    if (segmentPointDistance(a, b, item.position) < item.radius + radius) return false;
  }
  for (const blocker of nav.blockers) {
    if (blocker.top <= low + .13 * nav.scale || blocker.bottom >= high + height + .08 * nav.scale) continue;
    if (ambientSegmentIntersectsBlocker(a, b, blocker, radius)) return false;
  }
  return true;
}

/** A finite street/court graph, independently seeded from island generation.
 * Only authored crossings join the two sidewalks. Invalid cells and isolated
 * components are omitted; there is no fallback path through scenery. */
export function createAmbientNavigation(island: IslandData, excluded: readonly Vec2[] = []): AmbientNavigation {
  const scale = island.size / 600, city = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const spaces = downtownPublicSpaces(island).filter(s => !s.id.endsWith('lane'));
  const surfaceAt = makeSurfaceSampler(island);
  const contains = (x: number, z: number): boolean => {
    const dx = (x - city.x) / scale, dz = (z - city.z) / scale, ax = Math.abs(dx);
    if (downtownPublicSpaceAt(spaces, x, z)) return true;
    if (ax >= 4.91 && ax <= 13.74 && Math.abs(dz) <= 43) return true;
    if (ax <= 6.2 && [-27, 7, 29].some(crossing => Math.abs(dz - crossing) <= 1.8)) return true;
    // Short approaches join the main street to the actual painted courts.
    if (dx >= -13.74 && dx <= -6.7 && dz >= -55 && dz <= -40) return true;
    if (dx >= 6.7 && dx <= 15 && dz >= 40 && dz <= 57) return true;
    return false;
  };
  const walkableAt = (x: number, z: number, margin = 0): boolean => {
    if (!contains(x, z)) return false;
    const diagonal = margin * Math.SQRT1_2;
    for (const [dx, dz] of [[margin, 0], [-margin, 0], [0, margin], [0, -margin],
      [diagonal, diagonal], [-diagonal, diagonal], [diagonal, -diagonal], [-diagonal, -diagonal]])
      if (!contains(x + dx!, z + dz!)) return false;
    return true;
  };
  const nodes: AmbientNavNode[] = [];
  const exclusions = [
    ...island.spawns.map(p => ({ position: p.position, radius: 2.2 * scale })),
    ...island.relics.map(p => ({ position: p.position, radius: 1.3 * scale })),
    ...excluded.map(p => ({ position: { ...p, y: 'y' in p && typeof p.y === 'number' ? p.y : surfaceAt(p.x, p.z) }, radius: 2.4 * scale })),
  ];
  const nav: AmbientNavigation = { nodes, blockers: ambientBlockers(island), exclusions,
    scale, radius: .43 * scale, height: 1.95 * scale, seaLevel: island.seaLevel, surfaceAt, walkableAt };
  const cells = new Map<string, number>(), spacing = .9 * scale;
  for (let iz = -67; iz <= 74; iz++) for (let ix = -33; ix <= 38; ix++) {
    const x = city.x + ix * spacing, z = city.z + iz * spacing;
    if (!walkableAt(x, z, nav.radius)) continue;
    const position = { x, y: surfaceAt(x, z), z };
    if (!isAmbientSegmentSafe(nav, position, position)) continue;
    const id = nodes.length; nodes.push({ id, position, neighbors: [], component: -1 }); cells.set(ix + ',' + iz, id);
  }
  for (const [key, id] of cells) {
    const [ix, iz] = key.split(',').map(Number), node = nodes[id]!;
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
      const otherId = cells.get((ix! + dx!) + ',' + (iz! + dz!));
      if (otherId === undefined) continue;
      const other = nodes[otherId]!;
      if (!isAmbientSegmentSafe(nav, node.position, other.position)) continue;
      node.neighbors.push(otherId); other.neighbors.push(id);
    }
  }
  // A low-resolution/small island can have a genuinely unsafe crossing grade.
  // Preserve useful independent neighborhoods, then restrict every itinerary
  // to one connected component. Never repair a disconnected route by clipping.
  const seen = new Set<number>(), components: number[][] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const component = [node.id]; seen.add(node.id);
    for (let i = 0; i < component.length; i++) for (const neighbor of nodes[component[i]!]!.neighbors) {
      if (!seen.has(neighbor)) { seen.add(neighbor); component.push(neighbor); }
    }
    if (component.length >= 24) components.push(component);
  }
  const membership = new Map(components.flatMap((component, i) => component.map(id => [id, i] as const)));
  const keep = components.flat().sort((a, b) => a - b), retained = new Map(keep.map((id, i) => [id, i]));
  return { ...nav, nodes: keep.map(id => ({ id: retained.get(id)!, position: nodes[id]!.position,
    component: membership.get(id)!, neighbors: nodes[id]!.neighbors.flatMap(n => retained.has(n) ? [retained.get(n)!] : []) })) };
}

export function nearestAmbientNode(nav: AmbientNavigation, position: Vec2, limit = Infinity, component?: number): number | undefined {
  let nearest: number | undefined, distance = limit * limit;
  for (const node of nav.nodes) {
    if (component !== undefined && node.component !== component) continue;
    const d = (node.position.x - position.x) ** 2 + (node.position.z - position.z) ** 2;
    if (d < distance) { nearest = node.id; distance = d; }
  }
  return nearest;
}

/** A* uses bounded authored nodes. Straight-line pruning only removes corners
 * when the complete swept capsule passes the same clearance gate. */
export function findAmbientPath(nav: AmbientNavigation, from: number, to: number): number[] {
  if (!nav.nodes[from] || !nav.nodes[to]) return [];
  if (nav.nodes[from]!.component !== nav.nodes[to]!.component) return [];
  if (from === to) return [from];
  const scores = new Float64Array(nav.nodes.length).fill(Infinity), parents = new Int32Array(nav.nodes.length).fill(-1);
  const closed = new Uint8Array(nav.nodes.length), open: { id: number; score: number }[] = [];
  const target = nav.nodes[to]!.position;
  const heuristic = (id: number): number => Math.hypot(nav.nodes[id]!.position.x - target.x, nav.nodes[id]!.position.z - target.z);
  const push = (entry: { id: number; score: number }): void => {
    let i = open.length; open.push(entry);
    while (i > 0) { const parent = (i - 1) >>> 1; if (open[parent]!.score <= entry.score) break;
      open[i] = open[parent]!; i = parent; } open[i] = entry;
  };
  const pop = (): number => {
    const first = open[0]!, last = open.pop()!;
    if (open.length) { let i = 0; while (i * 2 + 1 < open.length) {
      let child = i * 2 + 1; if (child + 1 < open.length && open[child + 1]!.score < open[child]!.score) child++;
      if (open[child]!.score >= last.score) break; open[i] = open[child]!; i = child;
    } open[i] = last; } return first.id;
  };
  scores[from] = 0; push({ id: from, score: heuristic(from) });
  while (open.length) {
    const id = pop(); if (closed[id]) continue; closed[id] = 1;
    if (id === to) {
      const path = [to]; let at = to;
      while (at !== from) { at = parents[at]!; if (at < 0) return []; path.push(at); }
      path.reverse();
      // Collinear edges have already passed the identical swept clearance gate.
      // Collapse those runs first instead of probing dozens of long shortcuts
      // per node (a weather transition used to create an avoidable CPU spike).
      const turns = [from]; let lastX = 0, lastZ = 0;
      for (let i = 1; i < path.length; i++) {
        const a = nav.nodes[path[i - 1]!]!.position, b = nav.nodes[path[i]!]!.position;
        const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
        if (i > 1 && (dx !== lastX || dz !== lastZ)) turns.push(path[i - 1]!);
        lastX = dx; lastZ = dz;
      }
      turns.push(to);
      return turns;
    }
    for (const next of nav.nodes[id]!.neighbors) {
      if (closed[next]) continue;
      const a = nav.nodes[id]!.position, b = nav.nodes[next]!.position;
      const score = scores[id]! + Math.hypot(b.x - a.x, b.z - a.z);
      if (score < scores[next]!) { scores[next] = score; parents[next] = id; push({ id: next, score: score + heuristic(next) }); }
    }
  }
  return [];
}
