import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';
import { gridSample } from './terrain';
import type { IslandData, PropDescriptor } from './types';

function expectGroundedStilts(island: IslandData, deck: PropDescriptor): void {
  const { x, y, z } = deck.transform.position;
  const supports = island.props.filter(p => p.poiId === deck.poiId &&
    p.kind === 'deck-stilts' &&
    Math.abs(p.transform.position.x - x) < 0.00001 &&
    Math.abs(p.transform.position.z - z) < 0.00001);
  expect(supports, deck.id + ' must have exactly one support').toHaveLength(1);
  const support = supports[0]!;
  const ground = gridSample(island, x, z);
  const underside = y - deck.size.y / 2;

  expect(support.size.x).toBeCloseTo(deck.size.x, 6);
  expect(support.size.z).toBeCloseTo(deck.size.z, 6);
  expect(support.size.y).toBeCloseTo(underside - ground, 6);
  expect(support.size.y).toBeGreaterThan(0);
  expect(support.transform.position.y - support.size.y / 2)
    .toBeCloseTo(ground, 6);
  expect(support.transform.position.y + support.size.y / 2)
    .toBeCloseTo(underside, 6);
  expect(support.transform.rotationY).toBe(deck.transform.rotationY);
  expect(support.body).toEqual({ type: 'static' });
  expect(support.shape).toBe('cuboid');
  expect(support.collidable).toBe(false);
  expect(support.breakable).toBe(false);
  expect(support.lickable).toBe(false);
  expect(support.climbable).toBe(false);
  expect(island.colliders.some(c => 'id' in c && c.id === support.id))
    .toBe(false);
}

describe('island QA pass 2: structural decks and removed farm clutter', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'pines-alt', size: 900, resolution: 97 },
    { seed: 'decor-2', size: 600, resolution: 97 },
  ])('grounds both Pines floating decks on $seed / $size m', options => {
    const island = generateIsland(options);
    const decks = island.props.filter(p =>
      p.poiId === 'whispering-pines' && p.kind === 'platform' &&
      p.id.startsWith('whispering-pines-platform-'));
    expect(decks).toHaveLength(2);
    expect(decks.map(p => p.size.x).sort((a, b) => a - b))
      .toEqual([8, 9].map(x => x * options.size / 600));
    for (const deck of decks) expectGroundedStilts(island, deck);
    expect(island.props.filter(p => p.poiId === 'whispering-pines' &&
      p.kind === 'deck-stilts')).toHaveLength(2);
  });

  it('keeps the Lighthouse cliff deck grounded', () => {
    const island = generateIsland({ seed: 'billy-isle' });
    const cliff = island.props.filter(p =>
      p.poiId === 'old-lighthouse' && p.kind === 'platform');
    expect(cliff).toHaveLength(1);
    expectGroundedStilts(island, cliff[0]!);
  });

  it('keeps the lookout deck supported by its existing 24 m stilt tower', () => {
    const island = generateIsland({ seed: 'billy-isle' });
    const forest = island.props.filter(p => p.poiId === 'whispering-pines');
    const lookout = forest.find(p => p.kind === 'lookout')!;
    const platform = forest.find(p => p.kind === 'platform' &&
      p.id.startsWith('detail-whispering-pines-platform-'))!;
    expect(lookout).toBeDefined();
    expect(platform).toBeDefined();
    expect(platform.transform.position.x).toBeCloseTo(lookout.transform.position.x);
    expect(platform.transform.position.z).toBeCloseTo(lookout.transform.position.z);
    expect(lookout.transform.position.y + lookout.size.y / 2)
      .toBeGreaterThan(platform.transform.position.y + platform.size.y / 2);
    expect(lookout.transform.position.y - lookout.size.y / 2)
      .toBeCloseTo(gridSample(island, lookout.transform.position.x,
        lookout.transform.position.z), 3);
  });

  it('removes Hoofington lawn deck, seven garden crates and hay-field ramp', () => {
    const island = generateIsland({ seed: 'billy-isle' });
    const unwanted = island.props.filter(p => p.poiId === 'hoofington' &&
      (p.kind === 'platform' || p.kind === 'ramp' ||
        (p.kind === 'crate' && !p.id.startsWith('hoofington-verge-'))));
    expect(unwanted).toEqual([]);
    expect(island.props.filter(p => p.kind === 'crate' &&
      p.id.startsWith('hoofington-verge-'))).toHaveLength(2);
    expect(island.props.filter(p => p.poiId === 'hoofington' &&
      p.kind === 'hay-bale').length).toBeGreaterThan(0);
  });

  it('keeps all later seeded layouts reproducible after the 21 discarded RNG draws', () => {
    for (const seed of ['billy-isle', 'pines-alt', 'qa-cliff-alt']) {
      const select = () => generateIsland({ seed, resolution: 97 }).props
        .filter(p => p.poiId === 'downtown-bleatsville' ||
          p.poiId === 'whispering-pines' || p.poiId === 'old-lighthouse')
        .map(p => ({ id: p.id, position: p.transform.position }));
      expect(select()).toEqual(select());
    }
  });
});
