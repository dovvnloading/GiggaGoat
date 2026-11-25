import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BreakableRegistry, DynamicBodyBudget } from '../chaos';
import { applyExplosion, PhysicsWorld, sub, V } from '../physics';
import { generateIsland, type ColliderBuild, type IslandData, type PropDescriptor } from '../world';
import { Game } from './Game';
import { MARKET_CRATE_ID, MARKET_FRUIT_LIMIT, MarketScene } from './MarketScene';

let island: IslandData;
const cleanups: Array<() => void> = [];
beforeAll(() => { island = generateIsland({ seed: 'billy-isle', resolution: 65 }); });
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); });

async function market(capacity = 12, withCrate = true) {
  const physics = await PhysicsWorld.create();
  const floor = physics.createGround();
  const crate = physics.createBox(V(0, .5, 0), V(.5, .5, .5), 8);
  const prop: PropDescriptor = { id: MARKET_CRATE_ID, kind: 'crate',
    transform: { position: V(0, .5, 0), rotationY: 0 }, size: V(1, 1, 1),
    body: { type: 'dynamic', mass: 8 }, shape: 'cuboid',
    collidable: true, breakable: true, lickable: true, climbable: false };
  const colliders: ColliderBuild = { terrain: floor.collider(0), paths: [],
    props: new Map(withCrate ? [[MARKET_CRATE_ID, crate.collider(0)]] : []),
    bodies: new Map(withCrate ? [[MARKET_CRATE_ID, crate]] : []) };
  const budget = new DynamicBodyBudget(physics, capacity, .1);
  const scene = new MarketScene(physics, { ...island, props: withCrate ? [prop] : [] }, colliders, budget);
  cleanups.push(() => { scene.dispose(); budget.dispose(); physics.dispose(); });
  return { scene, budget, physics, crate };
}

describe('finite reactive market scene (LW-106)', () => {
  it('spills only the real produce crate once and caps repeated commotion at six physical fruit', async () => {
    const { scene, budget, physics } = await market();
    const listener = vi.fn(); scene.listeners.add(listener);
    const bodiesBefore = physics.raw.bodies.len();
    expect(scene.items).toHaveLength(MARKET_FRUIT_LIMIT);
    expect(scene.activeBodies).toBe(0);
    expect(scene.disrupt('another-crate', V(1, 0, 0), 1, 0)).toBe(false);
    expect(scene.disrupt(MARKET_CRATE_ID, V(NaN, 0, 0), 1, 0)).toBe(false);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, Infinity, 0), 1, 0)).toBe(false);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), Infinity, 0)).toBe(false);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 1)).toBe(true);
    for (let i = 0; i < 100; i++) expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 1), 2, i + 2)).toBe(false);
    expect(scene.activeBodies).toBe(6);
    expect(budget.count).toBe(6);
    expect(physics.raw.bodies.len() - bodiesBefore).toBe(6);
    expect(listener).toHaveBeenCalledTimes(1);
    for (const item of scene.items) {
      expect(physics.bodyData(item.body!.handle)).toMatchObject({ kind: 'prop', owner: item.id, data: 'fruit' });
      expect(Object.values(item.body!.linvel()).every(Number.isFinite)).toBe(true);
    }
  });

  it('reserves a complete burst or leaves the display intact under shared budget pressure', async () => {
    const { scene, budget, physics } = await market(6);
    const other = physics.createBox(V(10, 2, 0), V(.2, .2, .2));
    budget.admit(other);
    const count = physics.raw.bodies.len();
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 1)).toBe(false);
    expect(scene.spilled).toBe(false);
    expect(scene.items.every(item => item.visible && !item.body)).toBe(true);
    expect(physics.raw.bodies.len()).toBe(count);
    expect(budget.count).toBe(1);
    budget.release(other);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 2)).toBe(true);
    expect(scene.activeBodies).toBe(6);
    expect(other.isValid()).toBe(true);
  });

  it('retires a destroyed display when debris exhausted the shared budget, without a delayed spill', async () => {
    const { scene, budget, physics, crate } = await market(6);
    const breaks = new BreakableRegistry(physics, { bodyBudget: budget });
    cleanups.push(() => breaks.dispose());
    breaks.register(crate, { impulseThreshold: 1, chunks: 6 });
    const listener = vi.fn(); scene.listeners.add(listener);
    const accepted: boolean[] = [];
    breaks.events.on(() => accepted.push(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, physics.time)));
    expect(breaks.shatter(crate)).toBe(true);
    expect(accepted).toEqual([false]);
    expect(budget.count).toBe(6);
    scene.update(1, V(0, 1, 0), true, -10);
    expect(scene.items.every(item => !item.visible && !item.body)).toBe(true);
    expect(scene.activeBodies).toBe(0);
    for (const handle of breaks.debrisHandles) {
      const body = physics.raw.getRigidBody(handle)!;
      budget.release(body);
      physics.removeBody(body);
    }
    scene.update(30, V(0, 1, 0), true, -10);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 31)).toBe(false);
    expect(scene.items.every(item => !item.visible && !item.body)).toBe(true);
    expect(budget.count).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('retires an unspilled crate lost during a suppressed mode, even after that mode ends', async () => {
    const { scene, budget, physics, crate } = await market();
    const listener = vi.fn(); scene.listeners.add(listener);
    scene.setEnabled(false);
    physics.removeBody(crate);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 1)).toBe(false);
    scene.update(1, V(0, 1, 0), false, -10);
    expect(scene.items.every(item => !item.visible)).toBe(true);
    scene.setEnabled(true);
    scene.update(2, V(0, 1, 0), true, -10);
    expect(scene.activeBodies).toBe(0);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 3)).toBe(false);
    expect(scene.items.every(item => !item.visible)).toBe(true);
    expect(budget.count).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps an immediate, fully admitted destruction spill after the source crate disappears', async () => {
    const { scene, budget, physics, crate } = await market();
    const breaks = new BreakableRegistry(physics, { bodyBudget: budget });
    cleanups.push(() => breaks.dispose());
    breaks.register(crate, { impulseThreshold: 1, chunks: 6 });
    const accepted: boolean[] = [];
    breaks.events.on(() => accepted.push(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, physics.time)));
    expect(breaks.shatter(crate)).toBe(true);
    expect(accepted).toEqual([true]);
    scene.update(1, V(0, 1, 0), true, -10);
    expect(scene.activeBodies).toBe(6);
    expect(scene.items.every(item => item.visible && item.body?.isValid())).toBe(true);
    expect(budget.count).toBe(12);
  });

  it('settles real fruit on Rapier ground and never reclaims visible sleepers through generic debris cleanup', async () => {
    const { scene, budget, physics } = await market();
    scene.disrupt(MARKET_CRATE_ID, V(1, 0, .3), 1, 0);
    for (let i = 0; i < 600; i++) {
      physics.step(1 / 60);
      scene.update(physics.time, V(3, 1, 0), true, -10);
    }
    expect(scene.activeBodies).toBe(6);
    for (const item of scene.items) {
      expect(item.position.y).toBeGreaterThan(item.radius - .025);
      expect(item.position.y).toBeLessThan(1.5);
      item.body!.sleep();
    }
    for (let i = 0; i < 20; i++) physics.step(1 / 60);
    scene.update(60, V(3, 1, 0), true, -10);
    expect(scene.items.every(item => item.visible)).toBe(true);
    expect(scene.activeBodies).toBe(6);
    expect(budget.count).toBe(6);
    scene.update(61, V(200, 1, 0), true, -10);
    expect(scene.activeBodies).toBe(0);
    expect(budget.count).toBe(0);
    expect(scene.items.every(item => !item.visible && !item.body)).toBe(true);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 90)).toBe(false);
  });

  it('suppresses new disruption and suspends existing bodies in excluded modes, then resumes in place', async () => {
    const { scene, physics, crate } = await market();
    scene.update(0, V(), false, 0);
    crate.setLinvel(V(4, 0, 0), true);
    scene.update(1, V(), false, 0);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 1)).toBe(false);
    expect(scene.activeBodies).toBe(0);
    scene.update(2, V(), true, 0);
    expect(scene.activeBodies).toBe(6); // Accepted physical displacement.
    // The integrator can suppress collision before stepping Rapier at all.
    scene.setEnabled(false);
    scene.update(3, V(), false, 0);
    const positions = scene.items.map(item => ({ ...item.body!.translation() }));
    expect(scene.items.every(item => !item.body!.isEnabled())).toBe(true);
    for (let i = 0; i < 15; i++) physics.step(1 / 60);
    expect(scene.items.map(item => ({ ...item.body!.translation() }))).toEqual(positions);
    scene.setEnabled(true);
    scene.update(4, V(), true, 0);
    expect(scene.items.every(item => item.body!.isEnabled())).toBe(true);
    expect(scene.items.map(item => ({ ...item.body!.translation() }))).toEqual(positions);
  });

  it('does not impart latent explosion impulses to disabled fruit', async () => {
    const { scene, physics } = await market();
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 0)).toBe(true);
    const fruit = scene.items[0]!.body!;
    scene.setEnabled(false);
    const before = { ...fruit.linvel() };
    const center = { ...fruit.translation() };
    const onlyFruit = (body: typeof fruit) => body.handle !== fruit.handle;
    expect(applyExplosion(physics, center, 2, 15, onlyFruit)).toEqual([]);
    expect(fruit.linvel()).toEqual(before);
    scene.setEnabled(true);
    expect(applyExplosion(physics, center, 2, 15, onlyFruit)).toHaveLength(1);
    expect(fruit.linvel().y).toBeGreaterThan(before.y);
  });

  it('omits a missing crate and tears down bodies, budget entries and listeners idempotently', async () => {
    const empty = await market(12, false);
    expect(empty.scene.items).toHaveLength(0);
    expect(empty.scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 0)).toBe(false);
    const { scene, physics, budget, crate } = await market();
    scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 0);
    const handles = scene.items.map(item => item.body!.handle);
    scene.listeners.add(() => {});
    scene.dispose(); scene.dispose();
    expect(handles.every(handle => physics.raw.getRigidBody(handle) === null)).toBe(true);
    expect(budget.count).toBe(0);
    expect(scene.listeners.size).toBe(0);
    expect(crate.isValid()).toBe(true);
    expect(scene.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, 1)).toBe(false);
  });

  it('moves spilled fruit through real bleat input without scoring, while ordinary prop knocks still score', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 65 });
    try {
      // Isolate the physical target high above scenery so unrelated crate hits
      // and discovery rewards cannot hide a fruit-specific scoring regression.
      game.teleport(V(0, 200, 0), 0);
      expect(game.market.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, game.physics.time)).toBe(true);
      const fruit = game.market.items[0]!.body!;
      const placeNearGoat = (body: typeof fruit): void => {
        const p = game.goat.torso.translation();
        body.setTranslation(V(p.x + .65 * game.goat.size, p.y, p.z), true);
        body.setLinvel(V(), true);
      };
      placeNearGoat(fruit);
      // Two existing trick types make a third (knockback) capable of advancing
      // both the growth meter and combo challenge, not just raw style score.
      game.rules.awardStyle({ type: 'flip' });
      game.rules.awardStyle({ type: 'airtime' });
      const before = game.exportProgress();
      const knocked: number[] = [];
      const scored: string[] = [];
      game.goat.events.on(event => {
        if (event.type === 'knockedBody' && event.impulse > 2.5) knocked.push(event.bodyHandle);
      });
      game.rules.events.on('style:scored', event => scored.push(event.trick));
      game.step({ bleat: true });
      expect(knocked).toContain(fruit.handle);
      expect(scored).not.toContain('knockback');
      const after = game.exportProgress();
      expect(after.gameplay.style.score).toBe(before.gameplay.style.score);
      expect(after.gameplay.style.meter).toBe(before.gameplay.style.meter);
      expect(after.gameplay.style.combo).toEqual(before.gameplay.style.combo);
      expect(after.gameplay.challenges).toEqual(before.gameplay.challenges);
      expect(after.gameplay.wallet).toEqual(before.gameplay.wallet);
      expect(after.happenings).toEqual(before.happenings);

      // Positive control: after the cooldown, an ordinary dynamic prop in
      // exactly the same range still receives the normal progression event.
      for (let tick = 0; tick < 65; tick++) game.step();
      const box = game.physics.createBox(V(0, 200, 0), V(.1, .1, .1));
      placeNearGoat(box);
      game.step({ bleat: true });
      expect(knocked).toContain(box.handle);
      expect(scored).toContain('knockback');
      expect(game.rules.style.score).toBeGreaterThan(after.gameplay.style.score);
    } finally { game.dispose(); }
  });

  it('does not reward fruit tethers and releases them before an excluded-mode solve', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 65 });
    try {
      game.teleport(V(0, 200, 0), 0);
      for (let tick = 0; tick < 35; tick++) game.step();
      expect(game.market.disrupt(MARKET_CRATE_ID, V(1, 0, 0), 1, game.physics.time)).toBe(true);
      const fruit = game.market.items[0]!.body!;
      const origin = game.goat.interactions.tongueOrigin;
      fruit.setTranslation(V(origin.x + 2, origin.y, origin.z), true);
      fruit.setLinvel(game.goat.head.linvel(), true);
      game.step(); // Update the real Rapier query broadphase before attaching.
      const attach = (): void => {
        expect(game.goat.interactions.attachTongue(
          sub(fruit.translation(), game.goat.interactions.tongueOrigin))).toBe(true);
        expect(game.goat.interactions.tongueBody?.handle).toBe(fruit.handle);
      };
      const scored: string[] = [];
      game.rules.events.on('style:scored', event => scored.push(event.trick));
      const progress = game.exportProgress();
      attach();
      game.goat.torso.setLinvel(V(5, 0, 0), true);
      game.goat.interactions.detachTongue('released', false);
      expect(scored).not.toContain('tongue-swing');

      attach();
      let safeBeforeSolve = false;
      game.physics.onBeforeStep(() => {
        safeBeforeSolve = !game.goat.interactions.isTongueAttached &&
          game.market.items.every(item => !item.body!.isEnabled());
      });
      game.step({ toggleBuild: true });
      expect(game.buildMode).toBe(true);
      expect(safeBeforeSolve).toBe(true);
      expect(scored).not.toContain('tongue-swing');
      expect(scored).not.toContain('knockback');
      expect(game.exportProgress().gameplay.challenges).toEqual(progress.gameplay.challenges);
      expect(game.exportProgress().gameplay.wallet).toEqual(progress.gameplay.wallet);
    } finally { game.dispose(); }
  });

  it('does not pay or alter saved progression through repeated accepted scene disruptions', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 65 });
    try {
      const coins = game.rules.wallet.coins;
      const progress = game.exportProgress();
      expect(game.market.disrupt(MARKET_CRATE_ID, V(1, 0, .3), 1, game.physics.time)).toBe(true);
      for (let i = 0; i < 12; i++) {
        game.market.disrupt(MARKET_CRATE_ID, V(1, 0, .3), 1, game.physics.time);
        game.step();
      }
      expect(game.rules.wallet.coins).toBe(coins);
      expect(game.exportProgress().happenings).toEqual(progress.happenings);
      expect(game.market.activeBodies).toBeLessThanOrEqual(MARKET_FRUIT_LIMIT);
    } finally { game.dispose(); }
  });
});
