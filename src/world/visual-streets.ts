import * as THREE from 'three';
import type { IslandData, RoadDescriptor } from './types';
import { gridIndex, gridSample } from './terrain';
import { makeLocalStreets } from './roads';
import { TOON_RAMP } from './visual-props';
import { paintHoofingtonVerge } from './surface-paint';

/**
 * Paint the far Hoofington zebra directly above the graded road slabs.
 * Seven 0.5 m-wide bars separated by 0.5 m gaps share one BufferGeometry
 * and one draw call (unlike seven individual boxes/instances).
 */
function buildHoofingtonZebraCrossing(
  road: RoadDescriptor, centre: { x: number; z: number }, scale: number,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const stripeWidth = 0.5 * scale;
  const stripePitch = 1.0 * scale;
  const crossingZ = centre.z - 18 * scale;
  const left = centre.x - road.width / 2;
  const right = centre.x + road.width / 2;

  // The asphalt in buildRoads sits 0.20 m above the graded centreline;
  // 0.02 m clearance and polygon offset avoid coplanar flicker.
  function surfaceY(z: number): number {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      if (z <= b.z || i === road.points.length - 1) {
        const t = THREE.MathUtils.clamp((z - a.z) / (b.z - a.z), 0, 1);
        return THREE.MathUtils.lerp(a.y, b.y, t) + 0.22;
      }
    }
    return road.points[road.points.length - 1]!.y + 0.22;
  }

  for (let i = 0; i < 7; i++) {
    const z = crossingZ + (i - 3) * stripePitch;
    const near = z - stripeWidth / 2, far = z + stripeWidth / 2;
    const base = positions.length / 3;
    positions.push(
      left, surfaceY(near), near,
      right, surfaceY(near), near,
      left, surfaceY(far), far,
      right, surfaceY(far), far,
    );
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hoofington-zebra-crossing';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Shared vertices along each grade interval keep adjoining surfaces flush. */
function buildHoofingtonVerge(
  island: IslandData, road: RoadDescriptor, group: THREE.Group, scale: number,
): void {
  const edge = road.width / 2;
  const profiles = [
    { from: edge + .36 * scale, to: edge + 2.34 * scale,
      color: 0xdcd4ba, surface: 1, y: (x: number, z: number) => gridSample(island, x, z) + .04 * scale },
    { from: edge + .022 * scale, to: edge + .36 * scale,
      color: 0xf2e6ce, surface: 2, skirt: true,
      y: (_x: number, _z: number, roadY: number) => roadY + .20 + .08 * scale },
    { from: edge - .39 * scale, to: edge - .30 * scale,
      color: 0xf2e9cf, surface: 0, y: (_x: number, _z: number, roadY: number) => roadY + .214 },
  ];
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const section: number[] = [];
  for (const profile of profiles) {
    const startVertex = positions.length / 3;
    const across = (offset: number): number =>
      (Math.abs(offset) - profile.from) / (profile.to - profile.from);
    for (const side of [-1, 1]) {
      const first = positions.length / 3;
      const left = side < 0 ? -profile.to : profile.from;
      const right = side < 0 ? -profile.from : profile.to;
      for (const point of road.points) {
        for (const offset of [left, right]) {
          const x = point.x + offset;
          positions.push(x, profile.y(x, point.z, point.y), point.z);
          section.push(across(offset), profile.surface);
        }
      }
      for (let i = 1; i < road.points.length; i++) {
        const a = first + (i - 1) * 2, b = a + 2;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
      if (profile.skirt) for (const offset of [left, right]) {
        const start = positions.length / 3;
        for (const point of road.points) {
          const x = point.x + offset;
          positions.push(x, profile.y(x, point.z, point.y), point.z,
            x, gridSample(island, x, point.z) - .04 * scale, point.z);
          section.push(across(offset), profile.surface, across(offset), profile.surface);
        }
        for (let i = 1; i < road.points.length; i++) {
          const a = start + (i - 1) * 2, b = a + 2;
          if (offset === left) indices.push(a, a + 1, b, a + 1, b + 1, b);
          else indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const color = new THREE.Color(profile.color);
    for (let i = startVertex; i < positions.length / 3; i++) colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('hoofingtonVerge', new THREE.Float32BufferAttribute(section, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_RAMP });
  paintHoofingtonVerge(material, scale);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hoofington-street-verge';
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** The near terrain mesh uses two planar faces rather than a bilinear height. */
function groundTriangle(island: IslandData, x: number, z: number): number {
  const { resolution: n, size, heights } = island;
  const gx = (x / size + .5) * (n - 1), gz = (z / size + .5) * (n - 1);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const u = gx - ix, v = gz - iz;
  const a = heights[gridIndex(n, ix, iz)]!, b = heights[gridIndex(n, ix + 1, iz)]!;
  const c = heights[gridIndex(n, ix, iz + 1)]!, d = heights[gridIndex(n, ix + 1, iz + 1)]!;
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

interface StreetSurface { positions: number[]; indices: number[] }
type StreetRow = readonly [z: number, x0: number, y0: number, x1: number, y1: number];

function appendStreetStrip(surface: StreetSurface, rows: readonly StreetRow[], reverse: boolean): void {
  const first = surface.positions.length / 3;
  for (const [z, x0, y0, x1, y1] of rows) surface.positions.push(x0, y0, z, x1, y1, z);
  for (let i = 1; i < rows.length; i++) {
    const a = first + (i - 1) * 2, b = a + 2;
    if (reverse) surface.indices.push(a, a + 1, b, a + 1, b + 1, b);
    else surface.indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
}

function appendStreetEnd(surface: StreetSurface, top: StreetRow, base: StreetRow, reverse: boolean): void {
  const first = surface.positions.length / 3;
  for (const [z, x0, y0, x1, y1] of [top, base]) surface.positions.push(x0, y0, z, x1, y1, z);
  const b = first + 1, c = first + 2, d = first + 3;
  if (reverse) surface.indices.push(first, c, b, b, c, d);
  else surface.indices.push(first, b, c, b, d, c);
}

function downtownMaterial(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: TOON_RAMP,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
}

function downtownRoadIntervals(road: RoadDescriptor) {
  return road.points.slice(1).map((b, index) => {
    const a = road.points[index]!;
    return { length: b.z - a.z, z: a.z, y: a.y + .20, grade: (b.y - a.y) / (b.z - a.z) };
  });
}

function downtownRoadStations(road: RoadDescriptor, intervals = downtownRoadIntervals(road)) {
  return [...intervals.flatMap(({ z, y, grade, length }) => [0, 1 / 3, 2 / 3].map(t => ({
    z: z + length * t, asphalt: y + grade * length * t,
  }))), { z: road.points.at(-1)!.z, asphalt: road.points.at(-1)!.y + .20 }];
}

/** Literal outer mesh edge, shared with the abutting shopfront paving. */
export function downtownSidewalkEdge(island: IslandData, road: RoadDescriptor, side: -1 | 1,
  stations = downtownRoadStations(road)) {
  const scale = island.size / 600;
  const x = road.points[0]!.x + side * (road.width / 2 + 2.34 * scale);
  const points = stations.map(({ z }) => {
    const ground = groundTriangle(island, x, z);
    return { z, ground, y: ground + .055 * scale };
  });
  return { x, points };
}

/** Extend each grade through the adjoining curb, sidewalk, and pavement paint. */
function buildDowntownVerge(island: IslandData, road: RoadDescriptor, group: THREE.Group, scale: number): void {
  const kerb: StreetSurface = { positions: [], indices: [] };
  const walk: StreetSurface = { positions: [], indices: [] };
  const lines: StreetSurface = { positions: [], indices: [] };
  const edge = road.width / 2;
  const centre = road.points[0]!;
  // The local asphalt's plane is piecewise linear with a fixed 20 cm surface lift.
  const intervals = downtownRoadIntervals(road);
  // Three spans per street interval keep the outer paving fitted to the bank.
  const stations = downtownRoadStations(road, intervals);
  for (const side of [-1, 1] as const) {
    const inner = centre.x + side * (edge + .02 * scale);
    const seam = centre.x + side * (edge + .36 * scale);
    const { x: outer, points } = downtownSidewalkEdge(island, road, side, stations);
    const reverse = side < 0;
    const rows = points.map(({ z, ground, y }, i) => {
      const { asphalt } = stations[i]!;
      const curbGround = groundTriangle(island, inner, z);
      const seamGround = groundTriangle(island, seam, z);
      const top = Math.max(asphalt + .105 * scale, curbGround + .055 * scale, seamGround + .055 * scale);
      return { z, top, base: Math.min(asphalt, curbGround) - .04 * scale,
        paving: top - .025 * scale, outerTop: y, outerBase: ground - .03 * scale };
    });
    appendStreetStrip(kerb, rows.map(({ z, top }) => [z, inner, top, seam, top]), reverse);
    appendStreetStrip(kerb, rows.map(({ z, top, base }) => [z, inner, base, inner, top]), reverse);
    appendStreetStrip(kerb, rows.map(({ z, top, paving }) => [z, seam, top, seam, paving]), reverse);
    appendStreetStrip(walk, rows.map(({ z, paving, outerTop }) => [z, seam, paving, outer, outerTop]), reverse);
    appendStreetStrip(walk, rows.map(({ z, outerTop, outerBase }) => [z, outer, outerTop, outer, outerBase]), reverse);
    for (const [south, row] of [[false, rows[0]!], [true, rows.at(-1)!]] as const) {
      const { z, top, base, paving, outerTop, outerBase } = row;
      const baseSeam = Math.min(paving, groundTriangle(island, seam, z) - .03 * scale);
      appendStreetEnd(kerb, [z, inner, top, seam, top], [z, inner, base, seam, paving], reverse !== south);
      appendStreetEnd(walk, [z, seam, paving, outer, outerTop],
        [z, seam, baseSeam, outer, outerBase], reverse !== south);
    }

    // Preserve the original breaks in the paint, including at the street mouths.
    const paint = centre.x + side * (edge - .35 * scale);
    const halfLine = .0425 * scale;
    for (const { z, y, grade, length } of intervals) {
      const gap = .065 * scale;
      const stripe = [gap, length - gap].map((s): StreetRow =>
        [z + s, paint - halfLine, y + grade * s + .017 * scale,
          paint + halfLine, y + grade * s + .017 * scale]);
      appendStreetStrip(lines, stripe, false);
    }
  }
  for (const [surface, name, color] of [
    [walk, 'paved-village-sidewalks', 0xdcd4ba], [kerb, 'raised-stone-curbs', 0xf2e6ce],
    [lines, 'two-lane-edge-stripes', 0xf2e9cf],
  ] as const) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
    geometry.setIndex(surface.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, downtownMaterial(color));
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

export function buildStreetDetails(island: IslandData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'two-lane-streets-and-sidewalks';
  const scale = island.size / 600;
  for (const road of makeLocalStreets(island)) {
    const centre = island.pois.find(p => p.id === road.from)!.center;
    if (road.from === 'hoofington') {
      buildHoofingtonVerge(island, road, group, scale);
      group.add(buildHoofingtonZebraCrossing(road, centre, scale));
      continue;
    }
    buildDowntownVerge(island, road, group, scale);
    const crossings = new THREE.InstancedMesh(new THREE.BoxGeometry(), downtownMaterial(0xfaf3dc), 21);
    crossings.name = 'hoofington-and-city-crosswalks';
    crossings.receiveShadow = true;
    const transform = new THREE.Matrix4().makeScale(road.width / 10, .022 * scale, .47 * scale);
    let index = 0;
    for (const offset of [-27, 7, 29]) for (let lane = -3; lane <= 3; lane++) {
      const x = centre.x + lane * road.width / 8, z = centre.z + offset * scale;
      transform.setPosition(x, gridSample(island, x, z) + .224 * scale, z);
      crossings.setMatrixAt(index++, transform);
    }
    crossings.instanceMatrix.needsUpdate = true;
    crossings.computeBoundingSphere();
    group.add(crossings);
  }
  return group;
}
