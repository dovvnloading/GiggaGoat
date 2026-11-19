import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../gameplay';
import type { DestructionEvent } from '../chaos';
import { DEFAULT_AUDIO_SETTINGS, type AudioFrame, type AudioSettings } from '../audio';
import { V, forward } from '../physics';
import { Game, type MaterialAudioContact } from './Game';
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
  const breakables = eventQueue<DestructionEvent>([{ type: 'destruction', time: 1, bodyHandle: 101,
    mass: 20, cause: 'impact', position: { x: 1, y: 2, z: 3 }, debrisHandles: [] }]);
  const chains = eventQueue([{ type: 'topple', time: 1, bodyHandle: 102, tiltRadians: 1 }]);
  const surfaces = eventQueue([{ type: 'bounce', time: 1, surfaceId: 'trampoline',
    bodyHandle: 103, speed: 8 }]);
  const modes = eventQueue([{ type: 'tide.warning', tick: 9, sequence: 4,
    level: 5, dryArea: 32, ticksUntilRise: 60 }]);
  const gigs = eventQueue([{ type: 'board.rotated', tick: 3, seq: 1,
    poiId: 'hoofington', cycle: 1 }]);
  const events = new EventBus();
  const materialAudio = new Set<(contact: MaterialAudioContact) => void>();
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
    isAbovePierDeck: () => false,
    goat, rules: { events, style: { combo: { count: 3 }, meter: 67 } },
    party: { bots: new Map(), match: { mode: 'rising-tide', tideLevel: 5,
      drainEvents: modes.drain } },
    gigs: { director: { drainEvents: gigs.drain } },
    water: { seaLevel: 0, events: water }, breakables: { events: breakables },
    chains: { events: chains }, surfaces: { events: surfaces },
    onMaterialAudio: (listener: (contact: MaterialAudioContact) => void) => {
      materialAudio.add(listener);
      return () => { materialAudio.delete(listener); };
    },
    physics: { raw: { getRigidBody: (handle: number) =>
      handle === 100 ? { translation: () => ({ x: 4, y: 5, z: 6 }) } : null } },
  } as unknown as Game;
  const audio = {
    audioContext: null,
    beginResultAudio: vi.fn<(kind: 'gig' | 'party') => number | null>(() => null),
    endResultAudio: vi.fn(),
    setMenuAudio: vi.fn(),
    clearVoices: vi.fn(), stopCue: vi.fn(),
    play: vi.fn(() => true),
    updateFrame: vi.fn((_frame: AudioFrame) => {}),
    setSettings: vi.fn((settings: Partial<AudioSettings>) =>
      ({ ...DEFAULT_AUDIO_SETTINGS, ...settings })),
  } satisfies AudioSink;
  return { game, events, audio, physics, water, breakables, chains, surfaces, modes, gigs,
    emitMaterial: (contact: MaterialAudioContact) => { for (const listener of materialAudio) listener(contact); } };
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

  it('uses timber footfalls on the raised pier even over the ocean biome', () => {
    const f = fixture();
    f.game.island.biomeMap.fill(0);
    vi.spyOn(f.game, 'isAbovePierDeck').mockReturnValue(true);
    const bridge = new GameAudio(f.game, f.audio);
    try {
      bridge.frame(1 / 60, { position: V(), forward: V(0, 0, -1) }, false);
      expect(f.audio.updateFrame.mock.calls[0]![0].goats?.[0]?.surface).toBe('wood');
    } finally { bridge.dispose(); }
  });

  it('uses recorded materials only for the exact hit or break that supplied them', () => {
    const f = fixture();
    const bridge = new GameAudio(f.game, f.audio);
    const point = V(4, 3, 2);
    const knock = { type: 'knockedBody', goatId: 'player', time: 2, bodyHandle: 201,
      mass: 12, speed: 6, impulse: 30 } as const;
    // A bleat or fling can knock the same body in the same tick. It has no
    // exact headbutt metadata and should still go through the base physics lane.
    const unrelatedKnock = { ...knock };
    const fracture = { type: 'destruction', time: 2, bodyHandle: 201, mass: 12,
      cause: 'impact', position: point, debrisHandles: [] } as const;
    const hayFracture = { ...fracture, bodyHandle: 202, debrisHandles: [] as number[] };
    const metalFracture = { ...fracture, bodyHandle: 203, debrisHandles: [] as number[] };
    const soda = { ...fracture, bodyHandle: 204, cause: 'soda' as const, debrisHandles: [] as number[] };
    try {
      f.physics.push(knock);
      f.physics.push(unrelatedKnock);
      f.breakables.push(hayFracture);
      f.breakables.push(metalFracture);
      f.breakables.push(soda);
      f.emitMaterial({ type: 'headbutt', event: knock, goatId: 'player', material: 'wood',
        position: point, intensity: .5 });
      f.emitMaterial({ type: 'headbutt', goatId: 'player', material: 'stone', position: point, intensity: .4 });
      f.emitMaterial({ type: 'break', event: hayFracture, material: 'hay', position: point });
      f.emitMaterial({ type: 'break', event: metalFracture, material: 'metal', position: point });
      f.emitMaterial({ type: 'gnome-break', position: point });
      bridge.frame(1 / 60, { position: V(), forward: V(0, 0, -1) }, false);
      const frame = f.audio.updateFrame.mock.calls[0]![0];
      expect(frame.physics?.find(event => event === knock)).toBeUndefined();
      expect(frame.physics?.find(event => event === unrelatedKnock)).toBe(unrelatedKnock);
      expect(frame.chaos?.find(event => event === hayFracture || event === metalFracture)).toBeUndefined();
      expect(frame.chaos).toContain(soda);
      expect(frame.cues?.map(cue => cue.recordedEffect)).toEqual([
        'headbutt-stone', 'break-stone', 'headbutt-wood', 'break-hay', 'break-metal',
      ]);
      expect(frame.cues?.find(cue => cue.recordedEffect === 'break-stone')?.result).toBe('gig');
      expect(frame.cues?.every(cue => cue.position === point)).toBe(true);
      bridge.frame(1 / 60, { position: V(), forward: V(0, 0, -1) }, false);
      expect(f.audio.updateFrame.mock.calls[1]![0].cues).toEqual([]);
    } finally { bridge.dispose(); }
  });

  it.each([
    { material: 'wood', kind: 'crate', id: /^hoofington-verge-north-crate$/ },
    { material: 'metal', kind: 'barrel', id: /^downtown-bleatsville-barrel-\d+$/ },
  ])('keeps $material impact and fracture recordings when a charged headbutt shatters a $kind', async ({
    material, kind, id,
  }) => {
    const game = await Game.create({ seed: 'first-playable-test', resolution: 97 });
    const { audio } = fixture();
    const bridge = new GameAudio(game, audio);
    try {
      const target = game.island.props.find(prop => prop.kind === kind && id.test(prop.id) &&
        prop.breakable && !prop.id.endsWith('0'))!;
      const body = game.colliders.bodies.get(target.id)!;
      const handle = body.handle;
      body.setTranslation(V(0, 1000, 0), true);
      body.setLinvel(V(), true);
      // Stage Big through the normal style system so the stock break threshold
      // is hit without replacing the authored prop or changing its physics.
      for (const type of ['flip', 'knockback', 'destruction', 'big-splash'] as const) {
        game.rules.style.ingest({ type, quality: 2 });
      }
      for (let tick = 0; tick < 125; tick++) game.step();
      expect(game.rules.style.tier).toBe('Big');
      for (let tick = 0; tick < 90; tick++) game.step({ chargeHeadbutt: true });
      const head = game.goat.head.translation(), direction = forward(game.goat.locomotion.heading);
      body.setTranslation(V(head.x + direction.x * 1.8, head.y - .06, head.z + direction.z * 1.8), true);
      body.setLinvel(V(), true);
      body.setAngvel(V(), true);
      // Put the body into the query acceleration structure before releasing.
      game.step({ chargeHeadbutt: true });
      game.step({ chargeHeadbutt: false });
      expect(game.destroyedProps.has(target.id)).toBe(true);
      expect(game.physics.bodyData(handle)).toBeUndefined();
      bridge.frame(1 / 60, { position: head, forward: direction }, false);
      const frame = audio.updateFrame.mock.calls[0]![0];
      expect(frame.cues?.filter(cue => cue.bodyHandle === handle).map(cue => cue.recordedEffect))
        .toEqual(['headbutt-' + material, 'break-' + material]);
      expect(frame.physics?.some(event => event.type === 'knockedBody' && event.bodyHandle === handle)).toBe(false);
    } finally {
      bridge.dispose();
      game.dispose();
    }
  });

  it('applies independent audio buses and validates legacy saved volume preferences', () => {
    const f = fixture();
    const bridge = new GameAudio(f.game, f.audio);
    try {
      const settings = { ...DEFAULT_SETTINGS,
        volume: .25, musicVolume: .4, effectsVolume: .75 };
      bridge.setVolumes(settings);
      expect(f.audio.setSettings).toHaveBeenCalledWith({
        master: .25, music: .4, sfx: .75, ui: .75 * .7 / .88, ambience: .75 * .43 / .88,
      });
      bridge.setVolumes({ ...settings, effectsVolume: 0 });
      expect(f.audio.setSettings).toHaveBeenLastCalledWith({
        master: .25, music: .4, sfx: 0, ui: 0, ambience: 0,
      });
      expect(validateSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
      expect(validateSettings({ volume: .55 })).toEqual({
        ...DEFAULT_SETTINGS, volume: .55,
      });
      expect(validateSettings({ volume: 2, musicVolume: -1, effectsVolume: .6 }))
        .toMatchObject({ volume: 1, musicVolume: 0, effectsVolume: .6 });
    } finally { bridge.dispose(); }
  });


  it('keeps a visible result and its later button cues on the running context', () => {
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
      bridge.playMenuCue('ui-confirm');
      expect(f.audio.play).toHaveBeenCalledWith('ui-confirm');
      expect(f.audio.setMenuAudio).toHaveBeenLastCalledWith(true);
      expect(context.suspend).not.toHaveBeenCalled();
      expect(f.audio.endResultAudio).not.toHaveBeenCalled();

      bridge.setMenuOpen(false);
      expect(f.audio.setMenuAudio).toHaveBeenLastCalledWith(false);
      expect(f.audio.endResultAudio).toHaveBeenCalledOnce();
      expect(context.resume).not.toHaveBeenCalled();
      expect(f.audio.beginResultAudio).toHaveBeenCalledOnce();
    } finally { bridge.dispose(); }
  });

  it.each([true, false])('cancels a live result tail when leaving for menu=%s', menuOpen => {
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
      bridge.setMenuOpen(menuOpen);
      expect(f.audio.setMenuAudio).toHaveBeenLastCalledWith(menuOpen);
      expect(f.audio.endResultAudio).toHaveBeenCalledOnce();
      expect(context.suspend).not.toHaveBeenCalled();
      expect(context.resume).not.toHaveBeenCalled();
    } finally { bridge.dispose(); }
  });

  it('honors autoplay, plays the first pending UI action once, and clears it when hidden', async () => {
    const f = fixture();
    const context = {
      state: 'suspended',
      suspend: vi.fn(async () => { context.state = 'suspended'; }),
      resume: vi.fn(async () => { context.state = 'running'; }),
    };
    const bridge = new GameAudio(f.game, {
      ...f.audio, audioContext: context as unknown as AudioContext,
    });
    const camera = { position: { x: 0, y: 2, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
    try {
      bridge.setMenuOpen(true);
      bridge.playMenuCue('ui-click');
      bridge.frame(1 / 60, camera, false);
      expect(context.resume).not.toHaveBeenCalled();
      expect(f.audio.play).not.toHaveBeenCalled();

      context.state = 'running'; // Browser finished the first real user activation.
      bridge.frame(1 / 60, camera, false);
      bridge.frame(1 / 60, camera, false);
      expect(f.audio.play.mock.calls).toEqual([['ui-click']]);
      expect(f.audio.updateFrame.mock.calls.every(([frame]) => frame.cues?.length === 0)).toBe(true);

      bridge.playResultAudio('party');
      bridge.setHidden(true);
      await Promise.resolve();
      expect(context.suspend).toHaveBeenCalledOnce();
      expect(f.audio.endResultAudio).toHaveBeenCalledTimes(2);
      expect(f.audio.clearVoices).toHaveBeenCalledOnce();
      bridge.playMenuCue('ui-back');
      bridge.setHidden(false);
      await Promise.resolve();
      bridge.frame(1 / 60, camera, false);
      expect(context.resume).toHaveBeenCalledOnce();
      expect(f.audio.beginResultAudio).toHaveBeenCalledOnce();
      expect(f.audio.play.mock.calls).toEqual([['ui-click']]);
    } finally { bridge.dispose(); }
  });
});
