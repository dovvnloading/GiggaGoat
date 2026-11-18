import * as THREE from 'three';
import type { IslandData, RoadDescriptor } from './types';
import { gridSample } from './terrain';
import { makeLocalStreets } from './roads';
import { TOON_RAMP } from './visual-props';

interface StreetPiece {
  x: number; y: number; z: number;
  width: number; height: number; length: number; yaw: number;
}

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
    { name: 'hoofington-sidewalks', from: edge + .36 * scale, to: edge + 2.34 * scale,
      color: 0xdcd4ba, y: (x: number, z: number) => gridSample(island, x, z) + .04 * scale },
    { name: 'hoofington-curbs', from: edge + .022 * scale, to: edge + .36 * scale,
      color: 0xf2e6ce, skirt: true,
      y: (_x: number, _z: number, roadY: number) => roadY + .20 + .08 * scale },
    { name: 'hoofington-edge-lines', from: edge - .39 * scale, to: edge - .30 * scale,
      color: 0xf2e9cf, y: (_x: number, _z: number, roadY: number) => roadY + .214 },
  ];
  for (const profile of profiles) {
    const positions: number[] = [], indices: number[] = [];
    for (const side of [-1, 1]) {
      const first = positions.length / 3;
      const left = side < 0 ? -profile.to : profile.from;
      const right = side < 0 ? -profile.from : profile.to;
      for (const point of road.points) {
        for (const offset of [left, right]) {
          const x = point.x + offset;
          positions.push(x, profile.y(x, point.z, point.y), point.z);
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
        }
        for (let i = 1; i < road.points.length; i++) {
          const a = start + (i - 1) * 2, b = a + 2;
          if (offset === left) indices.push(a, a + 1, b, a + 1, b + 1, b);
          else indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({
      color: profile.color, gradientMap: TOON_RAMP,
    }));
    mesh.name = profile.name;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/**
 * The road mesh itself is a 6.8-m two-lane carriageway in Hoofington.
 * Curbs, walkways, edge lines and zebra crossings sit beside/on that mesh,
 * not on top of it as a single enormous flat asphalt polygon.
 *
 * One instanced draw per surface type: no per-slab mesh/draw-call explosion.
 */
export function buildStreetDetails(island: IslandData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'two-lane-streets-and-sidewalks';
  const scale = island.size / 600;
  const kerbs: StreetPiece[] = [];
  const walkways: StreetPiece[] = [];
  const edges: StreetPiece[] = [];
  const crossings: StreetPiece[] = [];

  for (const road of makeLocalStreets(island)) {
    const centre = island.pois.find(p => p.id === road.from)!.center;
    if (road.from === 'hoofington') {
      buildHoofingtonVerge(island, road, group, scale);
      group.add(buildHoofingtonZebraCrossing(road, centre, scale));
      continue;
    }
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      const yaw = Math.atan2(dx, dz);
      const normalX = Math.cos(yaw), normalZ = -Math.sin(yaw);
      const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
      for (const side of [-1, 1]) {
        const offset = road.width / 2 + 0.19 * scale;
        const curbX = midX + side * offset * normalX;
        const curbZ = midZ + side * offset * normalZ;
        kerbs.push({ x: curbX, y: gridSample(island, curbX, curbZ) + 0.20 * scale,
          z: curbZ, width: 0.34 * scale, height: 0.28 * scale,
          length: length + 0.05 * scale, yaw });
        const walkOffset = road.width / 2 + 1.32 * scale;
        const pathX = midX + side * walkOffset * normalX;
        const pathZ = midZ + side * walkOffset * normalZ;
        walkways.push({ x: pathX, y: gridSample(island, pathX, pathZ) + 0.12 * scale,
          z: pathZ, width: 1.98 * scale, height: 0.09 * scale,
          length: length + 0.06 * scale, yaw });
        const lineOffset = road.width / 2 - 0.35 * scale;
        edges.push({
          x: midX + side * lineOffset * normalX,
          y: (a.y + b.y) / 2 + 0.218 * scale,
          z: midZ + side * lineOffset * normalZ,
          width: 0.085 * scale, height: 0.018 * scale,
          length: Math.max(0.1, length - 0.13 * scale), yaw,
        });
      }
    }

    // Painted, climb-free crossings are separated from the house-front lawns.
    for (const offset of [-27, 7, 29]) {
      const z = centre.z + offset * scale;
      for (let lane = -3; lane <= 3; lane++) {
        const x = centre.x + lane * road.width / 8;
        crossings.push({
          x, y: gridSample(island, x, z) + 0.224 * scale, z,
          width: road.width / 10, height: 0.022 * scale,
          length: 0.47 * scale, yaw: 0,
        });
      }
    }
  }

  const shape = new THREE.BoxGeometry(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const transform = new THREE.Matrix4(), rotate = new THREE.Quaternion();
  const position = new THREE.Vector3(), size = new THREE.Vector3();
  function render(pieces: StreetPiece[], name: string, color: number): void {
    if (pieces.length === 0) return;
    const material = new THREE.MeshToonMaterial({
      color, gradientMap: TOON_RAMP, polygonOffset: true,
      polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const mesh = new THREE.InstancedMesh(shape, material, pieces.length);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      position.set(piece.x, piece.y, piece.z);
      size.set(piece.width, piece.height, piece.length);
      rotate.setFromAxisAngle(up, piece.yaw);
      transform.compose(position, rotate, size);
      mesh.setMatrixAt(i, transform);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  render(walkways, 'paved-village-sidewalks', 0xdcd4ba);
  render(kerbs, 'raised-stone-curbs', 0xf2e6ce);
  render(edges, 'two-lane-edge-stripes', 0xf2e9cf);
  render(crossings, 'hoofington-and-city-crosswalks', 0xfaf3dc);
  return group;
}
