import { expect, it } from 'vitest';
import type { Vec3 } from './types';
import { generateIsland } from './island';
import { makeLocalStreets } from './roads';
import { gridSample } from './terrain';
import { makeHoofingtonPlacements } from './visual-hoofington';

interface Placed {
  id: string;
  kind: string;
  position: Vec3;
  size: Vec3;
  yaw: number;
}

const BUILDINGS = new Set(['house', 'cottage', 'barn', 'silo', 'windmill']);
const GARDEN = new Set(['fence', 'mailbox', 'lamp', 'flower', 'bush', 'planter']);

/** The four real corners, not an unrotated or circular approximation. */
function corners(item: Placed): Array<{ x: number; z: number }> {
  const c = Math.cos(item.yaw), s = Math.sin(item.yaw);
  const result: Array<{ x: number; z: number }> = [];
  for (const x of [-item.size.x / 2, item.size.x / 2]) {
    for (const z of [-item.size.z / 2, item.size.z / 2]) {
      result.push({
        x: item.position.x + c * x + s * z,
        z: item.position.z - s * x + c * z,
      });
    }
  }
  return result;
}

/** Separating axis theorem for yaw-rotated rectangular footprints. */
function overlaps(a: Placed, b: Placed): boolean {
  const aa = corners(a), bb = corners(b);
  for (const angle of [a.yaw, b.yaw]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const axis of [{ x: c, z: -s }, { x: s, z: c }]) {
      const project = (p: { x: number; z: number }): number =>
        p.x * axis.x + p.z * axis.z;
      const aValues = aa.map(project), bValues = bb.map(project);
      // Exactly touching faces are clear; disregard floating-point roundoff.
      if (Math.max(...aValues) <= Math.min(...bValues) + 1e-5 ||
          Math.max(...bValues) <= Math.min(...aValues) + 1e-5) return false;
    }
  }
  return true;
}

function label(p: Placed): string {
  const v = p.position;
  return p.kind + ' ' + p.id + ' @ (' +
    v.x.toFixed(2) + ', ' + v.y.toFixed(2) + ', ' + v.z.toFixed(2) + ')';
}

it('keeps all Hoofington buildings and garden art grounded, separate and off the carriageway', () => {
  const island = generateIsland({ seed: 'billy-isle' });
  const visual = makeHoofingtonPlacements(island);

  // Physical sources appear in the art plan by reference. Check each only once,
  // while retaining art-only scatter and physical props without library art.
  const represented = new Set(visual.flatMap(p => p.source ? [p.source.id] : []));
  const placed: Placed[] = visual.map((p, index) => ({
    id: p.source?.id ?? 'art-' + p.model + '-' + index,
    kind: p.source?.kind ?? (p.model.startsWith('oak') ? 'tree-oak' :
      p.model === 'pine' ? 'tree-pine' :
      p.model.startsWith('flower') ? 'flower' :
      p.model.startsWith('bush') ? 'bush' : p.model),
    position: p.position, size: p.size, yaw: p.yaw,
  }));
  for (const p of island.props) {
    if (p.poiId !== 'hoofington' || represented.has(p.id)) continue;
    placed.push({
      id: p.id, kind: p.kind, position: p.transform.position,
      size: p.size, yaw: p.transform.rotationY,
    });
  }

  // Physical asphalt follows the actual road segments (including the bends
  // of the two POI approach roads), not an infinitely long axis-aligned slab.
  const streets = [
    ...makeLocalStreets(island).filter(r => r.from === 'hoofington'),
    ...island.roads.filter(r => r.type === 'road' &&
      (r.from === 'hoofington' || r.to === 'hoofington')),
  ];
  const carriageway: Placed[] = [];
  for (const street of streets) {
    for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1]!, b = street.points[i]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      carriageway.push({
        id: street.id, kind: 'carriageway',
        position: { x: (a.x + b.x) / 2, y: 0, z: (a.z + b.z) / 2 },
        size: { x: street.width, y: 0, z: length },
        yaw: Math.atan2(dx, dz),
      });
    }
  }

  const buildings = placed.filter(p => BUILDINGS.has(p.kind));
  const garden = placed.filter(p => GARDEN.has(p.kind) || p.kind.startsWith('tree-'));
  expect(buildings.length).toBeGreaterThan(5);
  expect(garden.length).toBeGreaterThan(20);
  const failures: string[] = [];

  for (const p of placed) {
    const base = p.position.y - p.size.y / 2;
    const ground = gridSample(island, p.position.x, p.position.z);
    const delta = base - ground;
    if (delta > 0.05 + 1e-5 || delta < -0.15 - 1e-5) {
      failures.push(label(p) + ' vs terrain: base ' + delta.toFixed(3) +
        ' m relative to ground (' + ground.toFixed(3) + ' m)');
    }
  }
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      if (overlaps(buildings[i]!, buildings[j]!)) {
        failures.push(label(buildings[i]!) + ' overlaps ' + label(buildings[j]!));
      }
    }
  }
  for (const p of garden) {
    for (const building of buildings) {
      if (overlaps(p, building))
        failures.push(label(p) + ' overlaps ' + label(building));
    }
  }
  for (const p of [...buildings, ...garden]) {
    // One report per carriageway, not one per tessellated road segment.
    for (const street of streets) {
      const segments = carriageway.filter(r => r.id === street.id && overlaps(p, r));
      if (segments.length) {
        failures.push(label(p) + ' overlaps carriageway ' + street.id +
          ' at segment(s) ' + segments.map(r =>
            '(' + r.position.x.toFixed(2) + ',' + r.position.z.toFixed(2) +
            ', length ' + r.size.z.toFixed(2) + ')').join(', '));
      }
    }
  }

  if (failures.length) {
    throw new Error('Hoofington geometry QA found ' + failures.length +
      ' placement issue(s):\n' + failures.join('\n'));
  }
});
