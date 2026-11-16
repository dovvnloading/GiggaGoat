import { describe, expect, it } from 'vitest';
import { CudWallet, UnlockRegistry, ChallengeTracker, EventBus, GameSimulation, TUNING } from './index';

describe('Cud Coins + unlock prerequisites', () => {
  it('never allows debt or negative/non-integer amounts and emits exact transactions', () => {
    const bus = new EventBus(); const wallet = new CudWallet(bus);
    const tx: string[] = [];
    bus.on('coins:changed', e => tx.push(`${e.before}->${e.after}`));
    expect(wallet.spend(1)).toBe(false);
    wallet.credit(50);
    expect(wallet.spend(18)).toBe(true);
    expect(wallet.coins).toBe(32);
    expect(tx).toEqual(['0->50', '50->32']);
    expect(() => wallet.credit(-1)).toThrow();
    expect(() => wallet.spend(2.3)).toThrow();
    expect(() => wallet.credit(Number.MAX_SAFE_INTEGER)).toThrow();
  });
  it('purchases gear/abilities exactly once and checks prerequisites before charging', () => {
    const bus = new EventBus(); const wallet = new CudWallet(bus, 250);
    const registry = new UnlockRegistry(wallet, bus);
    const awarded: string[] = [];
    bus.on('unlock:claimed', e => awarded.push(e.id));
    expect(registry.purchase('aerial-horns')).toEqual({ ok: false, reason: 'prerequisite' });
    expect(wallet.coins).toBe(250);
    expect(registry.purchase('glide')).toEqual({ ok: true });
    expect(registry.purchase('glide')).toEqual({ ok: false, reason: 'owned' });
    expect(registry.purchase('aerial-horns')).toEqual({ ok: true });
    expect(registry.purchase('kite-cape')).toEqual({ ok: true });
    expect(registry.purchase('meteor-horns')).toEqual({ ok: true });
    expect(registry.isUnlocked('meteor-horns')).toBe(true);
    expect(awarded).toEqual(['glide', 'aerial-horns', 'kite-cape', 'meteor-horns']);
    expect(wallet.coins).toBe(250 - 30 - 75 - 45 - 100);
    expect(registry.catalog.find(e => e.id === 'neon-hooves')?.category).toBe('gear');
  });
  it('does not spend without enough coins, and snapshots reject orphaned prerequisites', () => {
    const bus = new EventBus(); const wallet = new CudWallet(bus);
    const registry = new UnlockRegistry(wallet, bus);
    expect(registry.purchase('glide')).toEqual({ ok: false, reason: 'coins' });
    wallet.credit(40);
    registry.purchase('glide');
    const restored = UnlockRegistry.fromJSON(registry.toJSON(), wallet, new EventBus());
    expect(restored.toJSON()).toEqual(registry.toJSON());
    expect(() => UnlockRegistry.fromJSON({ unlocked: ['meteor-horns'] }, wallet, bus)).toThrow();
    expect(() => UnlockRegistry.fromJSON({ unlocked: ['glide', 'glide'] }, wallet, bus)).toThrow();
  });
});

describe('event-driven challenges', () => {
  it('awards five-trick combo and climbing 50m exactly once, preserving completed progress', () => {
    const game = new GameSimulation(42);
    const completed: string[] = [];
    game.events.on('challenge:completed', e => completed.push(e.id));
    for (const type of ['flip', 'airtime', 'near-miss', 'topple', 'big-splash'] as const) game.awardStyle({ type });
    expect(game.challenges.getProgress('five-trick-combo')).toEqual({ value: 5, completed: true });
    expect(game.wallet.coins).toBe(TUNING.progression.challengeRewards['five-trick-combo']);
    game.recordClimb(32.5);
    expect(game.challenges.getProgress('mountain-goat').value).toBe(32.5);
    game.recordClimb(17.5);
    expect(game.challenges.getProgress('mountain-goat')).toEqual({ value: 50, completed: true });
    expect(completed).toEqual(['five-trick-combo', 'mountain-goat']);
    const saved = game.toJSON();
    const restored = GameSimulation.fromJSON(JSON.parse(JSON.stringify(saved)) as unknown);
    for (let i = 0; i < 10; i++) restored.recordClimb(10);
    for (let i = 0; i < 8; i++) restored.awardStyle({ type: 'flip' });
    expect(restored.wallet.coins).toBe(game.wallet.coins);
    expect(restored.challenges.getProgress('mountain-goat')).toEqual({ value: 50, completed: true });
  });

  it('requires three distinct trick types for the signature five-trick challenge', () => {
    const game = new GameSimulation();
    for (let i = 0; i < 20; i++) game.awardStyle({ type: 'flip' });
    expect(game.challenges.getProgress('five-trick-combo').completed).toBe(false);
    game.awardStyle({ type: 'near-miss' });
    expect(game.challenges.getProgress('five-trick-combo').completed).toBe(false);
    game.awardStyle({ type: 'topple' });
    expect(game.challenges.getProgress('five-trick-combo').completed).toBe(true);
  });
  it('reads destruction, tongue swing and building from the shared event bus', () => {
    const bus = new EventBus(); const wallet = new CudWallet(bus);
    const challenges = new ChallengeTracker(wallet, bus);
    for (let i = 0; i < 10; i++) bus.emit('style:scored', {
      trick: 'destruction', comboCount: 1, points: 10, comboPoints: 10,
      distinct: 1, multiplier: 1, title: 'WARM-UP', meter: 0,
    });
    for (let i = 0; i < 8; i++) bus.emit('style:scored', {
      trick: 'tongue-swing', comboCount: 1, points: 10, comboPoints: 10,
      distinct: 1, multiplier: 1, title: 'WARM-UP', meter: 0,
    });
    for (let i = 0; i < 12; i++) bus.emit('build:placed', {
      piece: { id: i + 1, type: 'floor', cell: { x: i, y: 0, z: 0 }, rotation: 0, hp: 60 },
    });
    expect(challenges.getProgress('wrecking-crew').completed).toBe(true);
    expect(challenges.getProgress('sling-king').completed).toBe(true);
    expect(challenges.getProgress('master-builder').completed).toBe(true);
    expect(wallet.coins).toBe(70);
    expect(ChallengeTracker.fromJSON(challenges.toJSON(), wallet, new EventBus()).toJSON()).toEqual(challenges.toJSON());
  });
});
