import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';

describe('Old Lighthouse cape rocks (LH-3)', () => {
  it('halves the default-seed rocks without oversized descriptors', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const rocks = island.props.filter(prop =>
      prop.poiId === 'old-lighthouse' && prop.kind === 'rock');

    // Previously 18 descriptors (5 layout + 13 dressing) at this seed.
    expect(rocks).toHaveLength(10);
    expect(rocks.filter(prop => prop.id.startsWith('detail-'))).toHaveLength(7);
    for (const rock of rocks) {
      expect(Math.max(rock.size.x, rock.size.y, rock.size.z), rock.id)
        .toBeLessThanOrEqual(3.9);
    }
  });

  it('keeps a later-generated POI prop at its exact pre-change position', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    // Mt. Gigga's tier pines are generated after the Lighthouse cape in dressing.ts.
    const later = island.props.find(prop =>
      prop.id.startsWith('detail-mt-gigga-tree-pine-'));
    expect(later?.transform.position).toEqual({
      x: -62.963892084384874,
      y: 31.417175153605157,
      z: 61.51393236298236,
    });
  });
});
