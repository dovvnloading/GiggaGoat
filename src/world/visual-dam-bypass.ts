import * as THREE from 'three';
import { roadRibbonData } from './road-ribbons';
import { gridSample } from './terrain';
import type { DamPlacement } from './the-dam';
import type { IslandData, Vec3 } from './types';

// A two-way guide from the board side, around the ramp toe and back to the
// open road. Coordinates are local to the outer corner of the ramp.
const LOWER_ROAD_BENDS = [
  [1.45, .70], [.85, -.15], [-.75, -.72], [-4.55, -1.38], [-11, -3.25],
] as const;

/** Paint the lower branch on the same triangles that support walking. */
export function buildDamBypassPaint(island: IslandData, rampToe: Vec3,
  { position: origin, scale }: DamPlacement): THREE.Mesh | undefined {
  const ribbon = roadRibbonData(island, 'road');
  const pavement = new THREE.BufferGeometry();
  pavement.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.positions, 3));
  pavement.setIndex(ribbon.supportIndices);
  const material = new THREE.MeshBasicMaterial({ color: 0xffedc5 });
  const road = new THREE.Mesh(pavement, material);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const bends = LOWER_ROAD_BENDS.map(([x, z]) => new THREE.Vector2(rampToe.x + x * scale, rampToe.z + z * scale));
  const positions: number[] = [];
  const spacing = 1.55 * scale;
  const length = .88 * scale;
  let distance = 0;
  let fits = true;
  for (let i = 1; i < bends.length; i++) {
    const start = bends[i - 1]!;
    const delta = bends[i]!.clone().sub(start);
    const segmentLength = delta.length();
    const tangent = delta.divideScalar(segmentLength);
    const across = new THREE.Vector2(-tangent.y, tangent.x).multiplyScalar(.12 * scale);
    const edge = (along: number, side: number): number[] => {
      const x = start.x + along * tangent.x + side * across.x;
      const z = start.y + along * tangent.y + side * across.y;
      ray.ray.origin.set(x, rampToe.y + 30 * scale, z);
      const hit = ray.intersectObject(road)[0];
      fits &&= hit !== undefined && hit.point.y >= gridSample(island, x, z);
      return [
        (x - origin.x) / scale,
        ((hit?.point.y ?? rampToe.y) - origin.y) / scale + .024,
        (z - origin.z) / scale,
      ];
    };
    for (let dash = Math.floor(distance / spacing) * spacing;
      dash < distance + segmentLength; dash += spacing) {
      const from = Math.max(0, dash - distance);
      const to = Math.min(segmentLength, dash + length - distance);
      if (to - from < .025 * scale) continue;
      const slices = Math.ceil((to - from) / (.26 * scale));
      let left = edge(from, -1);
      let right = edge(from, 1);
      for (let slice = 1; slice <= slices; slice++) {
        const end = THREE.MathUtils.lerp(from, to, slice / slices);
        const nextLeft = edge(end, -1);
        const nextRight = edge(end, 1);
        positions.push(...left, ...right, ...nextLeft, ...right, ...nextRight, ...nextLeft);
        left = nextLeft;
        right = nextRight;
      }
    }
    distance += segmentLength;
  }
  pavement.dispose();
  // Omit the guide if a different island seed places the lane off pavement.
  if (!fits) {
    material.dispose();
    return;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const paint = new THREE.Mesh(geometry, material);
  paint.name = 'dam-lower-road-guide';
  return paint;
}
