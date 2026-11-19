import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../gameplay';
import { DEFAULT_AUDIO_SETTINGS, type AudioFrame, type AudioSettings } from '../audio';
import type { Game } from './Game';
import { GameAudio, type AudioSink } from './GameAudio';
import { DEFAULT_SETTINGS, validateSettings } from './Persistence';

function eventQueue<T>(initial: T[] = []) {
  const pending = [...initial];
  return {
    push: (value: T): void => { pending.push(value); },
    drain: vi.fn(() => pending.splice(0)),
  };
}

function fixture() {
  const physics = eventQueue([
    { type: 'flipped', goatId: 'player', time: 1, rotations: 1 },
    { type: 'wallClingEnd', goatId: 'player', time: 2 },
  ]);
  const water = eventQueue([{ type: 'splash', time: 1, bodyHandle: 100,
    mass: 20, impactSpeed: 7, volumeId: 'sea', displacedVolume: 1 }]);
  const breakables = eventQueue([{ type: 'destruction', time: 1, bodyHandle: 101,
    mass: 20, cause: 'impact', position: { x: 1, y: 2, z: 3 }, debrisHandles: [] }]);
  const chains = eventQueue([{ type: 'topple', time: 1, bodyHandle: 102, tiltRadians: 1 }]);
  const surfaces = eventQueue([{ type: 'bounce', time: 1, surfaceId: 'trampoline',
    bodyHandle: 103, speed: 8 }]);
  const modes = eventQueue([{ type: 'tide.warning', tick: 9, sequence: 4,
    level: 5, dryArea: 32, ticksUntilRise: 60 }]);
  const gigs = eventQueue([{ type: 'board.rotated', tick: 3, seq: 1,
    poiId: 'hoofington', cycle: 1 }]);
  const events = new EventBus();
  const goat = {
    id: 'player', size: 1,
    torso: { translation: () => ({ x: 0, y: 2, z: 0 }),
      linvel: () => ({ x: 3, y: 0, z: 4 }) },
    locomotion: { grounded: true }, events: physics,
  };
  const game = {
    island: {
      size: 10, resolution: 2, seaLevel: 0, tideLevels: [0, 10],
      biomeMap: new Uint8Array(4).fill(2), zoneMap: new Uint8Array(4).fill(1), pois: [],
    },
    goat, rules: { events, style: { combo: { count: 3 }, meter: 67 } },
    party: { bots: new Map(), match: { mode: 'rising-tide', tideLevel: 5,
      drainEvents: modes.drain } },
    gigs: { director: { drainEvents: gigs.drain } },
    water: { seaLevel: 0, events: water }, breakables: { events: breakables },
    chains: { events: chains }, surfaces: { events: surfaces },
    physics: { raw: { getRigidBody: (handle: number) =>
      handle === 100 ? { translation: () => ({ x: 4, y: 5, z: 6 }) } : null } },
  } as unknown as Game;
  const audio = {
    audioContext: null,
    beginResultAudio: vi.fn<(kind: 'gig' | 'party') => number | null>(() => null),
    endResultAudio: vi.fn(),
    updateFrame: vi.fn((_frame: AudioFrame) => {}),
    setSettings: vi.fn((settings: Partial<AudioSettings>) =>
      ({ ...DEFAULT_AUDIO_SETTINGS, ...settings })),
  } satisfies AudioSink;
  return { game, events, audio, physics, water, breakables, chains, surfaces, modes, gigs };
}

afterEach(() => vi.restoreAllMocks());

describe('core audio render bridge', () => {
  it('updates a fake AudioEngine once per frame with every lane drained exactly once', () => {
    const f = fixture();
    const bridge = new GameAudio(f.game, f.audio);
    const camera = { position: { x: 1, y: 8, z: 9 },
      forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };
    try {
      f.events.emit('style:scored', { trick: 'flip', points: 15,
        comboPoints: 35, comboCount: 3, distinct: 2, multiplier: 1,
        title: 'AIR ACE', meter: 67 });
      bridge.onInput({ chargeHeadbutt: true });
      bridge.queueCue({ sound: 'ui-confirm' });
      bridge.frame(1 / 60, camera, false);

      expect(f.audio.updateFrame).toHaveBeenCalledTimes(1);
      const first = f.audio.updateFrame.mock.calls[0]![0];
      expect(first.dt).toBeCloseTo(1 / 60);
      expect(first.camera).toEqual(camera);
      expect(first.state).toEqual({
        mode: 'party', combo: 3, meter: 67, tide: .5, poi: 'hoofington', night: false,
      });
      expect(first.physics).toHaveLength(2);
      expect(first.chaos).toHaveLength(4);
      expect(first.gameplay).toEqual([expect.objectContaining({ type: 'style:scored' })]);
      expect(first.modes).toHaveLength(1);
      expect(first.gigs).toHaveLength(1);
      expect(first.cues).toEqual([
        { sound: 'headbutt-charge', intensity: .35 }, { sound: 'ui-confirm' },
      ]);
      expect(first.goats?.[0]).toMatchObject({
        id: 'player', size: 1, speed: 5, grounded: true, surface: 'grass',
      });
      expect(first.positionForGoat?.('player')).toEqual({ x: 0, y: 2, z: 0 });
      expect(first.positionForBody?.(100)).toEqual({ x: 4, y: 5, z: 6 });
      expect(first.sizeForGoat?.('player')).toBe(1);
      for (const queue of [f.physics, f.water, f.breakables,
        f.chains, f.surfaces, f.modes, f.gigs]) {
        expect(queue.drain).toHaveBeenCalledTimes(1);
      }

      bridge.onInput({ chargeHeadbutt: true }); // held charge does not retrigger
      bridge.frame(1 / 30, camera, true);
      expect(f.audio.updateFrame).toHaveBeenCalledTimes(2);
      const second = f.audio.updateFrame.mock.calls[1]![0];
      expect(second.physics).toEqual([]);
      expect(second.chaos).toEqual([]);
      expect(second.gameplay).toEqual([]);
      expect(second.modes).toEqual([]);
      expect(second.gigs).toEqual([]);
      expect(second.cues).toEqual([]);
      expect(second.state?.night).toBe(true);
      for (const queue of [f.physics, f.water, f.breakables,
        f.chains, f.surfaces, f.modes, f.gigs]) {
        expect(queue.drain).toHaveBeenCalledTimes(2);
      }
    } finally { bridge.dispose(); }
  });

  it('applies independent audio buses and validates legacy saved volume preferences', () => {
    const f = fixture();
    const bridge = new GameAudio(f.game, f.audio);
    try {
      const settings = { ...DEFAULT_SETTINGS,
        volume: .25, musicVolume: .4, effectsVolume: .75 };
      bridge.setVolumes(settings);
      expect(f.audio.setSettings).toHaveBeenCalledWith({
        master: .25, music: .4, sfx: .75,
      });
      expect(validateSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
      expect(validateSettings({ volume: .55 })).toEqual({
        ...DEFAULT_SETTINGS, volume: .55,
      });
      expect(validateSettings({ volume: 2, musicVolume: -1, effectsVolume: .6 }))
        .toMatchObject({ volume: 1, musicVolume: 0, effectsVolume: .6 });
    } finally { bridge.dispose(); }
  });


  it('lets a visible result advance to its audio deadline, then suspends without restarting its tail', async () => {
    const f = fixture();
    const context = {
      state: 'running', currentTime: 12,
      suspend: vi.fn(async () => { context.state = 'suspended'; }),
      resume: vi.fn(async () => { context.state = 'running'; }),
    };
    const sink: AudioSink = { ...f.audio, audioContext: context as unknown as AudioContext };
    f.audio.beginResultAudio.mockReturnValue(13.588);
    const bridge = new GameAudio(f.game, sink);
    const camera = { position: { x: 0, y: 2, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
    try {
      bridge.playResultAudio('gig');
      expect(f.audio.beginResultAudio).toHaveBeenCalledOnce();
      expect(f.audio.beginResultAudio).toHaveBeenCalledWith('gig');
      expect(context.suspend).not.toHaveBeenCalled();
      context.currentTime = 12.781;
      bridge.frame(1 / 60, camera, false);
      expect(context.suspend).not.toHaveBeenCalled();

      context.currentTime = 13.589;
      bridge.frame(1 / 60, camera, false);
      await Promise.resolve();
      expect(context.suspend).toHaveBeenCalledOnce();
      expect(f.audio.endResultAudio).not.toHaveBeenCalled();

      bridge.setPaused(false);
      await Promise.resolve();
      expect(f.audio.endResultAudio).toHaveBeenCalledOnce();
      expect(context.resume).toHaveBeenCalledOnce();
      expect(f.audio.beginResultAudio).toHaveBeenCalledOnce();
    } finally { bridge.dispose(); }
  });

  it.each([true, false])('cancels a live result tail when its screen is replaced with paused=%s', async paused => {
    const f = fixture();
    const context = {
      state: 'running', currentTime: 12,
      suspend: vi.fn(async () => { context.state = 'suspended'; }),
      resume: vi.fn(async () => { context.state = 'running'; }),
    };
    const sink: AudioSink = { ...f.audio, audioContext: context as unknown as AudioContext };
    f.audio.beginResultAudio.mockReturnValue(13.99);
    const bridge = new GameAudio(f.game, sink);
    try {
      bridge.playResultAudio('party');
      bridge.setPaused(paused);
      await Promise.resolve();
      expect(f.audio.endResultAudio).toHaveBeenCalledOnce();
      expect(context.suspend).toHaveBeenCalledTimes(paused ? 1 : 0);
      expect(context.resume).not.toHaveBeenCalled();
    } finally { bridge.dispose(); }
  });

  it('suspends for a paused/hidden game and resumes only a previously unlocked context', async () => {
    const f = fixture();
    const context = {
      state: 'running',
      suspend: vi.fn(async () => { context.state = 'suspended'; }),
      resume: vi.fn(async () => { context.state = 'running'; }),
    };
    const sink: AudioSink = { ...f.audio, audioContext: context as unknown as AudioContext };
    const bridge = new GameAudio(f.game, sink);
    try {
      bridge.setPaused(true);
      await Promise.resolve();
      expect(context.suspend).toHaveBeenCalledTimes(1);
      bridge.setPaused(false);
      await Promise.resolve();
      expect(context.resume).toHaveBeenCalledTimes(1);
    } finally { bridge.dispose(); }
  });
});
