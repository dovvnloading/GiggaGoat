import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';

describe('Old Lighthouse cape rocks (LH-3)', () => {
  it('keeps the remaining cape rocks supported and correctly sized after LH-12', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const rocks = island.props.filter(prop =>
      prop.poiId === 'old-lighthouse' && prop.kind === 'rock');

    // LH-3 left ten; LH-12 now removes three unsupported channel rocks.
    expect(rocks).toHaveLength(7);
    expect(rocks.filter(prop => prop.id.startsWith('detail-')).length)
      .toBeLessThanOrEqual(7);
    for (const rock of rocks) {
      expect(Math.max(rock.size.x, rock.size.y, rock.size.z), rock.id)
        .toBeLessThanOrEqual(3.9);
    }
  });

  it('keeps a later-generated POI prop at its exact pre-change position', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    // Mt. Gigga's tier pines come after Lighthouse dressing. The west-yard
    // road bypass changes which global vegetation candidates avoid roads, so
    // lock the new default-seed position without moving any authored props.
    const later = island.props.find(prop =>
      prop.id.startsWith('detail-mt-gigga-tree-pine-'));
    expect(later?.transform.position).toEqual({
      x: -77.05920504097122,
      y: 33.63114225691537,
      z: 31.287102262902106,
    });
  });
});
