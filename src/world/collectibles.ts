import type { IslandData, PoiId, PropDescriptor, RelicCategory, RelicSpot, SpawnPoint, Vec3 } from './types';
import { SeededRandom } from './random';
import { isPointInsideProps } from './layouts';
import { gridSample } from './terrain';

const COUNTS: ReadonlyArray<readonly [PoiId, number]> = [
  ['hoofington', 7], ['baa-ardwalk', 7], ['crane-yard', 6],
  ['downtown-bleatsville', 8], ['mt-gigga', 7],
  ['whispering-pines', 6], ['the-dam', 5], ['old-lighthouse', 4],
];

function clearPosition(island: IslandData, position: Vec3, margin = 0.25): boolean {
  return position.y > island.seaLevel + 0.4 &&
    position.y > gridSample(island, position.x, position.z) + 0.22 &&
    !isPointInsideProps(position, island.props, margin);
}

/** Safe, individually addressable goat starting positions near the farm square. */
export function makeSpawns(island: IslandData): SpawnPoint[] {
  const village = island.pois.find(p => p.id === 'hoofington')!.center;
  const offsets = [[0, 6], [4, 6], [-4, 6], [7, 10], [-7, 10], [0, 13], [9, 4], [-9, 4]];
  const scale = island.size / 600;
  return offsets.map(([ox, oz], i) => {
    for (let ring = 0; ring < 9; ring++) {
      const x = village.x + (ox! + ring * 1.6) * scale;
      const z = village.z + (oz! + ring * 0.9) * scale;
      const position = { x, z, y: gridSample(island, x, z) + 1.25 * scale };
      if (clearPosition(island, position, 0.6)) {
        return { id: 'spawn-' + i, poiId: 'hoofington', position, heading: -0.3 };
      }
    }
    throw new Error('Could not find collision-free village spawn ' + i);
  });
}

/** Fifty intentionally themed positions, with geometric rejection of buried/blocked spots. */
export function makeRelics(island: IslandData, rng: SeededRandom): RelicSpot[] {
  const relics: RelicSpot[] = [];
  const scale = island.size / 600;
  for (const [id, count] of COUNTS) {
    const poi = island.pois.find(p => p.id === id)!;
    const roofs = island.props.filter(p => p.poiId === id &&
      ['barn', 'house', 'shop', 'tower', 'booth', 'lighthouse'].includes(p.kind));
    const ledges = island.props.filter(p => p.poiId === id && ['ledge', 'platform'].includes(p.kind));
    const pier = island.props.find(p => p.poiId === id && p.kind === 'pier');
    for (let i = 0; i < count; i++) {
      let position: Vec3 | undefined;
      let category: RelicCategory = 'secret';
      let hint = 'Look beyond the main trail';
      if (id === 'baa-ardwalk' && i < 2 && pier) {
        // Under the walking deck, above the sea, between the support piles.
        const z = pier.transform.position.z + (i === 0 ? 13 : -13) * scale;
        const x = pier.transform.position.x + (i === 0 ? -2.2 : 2.2) * scale;
        position = { x, z, y: Math.max(1.3 * scale, gridSample(island, x, z) + 0.8 * scale) };
        category = 'under-pier';
        hint = 'Below the boardwalk planks';
      } else if (id === 'mt-gigga' && ledges.length) {
        const target = ledges[(i * 3) % ledges.length]!;
        const c = target.transform.position;
        position = { x: c.x, z: c.z, y: c.y + target.size.y / 2 + 1.1 * scale };
        category = 'cliff-ledge';
        hint = 'Take a break on a climbing shelf';
      } else if (roofs.length && i % 3 === 0) {
        const target = roofs[(i * 5) % roofs.length]!;
        const c = target.transform.position;
        position = { x: c.x, z: c.z, y: c.y + target.size.y / 2 + 1.05 * scale };
        category = 'rooftop';
        hint = 'Parkour your way onto a roof';
      } else if (ledges.length && i % 4 === 1) {
        const target = ledges[i % ledges.length]!;
        const c = target.transform.position;
        position = { x: c.x, z: c.z, y: c.y + target.size.y / 2 + 1.05 * scale };
        category = 'platform';
        hint = 'Above the obvious route';
      }
      // A nearby taller solid can invalidate a roof/ledge: use searched ground alternatives.
      if (!position || !clearPosition(island, position)) {
        position = undefined;
        for (let attempt = 0; attempt < 260; attempt++) {
          const angle = rng.range(0, Math.PI * 2);
          const radius = rng.range(8, poi.radius * 1.38);
          const x = poi.center.x + radius * Math.cos(angle);
          const z = poi.center.z + radius * Math.sin(angle);
          const y = gridSample(island, x, z) + 1.1 * scale;
          const candidate = { x, y, z };
          if (clearPosition(island, candidate, 0.45) &&
              relics.every(p => Math.hypot(p.position.x - x, p.position.z - z) > 3 * scale)) {
            position = candidate;
            category = id === 'whispering-pines' ? 'forest' : 'secret';
            hint = id === 'whispering-pines' ? 'Between the pines and boulders' : 'Explore the edges of the district';
            break;
          }
        }
      }
      if (!position) throw new Error('No safe relic location in ' + id);
      relics.push({ id: 'relic-' + String(relics.length + 1).padStart(2, '0'),
        poiId: id, position, category, hint });
    }
  }
  if (relics.length !== 50) throw new Error('Exactly 50 Goat Relics must exist');
  return relics;
}

export function isSafeCollectiblePosition(island: IslandData, position: Vec3): boolean {
  return clearPosition(island, position);
}
