import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../gameplay';
import type { Game } from './Game';
import { GameVfx, type GameVfxEffects } from './GameVfx';

/** These subscribers mirror the synchronous physics/chaos buses without draining. */
class Stream {
  private readonly listeners = new Set<(value: unknown) => void>();
  readonly drain = vi.fn(() => []);
  on(callback: (value: never) => void): () => void {
    const listener = callback as (value: unknown) => void;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  emit(value: unknown): void {
    for (const listener of this.listeners) listener(value);
  }
}

function fakeEffects() {
  const effect = () => ({
    group: new THREE.Group(), emit: vi.fn(), update: vi.fn(), dispose: vi.fn(),
  });
  const aura = {
    group: new THREE.Group(), attach: vi.fn(), setTier: vi.fn(),
    triggerGrow: vi.fn(), update: vi.fn(), dispose: vi.fn(),
  };
  aura.attach.mockImplementation((target: THREE.Object3D) => {
    target.add(aura.group);
    return aura;
  });
  const effects = {
    dust: effect(), landing: effect(), headbutt: effect(),
    water: effect(), crate: effect(), trampoline: effect(),
    launch: effect(), combo: effect(), aura, coin: effect(),
  };
  return effects;
}

function fixture() {
  const root = new THREE.Group();
  const chest = new THREE.Object3D();
  root.add(chest);
  const scene = new THREE.Scene();
  const effects = fakeEffects();
  const steps = new Stream(), goatEvents = new Stream();
  const waterEvents = new Stream(), surfaceEvents = new Stream();
  const vfxCues = new Stream(), breakables = new Stream();
  const rulesEvents = new EventBus();
  const hoof = { translation: () => ({ x: 3, y: .2, z: -2 }) };
  const goat = {
    id: 'player', phase: 0, pose: 'gallop', size: .6, mass: 6,
    getPart: vi.fn(() => hoof), ownsBody: (handle: number) => handle === 10,
    torso: {
      translation: () => ({ x: 3, y: 1.2, z: -2 }),
      linvel: () => ({ x: 6, y: -1, z: -1 }),
    },
    locomotion: {
      input: { sprint: true }, grounded: true,
      groundHit: { point: { x: 3, y: 0, z: -2 }, normal: { x: 0, y: 1, z: 0 } },
    },
    events: goatEvents,
  };
  const game = {
    goat,
    rules: { events: rulesEvents, style: { tier: 'Kid', combo: { count: 0 } } },
    surfaceMarkers: [
      { id: 'spring', kind: 'trampoline', position: { x: 6, y: 2, z: 7 },
        halfExtents: { x: 2.1, y: .23, z: 2.1 } },
      { id: 'pad', kind: 'launch', position: { x: 8, y: 3, z: 9 },
        halfExtents: { x: 2.1, y: .23, z: 2.1 },
        direction: { x: .2, y: .93, z: -.3 } },
    ],
    buildBodies: new Map([[7, { translation: () => ({ x: 5, y: 4, z: -1 }) }]]),
    physics: {
      onAfterStep: (callback: (dt: number) => void) => steps.on(callback as (e: never) => void),
      raw: { getRigidBody: (handle: number) =>
        handle === 42 ? { translation: () => ({ x: 4, y: -2, z: 5 }) } : null },
    },
    water: { seaLevel: 0, listVolumes: () => [], events: waterEvents },
    surfaces: { events: surfaceEvents },
    breakables: { events: breakables },
    onVfxCue: (listener: (cue: never) => void) => vfxCues.on(listener),
  } as unknown as Game;
  const owner = new GameVfx(scene, game, root, chest, effects as unknown as GameVfxEffects);
  return { owner, effects, goat, root, chest, scene, steps, goatEvents, waterEvents,
    surfaceEvents, vfxCues, rulesEvents, breakables };
}

function score(bus: EventBus, comboCount: number): void {
  bus.emit('style:scored', {
    trick: 'flip', points: 12, comboPoints: 35, comboCount,
    distinct: 2, multiplier: 1, title: 'TRICK CHAIN', meter: 60,
  });
}

describe('GameVfx gameplay integration', () => {
  it('routes all ten real event types to exactly their corresponding effect', () => {
    const f = fixture();
    try {
      f.goat.phase = Math.PI / 2 + .05;
      f.steps.emit(1 / 60);
      expect(f.effects.dust.emit).toHaveBeenCalledTimes(1);
      expect(f.effects.dust.emit).toHaveBeenCalledWith(
        { x: 3, y: .025, z: -2 }, { x: 6, y: 0, z: -1 });

      f.goatEvents.emit({ type: 'landed', goatId: 'player',
        airtime: 1.1, verticalSpeed: 8, time: 2 });
      expect(f.effects.landing.emit).toHaveBeenCalledTimes(1);
      expect(f.effects.landing.emit.mock.calls[0]?.[0]).toEqual({ x: 3, y: 0, z: -2 });

      f.vfxCues.emit({ type: 'headbutt-hit',
        position: { x: 1, y: 2, z: 3 }, direction: { x: 0, y: 0, z: 1 }, power: 1.5 });
      expect(f.effects.headbutt.emit).toHaveBeenCalledExactlyOnceWith(
        { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 }, 1.5);

      f.waterEvents.emit({ type: 'enter', bodyHandle: 42, mass: 12,
        impactSpeed: 4, volumeId: 'sea' });
      f.waterEvents.emit({ type: 'splash', bodyHandle: 42, mass: 12,
        impactSpeed: 4, volumeId: 'sea' }); // same entry; no second burst
      expect(f.effects.water.emit).toHaveBeenCalledExactlyOnceWith(
        { x: 4, y: 0, z: 5 }, 4, 2);

      f.vfxCues.emit({ type: 'crate-break',
        position: { x: 9, y: 0, z: 2 }, direction: { x: 1, y: 0, z: 0 }, size: 1.3 });
      expect(f.effects.crate.emit).toHaveBeenCalledExactlyOnceWith(
        { x: 9, y: 0, z: 2 }, { x: 1, y: 0, z: 0 }, 1.3);

      f.surfaceEvents.emit({ type: 'bounce', surfaceId: 'spring', bodyHandle: 10, speed: 13 });
      f.surfaceEvents.emit({ type: 'launch', surfaceId: 'pad', bodyHandle: 10, speed: 15 });
      expect(f.effects.trampoline.emit).toHaveBeenCalledExactlyOnceWith(
        { x: 6, y: 1.77, z: 7 }, 1, 13 / 8);
      expect(f.effects.launch.emit).toHaveBeenCalledExactlyOnceWith(
        { x: 8, y: 2.77, z: 9 }, { x: .2, y: .93, z: -.3 }, 1.5);

      score(f.rulesEvents, 2);
      score(f.rulesEvents, 3);
      score(f.rulesEvents, 4);
      expect(f.effects.combo.emit).toHaveBeenCalledTimes(3);
      expect(f.effects.combo.emit.mock.calls.map(call => call[1])).toEqual([2, 3, 4]);

      f.rulesEvents.emit('size:changed',
        { from: 'Kid', to: 'Billy', targetScale: 1 });
      f.rulesEvents.emit('size:changed',
        { from: 'Billy', to: 'Big', targetScale: 1.6 });
      f.rulesEvents.emit('size:changed',
        { from: 'Big', to: 'GIGGA', targetScale: 3 });
      expect(f.effects.aura.triggerGrow.mock.calls.map(call => call[0])).toEqual([1, 2, 3]);

      f.rulesEvents.emit('coins:changed', { before: 10, after: 25, reason: 'gig' });
      expect(f.effects.coin.emit).toHaveBeenCalledTimes(1);
      expect(f.effects.coin.emit.mock.calls[0]?.[1]).toBe(f.chest);
    } finally {
      f.owner.dispose();
    }
  });

  it('ignores ineligible/repeated events and handles built launch pads and tier downgrades', () => {
    const f = fixture();
    try {
      f.goat.phase = 0;
      f.steps.emit(1 / 60);
      f.goat.phase = Math.PI / 2 + .1;
      f.goat.locomotion.input.sprint = false;
      f.steps.emit(1 / 60);
      expect(f.effects.dust.emit).not.toHaveBeenCalled();
      f.goat.locomotion.input.sprint = true;
      f.steps.emit(1 / 60);
      expect(f.effects.dust.emit).not.toHaveBeenCalled(); // no invented touchdown

      f.goatEvents.emit({ type: 'landed', airtime: .12, verticalSpeed: 2 });
      expect(f.effects.landing.emit).not.toHaveBeenCalled();
      f.surfaceEvents.emit({ type: 'bounce', surfaceId: 'spring', bodyHandle: 42, speed: 13 });
      expect(f.effects.trampoline.emit).not.toHaveBeenCalled(); // not the goat
      f.surfaceEvents.emit({ type: 'launch', surfaceId: 'hay-7', bodyHandle: 10, speed: 13 });
      expect(f.effects.launch.emit).toHaveBeenCalledExactlyOnceWith(
        { x: 5, y: 4.14, z: -1 }, { x: 0, y: 0, z: -1 }, 1.3);

      score(f.rulesEvents, 2);
      score(f.rulesEvents, 2);
      score(f.rulesEvents, 3);
      score(f.rulesEvents, 4);
      score(f.rulesEvents, 5);
      expect(f.effects.combo.emit).toHaveBeenCalledTimes(3);
      f.rulesEvents.emit('combo:ended', { points: 90, tricks: 5, title: 'HOOF' });
      score(f.rulesEvents, 2);
      expect(f.effects.combo.emit).toHaveBeenCalledTimes(4);
      f.rulesEvents.emit('size:changed', { from: 'GIGGA', to: 'Big', targetScale: 1.6 });
      expect(f.effects.aura.setTier).toHaveBeenLastCalledWith(2);
      f.rulesEvents.emit('coins:changed', { before: 25, after: 12, reason: 'purchase' });
      expect(f.effects.coin.emit).not.toHaveBeenCalled();
    } finally {
      f.owner.dispose();
    }
  });

  it('updates each pool once per render frame, never drains audio queues, and cleans up', () => {
    const f = fixture();
    const names = ['dust', 'landing', 'headbutt', 'water', 'crate',
      'trampoline', 'launch', 'combo', 'aura', 'coin'] as const;
    expect(f.scene.children).toHaveLength(9);
    expect(f.effects.aura.attach).toHaveBeenCalledTimes(1);
    expect(f.effects.aura.setTier).toHaveBeenCalledWith(0);
    f.owner.frame(1 / 60);
    f.owner.frame(1 / 30);
    for (const name of names) {
      expect(f.effects[name].update).toHaveBeenCalledTimes(2);
      expect(f.effects[name].update).toHaveBeenNthCalledWith(1, 1 / 60);
      expect(f.effects[name].update).toHaveBeenNthCalledWith(2, 1 / 30);
    }
    expect(f.goatEvents.drain).not.toHaveBeenCalled();
    expect(f.waterEvents.drain).not.toHaveBeenCalled();
    expect(f.surfaceEvents.drain).not.toHaveBeenCalled();
    expect(f.breakables.drain).not.toHaveBeenCalled();
    f.owner.dispose();
    f.owner.dispose();
    expect(f.scene.children).toHaveLength(0);
    for (const name of names) {
      expect(f.effects[name].dispose).toHaveBeenCalledTimes(1);
      expect(f.effects[name].group.parent).toBeNull();
    }
    f.vfxCues.emit({ type: 'headbutt-hit', position: { x: 1, y: 2, z: 3 },
      direction: { x: 1, y: 0, z: 0 }, power: 1 });
    f.rulesEvents.emit('coins:changed', { before: 0, after: 1, reason: 'test' });
    f.owner.frame(1 / 60);
    expect(f.effects.headbutt.emit).not.toHaveBeenCalled();
    expect(f.effects.coin.emit).not.toHaveBeenCalled();
    expect(f.effects.dust.update).toHaveBeenCalledTimes(2);
  });
});
