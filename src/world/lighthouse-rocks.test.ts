import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';

describe('Old Lighthouse cape rocks (LH-3)', () => {
  it('records default-seed rock and downstream POI baselines', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const rocks = island.props.filter(prop =>
      prop.poiId === 'old-lighthouse' && prop.kind === 'rock');
    // Mt. Gigga's tier foliage is generated after the Lighthouse cape.
    const later = island.props.find(prop =>
      prop.id.startsWith('detail-mt-gigga-tree-pine-'));
    expect(later).toBeDefined();
    console.log('LH3_BASELINE ' + JSON.stringify({
      rocks: rocks.length,
      layout: rocks.filter(prop => !prop.id.startsWith('detail-')).length,
      dressing: rocks.filter(prop => prop.id.startsWith('detail-')).length,
      later: { id: later!.id, position: later!.transform.position },
    }));
  });
});
