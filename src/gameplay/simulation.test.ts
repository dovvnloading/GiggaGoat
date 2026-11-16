import { describe, expect, it } from 'vitest';
import { GameSimulation, TUNING } from './index';
import type { GoatPhysicsFacts } from './index';
const dt = TUNING.fixedDt;
const wall: GoatPhysicsFacts = { grounded: false, touchingSteepWall: true, airborneTime: 1, speed: 4, size: 'Kid' };
const grounded: GoatPhysicsFacts = { grounded: true, touchingSteepWall: false, airborneTime: 0, speed: 3, size: 'Billy' };

describe('GameSimulation deterministic fixed tick', () => {
  it('produces equivalent states for two half ticks vs one whole tick', () => {
    const a = new GameSimulation(100); const b = new GameSimulation(100);
    const partial = a.update(dt / 2, { sprint: true }, grounded);
    expect(partial.ticks).toBe(0);
    expect(partial.commands).toEqual([]);
    expect(partial.alpha).toBeCloseTo(0.5);
    expect(a.update(dt / 2, { sprint: true }, grounded).ticks).toBe(1);
    expect(b.update(dt, { sprint: true }, grounded).ticks).toBe(1);
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(a.update(dt * 2, { sprint: true }, grounded).ticks).toBe(2);
    b.update(dt, { sprint: true }, grounded); b.update(dt, { sprint: true }, grounded);
    expect(a.toJSON()).toEqual(b.toJSON());
  });
  it('exposes the exact physics command for every tick and isolates independent games', () => {
    const a = new GameSimulation(); const b = new GameSimulation();
    const step = a.update(dt * 3, { sprint: true }, grounded);
    expect(step.ticks).toBe(3);
    expect(step.commands).toHaveLength(3);
    expect(step.commands.every(c => c.setSprint)).toBe(true);
    expect(a.abilities.stamina).toBeLessThan(b.abilities.stamina);
    expect(a.tick).toBe(3); expect(b.tick).toBe(0);
  });
  it('uses style-driven size modifiers and requires unlocked glide', () => {
    const game = new GameSimulation();
    expect(game.update(dt, { glide: true }, wall).commands[0]?.setGlide).toBe(false);
    game.wallet.credit(30);
    expect(game.unlocks.purchase('glide')).toEqual({ ok: true });
    expect(game.update(dt, { glide: true }, wall).commands[0]?.setGlide).toBe(true);
    const tricks = ['flip', 'airtime', 'wall-climb', 'tongue-swing', 'knockback',
      'topple', 'destruction', 'near-miss', 'ragdoll-bounce', 'big-splash'] as const;
    for (const type of tricks) game.awardStyle({ type, quality: 2 });
    expect(game.style.tier).toBe('GIGGA');
    const c = game.update(dt, { climb: true, chargeHeadbutt: true }, wall).commands[0]!;
    expect(c.modifiers.scale).toBe(3);
    expect(c.setClimb).toBe(false);
  });
  it('receives measured traversal, not invented horizontal speed, and preserves frame split', () => {
    const game = new GameSimulation();
    const first = game.update(dt / 2, { climb: true }, { ...wall, climbDistance: 0.6 });
    expect(first.ticks).toBe(0);
    game.update(dt / 2, { climb: true }, { ...wall, climbDistance: 0.4 });
    expect(game.challenges.getProgress('mountain-goat').value).toBeCloseTo(1);
    game.update(dt, { climb: false }, { ...wall, speed: 999 });
    expect(game.challenges.getProgress('mountain-goat').value).toBeCloseTo(1);
  });
  it('round-trips entire state (RNG, builds, charge, timers, coins and pending partial tick)', () => {
    const a = new GameSimulation(2026);
    a.rng.next(); a.rng.next();
    a.inventory.harvest('hay', 10);
    a.build.place({ type: 'ramp', cell: { x: 0, y: 0, z: 0 }, rotation: 1 });
    a.build.place({ type: 'wall', cell: { x: 0, y: 1, z: 0 }, rotation: 0 });
    a.awardStyle({ type: 'flip' }); a.awardStyle({ type: 'near-miss' });
    a.wallet.credit(95); a.unlocks.purchase('glide');
    a.recordClimb(12);
    a.update(dt * 31, { chargeHeadbutt: true }, grounded);
    a.update(dt / 2, {}, grounded);
    const state = JSON.parse(JSON.stringify(a.toJSON())) as unknown;
    const b = GameSimulation.fromJSON(state);
    expect(b.toJSON()).toEqual(a.toJSON());
    expect(b.rng.next()).toBe(a.rng.next());
    const aResult = a.update(dt / 2, {}, grounded);
    const bResult = b.update(dt / 2, {}, grounded);
    expect(aResult).toEqual(bResult);
    expect(b.toJSON()).toEqual(a.toJSON());
    expect(b.build.place({ type: 'floor', cell: { x: 1, y: 0, z: 0 }, rotation: 0 }).piece?.id).toBe(3);
    expect(a.build.place({ type: 'floor', cell: { x: 1, y: 0, z: 0 }, rotation: 0 }).piece?.id).toBe(3);
    expect(b.toJSON()).toEqual(a.toJSON());
  });

  it('latches one-tick inputs and collision impact across sub-tick frame boundaries', () => {
    const half = new GameSimulation(7); const whole = new GameSimulation(7);
    half.update(dt / 2, { jump: true }, { ...grounded, impact: 30 });
    const before = half.toJSON();
    expect(before.pendingImpact).toBe(30);
    expect(before.pendingPulses.jump).toBe(true);
    const replayed = GameSimulation.fromJSON(before);
    const a = half.update(dt / 2, {}, grounded);
    const b = replayed.update(dt / 2, {}, grounded);
    expect(a.commands[0]?.jump?.kind).toBe('jump');
    expect(a.commands).toEqual(b.commands);
    expect(half.abilities.balance).toBe(70);
    expect(half.toJSON()).toEqual(replayed.toJSON());
    const direct = whole.update(dt, { jump: true }, { ...grounded, impact: 30 });
    expect(direct.commands[0]?.jump).toEqual(a.commands[0]?.jump);
    expect(whole.toJSON()).toEqual(half.toJSON());
  });
  it('rejects giant catch-up advances without touching existing state', () => {
    const game = new GameSimulation();
    const original = game.toJSON();
    expect(() => game.update(TUNING.fixedDt * (TUNING.maxTicksPerAdvance + 1),
      { jump: true }, { ...grounded, impact: 70 })).toThrow();
    expect(game.toJSON()).toEqual(original);
  });
  it('snapshots do not leak mutable state and restore does not replay rewards', () => {
    const a = new GameSimulation();
    a.inventory.harvest('hay', 10);
    a.awardStyle({ type: 'flip' });
    const snapshot = a.toJSON();
    snapshot.inventory.hay = 0;
    snapshot.style.combo.recent.push('forged');
    expect(a.inventory.get('hay')).toBe(28);
    expect(a.style.combo.recent).toEqual(['flip']);
    const b = GameSimulation.fromJSON(a.toJSON());
    expect(b.wallet.coins).toBe(a.wallet.coins);
  });
  it('rejects malformed version, negative dt, invalid remainder and collision payloads', () => {
    const game = new GameSimulation();
    expect(() => game.update(-dt)).toThrow();
    expect(() => game.update(Infinity)).toThrow();
    expect(() => game.update(dt, {}, { ...wall, impact: NaN })).toThrow();
    expect(() => GameSimulation.fromJSON({ ...game.toJSON(), version: 2 })).toThrow();
    expect(() => GameSimulation.fromJSON({ ...game.toJSON(), remainder: -1 })).toThrow();
  });
});
