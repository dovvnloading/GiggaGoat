import { describe, expect, it } from 'vitest';
import { generateIsland, heightAt } from '../world';
import { DOWNTOWN_INFILL } from '../world/visual-downtown';
import { ChallengeTracker, CudWallet, EventBus } from '../gameplay';
import { BOARD_CYCLE_TICKS, GigCatalog, GIG_INFO } from './catalog';
import { GigDirector } from './engine';
import { GigGameplayBridge } from './integrations';
import { DIFFICULTIES, GIG_IDS } from './types';
import type {
  AbilityFact, Difficulty, GigConfig, GigFrame, GigId, GigRun,
  GigSetup, Point, PropFact, Rating,
} from './types';

const island = generateIsland({ seed: 'gigs-real-billy-isle', resolution: 65 });
const catalog = new GigCatalog(island, 2026);
const position = (p: Point): Point => ({ ...p });
const frame = (p: Point): GigFrame => ({ goat: { position: position(p), size: 1 },
  props: [], abilities: [], style: [] });
const shifted = (p: Point, dx = 0, dy = 0, dz = 0): Point =>
  ({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
const ratio = (rating: Rating): number => ({ bronze: 0.94, silver: 0.70, gold: 0.48 })[rating];
const configOf = <K extends GigConfig['kind']>(setup: GigSetup, kind: K):
  Extract<GigConfig, { kind: K }> => {
  if (setup.config.kind !== kind) throw new Error('wrong fixture');
  return setup.config as Extract<GigConfig, { kind: K }>;
};
function efficientBites(patches: Point[], radius: number): number[] {
  const remaining = new Set(patches.map((_, i) => i));
  const chosen: number[] = [];
  while (remaining.size) {
    let best = -1, maxCovered = 0;
    for (let i = 0; i < patches.length; i++) {
      const count = [...remaining].filter(j =>
        Math.hypot(patches[i]!.x - patches[j]!.x, patches[i]!.z - patches[j]!.z) <= radius).length;
      if (count > maxCovered) { maxCovered = count; best = i; }
    }
    if (best < 0) throw new Error('no cover');
    chosen.push(best);
    for (const j of remaining) {
      if (Math.hypot(patches[best]!.x - patches[j]!.x, patches[best]!.z - patches[j]!.z) <= radius) {
        remaining.delete(j);
      }
    }
  }
  return chosen;
}

/** Drives exactly the same step(facts) API the production physics host will call. */
function scriptedTick(setup: GigSetup, target: Rating, t: number, finishAt: number): GigFrame {
  const f = frame(setup.start);
  const c = setup.config;
  const acts: AbilityFact[] = [];
  const props: PropFact[] = [];
  switch (c.kind) {
    case 'hay-haul': {
      c.bales.forEach(b => props.push({ id: b.id, position: position(b.start) }));
      if (t <= c.bales.length) {
        const bale = c.bales[t - 1]!;
        f.goat.position = position(bale.start);
        acts.push({ type: 'tongue', targetId: bale.id });
      }
      const deliveries = target === 'gold' ? (t === finishAt ? c.bales.length : 0) :
        Math.max(0, c.bales.length - (finishAt - t));
      for (let i = 0; i < deliveries; i++) {
        const p = props[i]!;
        p.position = shifted(c.barn, (i % 3) * 0.6, 0, Math.floor(i / 3) * 0.7);
        p.heldByTongue = target === 'gold';
      }
      break;
    }
    case 'rooftop-express': {
      const reached = t === 1 ? 0 : Math.min(c.checkpoints.length - 1,
        Math.max(0, c.checkpoints.length - (finishAt - t) - 1));
      f.goat.position = position(c.checkpoints[reached]!);
      props.push({ id: c.parcelId, position: position(f.goat.position), carried: true });
      if (t === 1) acts.push({ type: 'tongue', targetId: c.parcelId });
      break;
    }
    case 'demolition-contract': {
      for (const piece of c.pieces) {
        props.push({ id: piece.id, position: t >= finishAt
          ? shifted(piece.start, 5) : position(piece.start) });
      }
      const n = target === 'gold' ? 1 : target === 'silver' ? 4 : 8;
      if (t <= n) acts.push({ type: 'headbutt', targetId: c.pieces[0]!.id });
      break;
    }
    case 'mow-down': {
      const chosen = efficientBites(c.patches, c.biteRadius);
      const nth = t < chosen.length ? t - 1 : t === finishAt ? chosen.length - 1 : -1;
      if (nth >= 0 && nth < chosen.length) {
        f.goat.position = position(c.patches[chosen[nth]!]!);
        acts.push({ type: 'eat' });
      }
      break;
    }
    case 'escort-the-gnome': {
      const reached = t < c.route.length ? t - 1 :
        t === finishAt ? c.route.length - 1 : c.route.length - 2;
      const p = c.route[Math.max(0, reached)]!;
      f.goat.position = shifted(p, 1);
      props.push({ id: c.gnomeId, position: position(p), impact: 0 });
      break;
    }
    case 'stack-up': {
      const layers = target === 'gold' ? c.requiredLayers + 1 : c.requiredLayers;
      for (let i = 0; i < c.crateIds.length; i++) {
        const onStack = t > finishAt - c.holdTicks && i < layers;
        props.push({ id: c.crateIds[i]!, position: onStack
          ? shifted(c.center, 0, (i + 0.5) * c.crateHeight)
          : shifted(c.center, 4 + i * 3, c.crateHeight / 2, 3),
          velocity: { x: 0, y: 0, z: 0 }, tilt: 0 });
      }
      break;
    }
    case 'summit-sprint': {
      const reached = t < c.checkpoints.length ? t - 1 :
        t === finishAt ? c.checkpoints.length - 1 : c.checkpoints.length - 2;
      f.goat.position = position(c.checkpoints[Math.max(0, reached)]!);
      if (t <= 100) acts.push({ type: 'climb', metres: 0.25 });
      if (c.requiresBleat && t === finishAt) acts.push({ type: 'bleat' });
      break;
    }
    case 'splash-dive': {
      if (t === 1) f.goat.position = position(c.jumpPoint);
      if (t === 2) {
        f.goat.position = shifted(c.jumpPoint, 0, c.minDrop + 3);
        if (c.requiresFlop) acts.push({ type: 'flop' });
      }
      if (t === finishAt) {
        f.goat.position = position(c.landing);
        f.style = [{ type: 'big-splash', points: 40 }];
      }
      break;
    }
  }
  f.props = props;
  f.abilities = acts;
  return f;
}
function runScript(gigId: GigId, difficulty: Difficulty, rating: Rating): {
  director: GigDirector; run: GigRun; setup: GigSetup;
} {
  const director = new GigDirector(catalog);
  const setup = director.startPractice(gigId, difficulty);
  const finishAt = Math.round(setup.maxTicks * ratio(rating));
  for (let t = 1; t <= finishAt; t++) {
    director.step(scriptedTick(setup, rating, t, finishAt));
    if (director.active?.status !== 'running' && t !== finishAt) {
      throw new Error(gigId + ' completed early at tick ' + t + ' of ' + finishAt);
    }
  }
  const run = director.active!;
  return { director, run, setup };
}

describe('Gig boards and real world integration', () => {
  it('repeats identical seeded offers without ambient randomness', () => {
    const another = new GigCatalog(island, 2026);
    expect(another.board('hoofington', 0)).toEqual(catalog.board('hoofington', 0));
    expect(another.build(catalog.makeOffer('hay-haul', 'hard'))).toEqual(
      catalog.build(catalog.makeOffer('hay-haul', 'hard')));
    expect(new GigCatalog(island, 999).board('hoofington', 0).offers).not.toEqual(
      catalog.board('hoofington', 0).offers);
  });
  it('rotates boards only at the fixed schedule and cycles all difficulty tiers', () => {
    const before = catalog.board('crane-yard', BOARD_CYCLE_TICKS - 1);
    const after = catalog.board('crane-yard', BOARD_CYCLE_TICKS);
    expect(before.cycle).toBe(0);
    expect(before.refreshInTicks).toBe(1);
    expect(after.cycle).toBe(1);
    expect(after.offers).not.toEqual(before.offers);
    const tiers = new Set<Difficulty>();
    for (let cycle = 0; cycle < 6; cycle++) {
      for (const offer of catalog.board('crane-yard', cycle * BOARD_CYCLE_TICKS).offers) tiers.add(offer.difficulty);
    }
    expect([...tiers].sort()).toEqual([...DIFFICULTIES].sort());
    for (const id of GIG_IDS) expect(GIG_INFO[id].poiId).toBeDefined();
    for (const poi of island.pois) {
      expect(catalog.board(poi.id, 0).offers.length).toBeGreaterThan(0);
    }
  });
  it('only starts posted offers, and expires old ones', () => {
    const director = new GigDirector(catalog);
    const first = director.board('hoofington').offers[0]!;
    const setup = director.accept(first.id);
    expect(setup.offer).toEqual(first);
    expect(() => director.accept(first.id)).toThrow(/current/);
    expect(director.abandon()).toBe(true);
    expect(director.abandon()).toBe(false);
    expect(director.pendingAwards).toEqual([]);
    for (let i = 0; i < BOARD_CYCLE_TICKS; i++) director.step(frame(setup.start));
    expect(() => director.accept(first.id)).toThrow(/expired/);
    expect(director.drainEvents().some(e => e.type === 'board.rotated')).toBe(true);
  });
  it('uses real existing bale IDs, barn geometry, roofs, tower landmark and named POIs', () => {
    const hay = configOf(catalog.build(catalog.makeOffer('hay-haul', 'easy')), 'hay-haul');
    const ids = new Set(island.props.filter(p => p.kind === 'hay-bale').map(p => p.id));
    expect(hay.bales.every(b => ids.has(b.id))).toBe(true);
    const barn = island.props.find(p => p.kind === 'barn')!;
    expect(hay.barn.x).toBe(barn.transform.position.x);
    const roof = configOf(catalog.build(catalog.makeOffer('rooftop-express', 'hard')), 'rooftop-express');
    expect(roof.checkpoints.length).toBe(4);
    expect(roof.checkpoints.every(cp => island.props.some(p =>
      p.poiId === 'downtown-bleatsville' && (p.kind === 'shop' || p.kind === 'house') &&
      Math.abs(p.transform.position.x - cp.x) < 0.01 &&
      Math.abs(p.transform.position.z - cp.z) < 0.01))).toBe(true);
    const demolition = catalog.build(catalog.makeOffer('demolition-contract', 'easy'));
    expect(demolition.spawns.every(p => p.role === 'tower' && p.mass > 0)).toBe(true);
    expect(island.props.some(p => p.poiId === 'crane-yard' && p.kind === 'tower')).toBe(true);
  });
  it('keeps four y-rotated roofs in every Rooftop Express row and uses their actual roof heights', () => {
    const city = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const roofs = island.props.filter(p => p.poiId === 'downtown-bleatsville' &&
      (p.kind === 'shop' || p.kind === 'house'));
    expect(roofs).toHaveLength(16 + DOWNTOWN_INFILL.length);
    // DT-14 infills sit between the gig rows, not within 3 metres of them.
    expect(roofs.filter(p => [-19, 0, 19].some(dz =>
      Math.abs(p.transform.position.z - city.z - dz) < 3))).toHaveLength(12);
    for (const dz of [-19, 0, 19]) {
      const row = roofs.filter(p => Math.abs(p.transform.position.z - city.z - dz) < 3);
      expect(row, 'Rooftop Express row ' + dz).toHaveLength(4);
      for (const building of row) {
        expect(Math.abs(building.transform.rotationY),
          building.id).toBeCloseTo(Math.PI / 2, 6);
      }
    }
    for (const [difficulty, count] of [
      ['easy', 3], ['medium', 4], ['hard', 4],
    ] as const) {
      const setup = catalog.build(catalog.makeOffer('rooftop-express', difficulty));
      const gig = configOf(setup, 'rooftop-express');
      expect(gig.checkpoints).toHaveLength(count);
      for (const checkpoint of gig.checkpoints) {
        const building = roofs.find(p =>
          Math.abs(p.transform.position.x - checkpoint.x) < 0.01 &&
          Math.abs(p.transform.position.z - checkpoint.z) < 0.01);
        expect(building, 'checkpoint on a physical roof').toBeDefined();
        expect(checkpoint.y, 'Rooftop Express roof height').toBeCloseTo(
          building!.transform.position.y + building!.size.y / 2 + 0.65, 5);
      }
    }
  });

  it('grounds generated mowing and gnome routes on actual island terrain', () => {
    const mow = configOf(catalog.build(catalog.makeOffer('mow-down', 'hard')), 'mow-down');
    for (const p of mow.patches) expect(p.y).toBeCloseTo(heightAt(island, p.x, p.z) + 0.15, 4);
    const gnome = configOf(catalog.build(catalog.makeOffer('escort-the-gnome', 'hard')), 'escort-the-gnome');
    for (const p of gnome.route) expect(p.y).toBeCloseTo(heightAt(island, p.x, p.z) + 0.8, 4);
    const stack = configOf(catalog.build(catalog.makeOffer('stack-up', 'hard')), 'stack-up');
    expect(stack.groundY).toBeCloseTo(heightAt(island, stack.center.x, stack.center.z), 4);
  });
  it('varies physical layouts for each contract over several seeded rotations', () => {
    for (const id of GIG_IDS) {
      const setups = Array.from({ length: 12 }, (_, cycle) =>
        catalog.build(catalog.makeOffer(id, 'medium', cycle)));
      // Ignore offer IDs: the start, geometry, target IDs and markers must actually vary.
      const geometry = setups.map(({ config, start, markers }) => JSON.stringify({ config, start, markers }));
      expect(new Set(geometry).size, id).toBeGreaterThan(1);
    }
  });
  it('different seeds and tiers vary meaningful gig layout rather than only an ID', () => {
    for (const id of GIG_IDS) {
      const a = catalog.build(catalog.makeOffer(id, 'easy', 0));
      const hard = catalog.build(catalog.makeOffer(id, 'hard', 0));
      expect(hard.config).not.toEqual(a.config);
      expect(hard.maxTicks).toBeLessThan(a.maxTicks);
      expect(a.markers.length).toBeGreaterThan(0);
    }
  });
});

describe('Each gig completes with a reproducible bronze, silver and gold run', () => {
  for (const gigId of GIG_IDS) for (const difficulty of DIFFICULTIES) {
    it(gigId + ' ' + difficulty + ': scripted skill/rating/payout', () => {
      for (const rating of ['bronze', 'silver', 'gold'] as const) {
        const { director, run, setup } = runScript(gigId, difficulty, rating);
        expect(run.status).toBe('completed');
        expect(run.rating).toBe(rating);
        expect(run.elapsedTicks).toBe(Math.round(setup.maxTicks * ratio(rating)));
        expect(run.payout).toBeGreaterThan(0);
        const award = director.pendingAwards[0]!;
        expect(award.coins).toBe(Math.round(award.baseCoins * award.multiplier) + award.firstGoldBonus);
        expect(award.firstGoldBonus).toBe(rating === 'gold' ? 100 : 0);
        expect(award.cosmeticId).toBe(rating === 'gold' ? GIG_INFO[gigId].cosmetic.id : undefined);
        expect(director.personalBests).toHaveLength(1);
      }
    });
  }
});

describe('Gig-specific anti-cheat physics fact requirements', () => {
  it('hay cannot score without a real tongue touch or by scoring the same bale twice', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('hay-haul', 'easy'), 'hay-haul');
    const f = frame(c.barn);
    f.props = c.bales.map(b => ({ id: b.id, position: position(c.barn), heldByTongue: true }));
    d.step(f);
    expect(d.active?.objective).toMatchObject({ kind: 'deliver', done: 0 });
    d.step(f);
    expect(d.active?.objective).toMatchObject({ kind: 'deliver', done: 0 });
  });
  it('rooftop delivery fails if goat touches street after first roof', () => {
    const d = new GigDirector(catalog);
    const s = d.startPractice('rooftop-express', 'easy');
    const c = configOf(s, 'rooftop-express');
    const f = frame(c.checkpoints[0]!);
    f.props = [{ id: c.parcelId, position: position(c.checkpoints[0]!), carried: true }];
    f.abilities = [{ type: 'tongue', targetId: c.parcelId }];
    d.step(f);
    expect(d.active?.objective).toMatchObject({ kind: 'checkpoints', reached: 1 });
    d.step({ ...f, goat: { position: position(c.checkpoints[0]!), size: 1, onStreet: true } });
    expect(d.active?.failReason).toMatch(/Street/);
    expect(d.pendingAwards).toHaveLength(0);
  });
  it('demolition needs an actual headbutt and displaced mass, not bare completion intent', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('demolition-contract', 'hard'), 'demolition-contract');
    const f = frame(c.pieces[0]!.start);
    f.props = c.pieces.map(p => ({ id: p.id, position: shifted(p.start, 5) }));
    d.step(f);
    expect(d.active?.status).toBe('running');
    f.abilities = [{ type: 'headbutt' }];
    d.step(f);
    expect(d.active?.status).toBe('completed');
  });
  it('mowing requires distinct patches and a nearby eat, with no credit from remote bleats', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('mow-down', 'easy'), 'mow-down');
    const remote = frame(shifted(c.patches[0]!, 1000));
    remote.abilities = [{ type: 'eat' }, { type: 'bleat' }];
    d.step(remote);
    expect(d.active?.objective).toMatchObject({ kind: 'coverage', eaten: 0 });
    const f = frame(c.patches[0]!);
    f.abilities = [{ type: 'eat' }];
    d.step(f);
    const count = (d.active?.objective as Extract<GigRun['objective'], { kind: 'coverage' }>).eaten;
    d.step(f);
    expect(d.active?.objective).toMatchObject({ kind: 'coverage', eaten: count });
  });
  it('gnome breaks on actual impulse above its tier threshold', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('escort-the-gnome', 'hard'), 'escort-the-gnome');
    const f = frame(c.route[0]!);
    f.props = [{ id: c.gnomeId, position: position(c.route[0]!), impact: c.breakImpulse }];
    d.step(f);
    expect(d.active?.status).toBe('failed');
    expect(d.active?.failReason).toMatch(/cracked/);
  });
  it('stack is not magic floating blocks; wobble resets the full five-second hold', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('stack-up', 'easy'), 'stack-up');
    const f = frame(c.center);
    f.props = c.crateIds.map((id, i) => ({ id,
      position: shifted(c.center, 0, (i + 0.5) * c.crateHeight),
      velocity: { x: 0, y: 0, z: 0 } }));
    for (let i = 0; i < 200; i++) d.step(f);
    expect(d.active?.objective).toMatchObject({ kind: 'stack', stableTicks: 200 });
    f.props[0]!.tilt = 0.7;
    d.step(f);
    expect(d.active?.objective).toMatchObject({ kind: 'stack', stableTicks: 0 });
    for (let i = 0; i < 299; i++) {
      f.props[0]!.tilt = 0;
      d.step(f);
    }
    expect(d.active?.status).toBe('running');
    d.step(f);
    expect(d.active?.status).toBe('completed');
  });
  it('summit checkpoints alone are insufficient without measured climb', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('summit-sprint', 'easy'), 'summit-sprint');
    for (const p of c.checkpoints) d.step(frame(p));
    expect(d.active?.status).toBe('running');
    for (let i = 0; i < 10; i++) {
      const f = frame(c.checkpoints[c.checkpoints.length - 1]!);
      f.abilities = [{ type: 'climb', metres: 0.4 }];
      d.step(f);
    }
    expect(d.active?.status).toBe('completed');
  });
  it('Dam Bomb requires a flop before a real reservoir splash', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('dam-bomb', 'easy'), 'splash-dive');
    d.step(frame(c.jumpPoint));
    const splash = frame(c.landing);
    splash.style = [{ type: 'big-splash', points: 30 }];
    d.step(splash);
    expect(d.active?.status).toBe('running');
    const flop = frame(c.jumpPoint);
    flop.abilities = [{ type: 'flop' }];
    d.step(flop);
    d.step(splash);
    expect(d.active?.status).toBe('completed');
  });
  it('Beacon Bleat requires a real bleat at the lighthouse summit', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('beacon-bleat', 'easy'), 'summit-sprint');
    for (const cp of c.checkpoints) d.step(frame(cp));
    const final = frame(c.checkpoints[c.checkpoints.length - 1]!);
    final.abilities = [{ type: 'climb', metres: 0.4 }];
    for (let i = 0; i < 15; i++) d.step(final);
    expect(d.active?.status).toBe('running');
    final.abilities = [{ type: 'bleat' }];
    d.step(final);
    expect(d.active?.status).toBe('completed');
  });
  it('splash needs a real big-splash gameplay event, not merely touching water', () => {
    const d = new GigDirector(catalog);
    const c = configOf(d.startPractice('splash-dive', 'easy'), 'splash-dive');
    d.step(frame(c.jumpPoint));
    const f = frame(c.landing);
    d.step(f);
    expect(d.active?.status).toBe('running');
    f.style = [{ type: 'big-splash', points: 25 }];
    d.step(f);
    expect(d.active?.status).toBe('completed');
  });
});

describe('Mission life cycle, events, economy and save/load', () => {
  it('timers fail on the exact completed 60Hz tick; failure/abandon pays nothing', () => {
    const d = new GigDirector(catalog);
    const s = d.startPractice('hay-haul', 'hard');
    for (let i = 0; i < s.maxTicks - 1; i++) d.step(frame(s.start));
    expect(d.active?.status).toBe('running');
    expect(d.active?.elapsedTicks).toBe(s.maxTicks - 1);
    d.step(frame(s.start));
    expect(d.active?.failReason).toBe('Time up');
    expect(d.pendingAwards).toHaveLength(0);
  });
  it('fresh gold unlocks once per gig; personal best only improves, repeat is still paid', () => {
    const d = new GigDirector(catalog);
    const s1 = d.startPractice('splash-dive', 'easy');
    const end1 = Math.round(s1.maxTicks * ratio('gold'));
    for (let i = 1; i <= end1; i++) d.step(scriptedTick(s1, 'gold', i, end1));
    const first = d.pendingAwards[0]!;
    expect(first.firstGoldBonus).toBe(100);
    expect(d.ownedCosmetics).toEqual(['bubble-trail']);
    const s2 = d.startPractice('splash-dive', 'easy');
    const end2 = Math.round(s2.maxTicks * ratio('bronze'));
    for (let i = 1; i <= end2; i++) d.step(scriptedTick(s2, 'bronze', i, end2));
    expect(d.pendingAwards[1]!.firstGoldBonus).toBe(0);
    expect(d.personalBests).toHaveLength(1);
    expect(d.personalBests[0]!.rating).toBe('gold');
  });
  it('event sequencing, isolated callbacks and draining are deterministic', () => {
    const d = new GigDirector(catalog);
    const seen: string[] = [];
    const unsubscribe = d.onEvent(event => {
      seen.push(event.type);
      if (event.type === 'objective.progress') event.objective.label = 'tampered by UI';
    });
    const s = d.startPractice('mow-down', 'easy');
    const f = frame(configOf(s, 'mow-down').patches[0]!);
    f.abilities = [{ type: 'eat' }];
    const out = d.step(f);
    expect(out.map(e => e.type)).toEqual(['objective.progress']);
    expect(d.active?.objective.label).toBe('Lawn grid eaten');
    expect(d.drainEvents().map(e => e.seq)).toEqual([1, 2]);
    expect(d.drainEvents()).toEqual([]);
    unsubscribe();
    d.step(f);
    expect(seen).toHaveLength(2);
  });
  it('JSON snapshot roundtrip replays each gig with identical events, state and payout', () => {
    for (const id of GIG_IDS) {
      const d = new GigDirector(catalog);
      const s = d.startPractice(id, 'medium');
      const at = Math.round(s.maxTicks * ratio('silver'));
      const halfway = Math.min(90, at - 1);
      for (let t = 1; t <= halfway; t++) d.step(scriptedTick(s, 'silver', t, at));
      const snap = JSON.parse(JSON.stringify(d.toJSON()));
      const restored = GigDirector.fromJSON(snap, catalog);
      expect(restored.toJSON()).toEqual(d.toJSON());
      for (let t = halfway + 1; t <= at; t++) {
        const facts = scriptedTick(s, 'silver', t, at);
        expect(restored.step(facts)).toEqual(d.step(facts));
      }
      expect(restored.toJSON()).toEqual(d.toJSON());
      expect(d.active?.status).toBe('completed');
    }
  });
  it('rejects malformed and cross-seed snapshots and impossible facts', () => {
    const d = new GigDirector(catalog);
    const s = d.startPractice('mow-down', 'easy');
    const snap = d.toJSON();
    expect(() => GigDirector.fromJSON({ ...snap, version: 2 }, catalog)).toThrow();
    expect(() => GigDirector.fromJSON(snap, new GigCatalog(island, 99))).toThrow();
    expect(() => d.step(frame({ ...s.start, x: Infinity }))).toThrow(/position/);
    expect(() => d.step({ ...frame(s.start), props: [
      { id: 'x', position: s.start }, { id: 'x', position: s.start },
    ] })).toThrow(/Duplicate/);
  });
  it('wallet credits through its public API once, challenges through the existing typed bus', () => {
    const d = new GigDirector(catalog);
    const s = d.startPractice('demolition-contract', 'easy');
    const at = Math.round(s.maxTicks * ratio('gold'));
    for (let t = 1; t <= at; t++) d.step(scriptedTick(s, 'gold', t, at));
    const bus = new EventBus();
    const wallet = new CudWallet(bus);
    const challenges = new ChallengeTracker(wallet, bus);
    const bridge = new GigGameplayBridge(d, wallet, challenges, bus);
    const earned = d.pendingAwards[0]!.coins;
    expect(bridge.settle()).toHaveLength(1);
    expect(wallet.coins).toBe(earned);
    expect(challenges.getProgress('wrecking-crew').value).toBe(1);
    expect(bridge.settle()).toHaveLength(0);
    expect(wallet.coins).toBe(earned);
    expect(d.pendingAwards).toHaveLength(0);
    const restored = GigDirector.fromJSON(JSON.parse(JSON.stringify(d.toJSON())), catalog);
    expect(restored.pendingAwards).toHaveLength(0);
  });
});
