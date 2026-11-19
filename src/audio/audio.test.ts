import { describe, expect, it } from 'vitest';
import {
  AudioEngine, AudioRandom, CULL_DISTANCE, DEFAULT_AUDIO_SETTINGS,
  DEFAULT_MUSIC_STATE, SOUND_IDS, GAMEPLAY_EVENT_TYPES, PHYSICS_EVENT_TYPES,
  CHAOS_EVENT_TYPES, MODE_EVENT_TYPES, GIG_EVENT_TYPES,
  ProceduralSynth, decideVoice, distanceGain, duckGainSince, goatPitch,
  locationFlavor, mapChaos, mapGameplay, mapGig, mapMode, mapPhysics,
  scorePattern, selectMusic, settingsFrom, soundLimit,
} from './index';
import type { GameplayAudioEvent, ChaosEvent } from './index';
import type { PhysicsEvent } from '../physics';
import type { MatchEvent } from '../modes';
import type { GigEvent } from '../gigs';

describe('deterministic audio logic', () => {
  it('repeats seeded variation exactly, including string seeds, and changes with new seeds', () => {
    const a = new AudioRandom('same-seed'), b = new AudioRandom('same-seed');
    const c = new AudioRandom('different-seed');
    const first = Array.from({ length: 60 }, () => a.next());
    expect(first).toEqual(Array.from({ length: 60 }, () => b.next()));
    expect(first).not.toEqual(Array.from({ length: 60 }, () => c.next()));
    expect(first.every(v => v >= 0 && v < 1)).toBe(true);
    expect(new AudioRandom(0).next()).toBeGreaterThanOrEqual(0);
    expect(() => a.pick([])).toThrow(RangeError);
    expect(new AudioRandom('same').pick(['a'])).toBe('a');
  });

  it('varies complete four-bar phrases but not from frame to frame', () => {
    expect(scorePattern(123, 0)).toEqual(scorePattern(123, 3));
    expect(scorePattern(123, 4)).not.toEqual(scorePattern(123, 0));
    expect(scorePattern(123, 8)).toEqual(scorePattern(123, 10));
    expect(scorePattern(555, 0)).not.toEqual(scorePattern(123, 0));
    expect(scorePattern(123, 0)).toHaveLength(16);
  });

  it('selects real added music layers as combo and GIGGA meter grow', () => {
    const base = selectMusic({ ...DEFAULT_MUSIC_STATE });
    expect([base.rhythm, base.drums, base.bass, base.lead]).toEqual([false, false, false, false]);
    const early = selectMusic({ ...DEFAULT_MUSIC_STATE, combo: 2 });
    expect([early.rhythm, early.drums, early.bass, early.lead]).toEqual([true, true, false, false]);
    const middle = selectMusic({ ...DEFAULT_MUSIC_STATE, combo: 3 });
    expect(middle.bass).toBe(true);
    expect(middle.lead).toBe(false);
    const big = selectMusic({ ...DEFAULT_MUSIC_STATE, combo: 5, meter: 70 });
    expect(big.lead).toBe(true);
    expect(big.intensity).toBeGreaterThan(base.intensity);
    expect(selectMusic({ ...DEFAULT_MUSIC_STATE, meter: 66 }).lead).toBe(true);
  });

  it('raises party tide tempo and tension, and darkens night harmonies', () => {
    const free = selectMusic({ ...DEFAULT_MUSIC_STATE });
    const party = selectMusic({ ...DEFAULT_MUSIC_STATE, mode: 'party', tide: 0 });
    const flooded = selectMusic({ ...DEFAULT_MUSIC_STATE, mode: 'party', tide: 1 });
    expect([free.bpm, party.bpm, flooded.bpm]).toEqual([112, 124, 166]);
    expect(flooded.tension).toBeGreaterThan(party.tension);
    expect(party.drums && party.bass).toBe(true);
    const night = selectMusic({ ...DEFAULT_MUSIC_STATE, night: true });
    expect(night.bpm).toBe(106);
    expect(night.brightness).toBeLessThan(free.brightness);
    expect(locationFlavor('hoofington')).toBe('farm');
    expect(locationFlavor('baa-ardwalk')).toBe('coast');
    expect(locationFlavor('downtown-bleatsville')).toBe('town');
    expect(locationFlavor('whispering-pines')).toBe('forest');
    expect(locationFlavor('mt-gigga')).toBe('mountain');
    expect(locationFlavor('the-dam')).toBe('dam');
  });

  it('softly attenuates 3D audio across the whole 600m island and raises kid bleats', () => {
    expect(distanceGain(0)).toBeCloseTo(1, 6);
    expect(distanceGain(40)).toBeGreaterThan(distanceGain(120));
    expect(distanceGain(120)).toBeGreaterThan(distanceGain(210));
    expect(distanceGain(CULL_DISTANCE)).toBe(0);
    expect(distanceGain(900)).toBe(0);
    expect(goatPitch(.6)).toBeGreaterThan(goatPitch(1));
    expect(goatPitch(3)).toBeLessThan(goatPitch(1));
    expect(goatPitch(1)).toBeCloseTo(1);
  });

  it('has finite smoothed attack, hold and release for ducking', () => {
    expect(duckGainSince(-1)).toBe(1);
    expect(duckGainSince(0)).toBe(1);
    expect(duckGainSince(.025)).toBeGreaterThan(.34);
    expect(duckGainSince(.025)).toBeLessThan(1);
    expect(duckGainSince(.06)).toBeCloseTo(.34);
    expect(duckGainSince(.19)).toBeCloseTo(.34);
    expect(duckGainSince(.6)).toBeGreaterThan(.34);
    expect(duckGainSince(.6)).toBeLessThan(1);
    expect(duckGainSince(1.1)).toBeCloseTo(1);
    let before = duckGainSince(.20);
    for (let i = 21; i <= 110; i++) {
      const after = duckGainSince(i / 100);
      expect(after).toBeGreaterThanOrEqual(before - 1e-10);
      before = after;
    }
  });

  it('sanitizes settings, treats bad inputs safely, and preserves defaults', () => {
    expect(settingsFrom(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(settingsFrom({ master: 1.8, music: -.9, sfx: NaN,
      ambience: Infinity, ui: .4, muted: 'true' })).toEqual({
      master: 1, music: 0, sfx: DEFAULT_AUDIO_SETTINGS.sfx,
      ui: .4, ambience: DEFAULT_AUDIO_SETTINGS.ambience, muted: false,
    });
    expect(settingsFrom({ muted: true, sfx: 0 }).muted).toBe(true);
  });

  it('respects same-sound polyphony and never steals an important voice for a quiet one', () => {
    const voices = [
      { id: 1, sound: 'bleat', priority: 45, loudness: 1, started: 0 },
      { id: 2, sound: 'bleat', priority: 45, loudness: .5, started: 1 },
      { id: 3, sound: 'bleat', priority: 45, loudness: .6, started: 2 },
    ] as const;
    expect(soundLimit('bleat')).toBe(3);
    expect(decideVoice(voices, 'bleat', 45, .9)).toEqual({ allowed: true, steal: 2 });
    expect(decideVoice(voices, 'bleat', 10, .9)).toEqual({ allowed: false, reason: 'priority' });
    expect(decideVoice(voices, 'bleat', 100, .9)).toEqual({ allowed: true, steal: 2 });
    expect(decideVoice(voices, 'bleat', 100, 0)).toEqual({ allowed: false, reason: 'culled' });
    const full = [{ id: 10, sound: 'victory', priority: 100, loudness: .9, started: 0 }] as const;
    expect(decideVoice(full, 'footstep-grass', 12, .7, 1)).toEqual({
      allowed: false, reason: 'priority',
    });
    expect(decideVoice(full, 'tide-warning', 100, 1, 1)).toEqual({
      allowed: true, steal: 10,
    });
  });
});

const position = { x: 1, y: 2, z: 3 };
const piece = { id: 1, type: 'ramp', rotation: 0, hp: 50, cell: { x: 0, y: 0, z: 0 } } as const;
const physicsFixtures: readonly PhysicsEvent[] = [
  { type: 'landed', goatId: 'goat', time: 1, airtime: .7, verticalSpeed: -8 },
  { type: 'impact', goatId: 'goat', time: 1, impulse: 22, otherBodyHandle: 9 },
  { type: 'flipped', goatId: 'goat', time: 1, rotations: 1 },
  { type: 'jumped', goatId: 'goat', time: 1 },
  { type: 'airtimeStart', goatId: 'goat', time: 1, height: 2 },
  { type: 'airtimeEnd', goatId: 'goat', time: 1, duration: 2 },
  { type: 'wallClingStart', goatId: 'goat', time: 1, normal: position },
  { type: 'wallClingEnd', goatId: 'goat', time: 1 },
  { type: 'ragdollStart', goatId: 'goat', time: 1, reason: 'flop' },
  { type: 'ragdollEnd', goatId: 'goat', time: 1 },
  { type: 'tongueAttach', goatId: 'goat', time: 1, bodyHandle: 3, length: 5 },
  { type: 'tongueDetach', goatId: 'goat', time: 1, reason: 'broken' },
  { type: 'knockedBody', goatId: 'goat', time: 1, bodyHandle: 1, mass: 10, speed: 6, impulse: 40 },
];
const gameplayFixtures: readonly GameplayAudioEvent[] = [
  { type: 'style:input', data: { type: 'flip', quality: 1 } },
  { type: 'style:scored', data: { trick: 'flip', points: 20, comboPoints: 50,
    comboCount: 3, distinct: 2, multiplier: 1.3, title: 'Flipper', meter: 30 } },
  { type: 'combo:ended', data: { points: 50, tricks: 3, title: 'Flipper' } },
  { type: 'size:changed', data: { from: 'Kid', to: 'GIGGA', targetScale: 3 } },
  { type: 'ability:used', data: { name: 'headbutt', power: .8 } },
  { type: 'balance:knockdown', data: { reason: 'impact' } },
  { type: 'balance:recovered', data: { balance: 80 } },
  { type: 'traversal', data: { kind: 'climb', metres: 1.2 } },
  { type: 'inventory:changed', data: { material: 'hay', before: 3, after: 8 } },
  { type: 'material:harvested', data: { material: 'wood', amount: 2 } },
  { type: 'build:placed', data: { piece } },
  { type: 'build:edited', data: { before: piece, after: piece } },
  { type: 'build:removed', data: { piece } },
  { type: 'build:hit', data: { piece, damage: 20 } },
  { type: 'build:broken', data: { piece } },
  { type: 'build:collapsed', data: { cause: 'break', pieces: [piece] } },
  { type: 'coins:changed', data: { before: 0, after: 10, reason: 'gig' } },
  { type: 'unlock:claimed', data: { id: 'neon-hooves', category: 'gear' } },
  { type: 'challenge:completed', data: { id: 'five-trick-combo', reward: 20 } },
  { type: 'challenge:progress', data: { id: 'five-trick-combo', value: 1, goal: 5 } },
  { type: 'build:requested', data: { type: 'floor' } },
];
const chaosFixtures: readonly ChaosEvent[] = [
  { type: 'enter', time: 1, bodyHandle: 1, mass: 20, impactSpeed: 2, volumeId: 'sea' },
  { type: 'exit', time: 1, bodyHandle: 1, mass: 20, impactSpeed: 0, volumeId: 'sea' },
  { type: 'splash', time: 1, bodyHandle: 1, mass: 20, impactSpeed: 9,
    volumeId: 'sea', displacedVolume: .9 },
  { type: 'destruction', time: 1, bodyHandle: 3, mass: 40, cause: 'impact',
    position, debrisHandles: [9] },
  { type: 'knock', time: 1, bodyHandle: 3, neighbourHandles: [9] },
  { type: 'topple', time: 1, bodyHandle: 3, tiltRadians: .8 },
  { type: 'sodaPop', time: 1, bodyHandle: 3, mass: 40, affectedHandles: [9] },
  { type: 'bounce', time: 1, surfaceId: 't', bodyHandle: 3, speed: 9 },
  { type: 'launch', time: 1, surfaceId: 'p', bodyHandle: 3, speed: 18 },
  { type: 'conveyorEnter', time: 1, surfaceId: 'c', bodyHandle: 3 },
  { type: 'conveyorExit', time: 1, surfaceId: 'c', bodyHandle: 3 },
];
const modeBase = { tick: 1, sequence: 1 } as const;
const modeFixtures: readonly MatchEvent[] = [
  { ...modeBase, type: 'player.joined', playerId: 'g', teamId: 't' },
  { ...modeBase, type: 'player.ready', playerId: 'g', ready: true },
  { ...modeBase, type: 'phase.changed', from: 'lobby', to: 'countdown' },
  { ...modeBase, type: 'countdown', seconds: 2 },
  { ...modeBase, type: 'tide.warning', level: 1, dryArea: 500, ticksUntilRise: 30 },
  { ...modeBase, type: 'tide.rose', level: 2, dryArea: 400 },
  { ...modeBase, type: 'goat.eliminated', playerId: 'g', creditedTo: null },
  { ...modeBase, type: 'goat.knockout', attackerId: 'a', victimId: 'g' },
  { ...modeBase, type: 'peak.contested', players: ['g', 'a'] },
  { ...modeBase, type: 'peak.control', playerId: 'g' },
  { ...modeBase, type: 'peak.scored', playerId: 'g', points: 3, comeback: false },
  { ...modeBase, type: 'hay.picked', baleId: 'b', playerId: 'g' },
  { ...modeBase, type: 'hay.dropped', baleId: 'b', playerId: 'g', reason: 'released' },
  { ...modeBase, type: 'hay.punted', baleId: 'b', playerId: 'g' },
  { ...modeBase, type: 'hay.scored', baleId: 'b', teamId: 't', playerId: 'g', score: 2 },
  { ...modeBase, type: 'match.finished', placements: [], teamPlacements: [] },
];
const gigBase = { tick: 1, seq: 1 } as const;
const gigFixtures: readonly GigEvent[] = [
  { ...gigBase, type: 'board.rotated', poiId: 'hoofington', cycle: 1 },
  { ...gigBase, type: 'gig.accepted', attemptId: 2, gigId: 'hay-haul' },
  { ...gigBase, type: 'objective.progress', attemptId: 2,
    objective: { kind: 'coverage', label: 'Mowed', eaten: 1, total: 12, bites: 3 } },
  { ...gigBase, type: 'gig.failed', attemptId: 2, reason: 'time' },
  { ...gigBase, type: 'gig.abandoned', attemptId: 2 },
  { ...gigBase, type: 'gig.completed', attemptId: 2, award: { attemptId: 2,
    gigId: 'hay-haul', difficulty: 'easy', rating: 'gold', coins: 150,
    baseCoins: 50, multiplier: 2, firstGoldBonus: 50 } },
  { ...gigBase, type: 'cosmetic.unlocked', cosmeticId: 'neon' },
];

describe('exhaustive typed lane mapping', () => {
  it('contains one concrete valid typed fixture for every current event in all five lanes', () => {
    expect(physicsFixtures.map(e => e.type).sort()).toEqual([...PHYSICS_EVENT_TYPES].sort());
    expect(gameplayFixtures.map(e => e.type).sort()).toEqual([...GAMEPLAY_EVENT_TYPES].sort());
    expect(chaosFixtures.map(e => e.type).sort()).toEqual([...CHAOS_EVENT_TYPES].sort());
    expect(modeFixtures.map(e => e.type).sort()).toEqual([...MODE_EVENT_TYPES].sort());
    expect(gigFixtures.map(e => e.type).sort()).toEqual([...GIG_EVENT_TYPES].sort());
  });
  it('maps every event to an explicit sound list (including intentionally silent states)', () => {
    const sets = [
      physicsFixtures.map(mapPhysics), gameplayFixtures.map(mapGameplay),
      chaosFixtures.map(mapChaos), modeFixtures.map(mapMode), gigFixtures.map(mapGig),
    ];
    for (const mapped of sets.flat()) {
      expect(Array.isArray(mapped)).toBe(true);
      for (const cue of mapped) expect(SOUND_IDS).toContain(cue.sound);
    }
    expect(mapPhysics(physicsFixtures[0]!)[0]?.sound).toBe('landing');
    expect(mapPhysics(physicsFixtures[3]!)[0]?.sound).toBe('jump');
    expect(mapPhysics(physicsFixtures[4]!)).toEqual([]);
    expect(mapChaos(chaosFixtures[2]!)[0]?.sound).toBe('splash');
    expect(mapMode(modeFixtures[4]!)[0]?.sound).toBe('tide-warning');
    expect(mapGig(gigFixtures[5]!).map(c => c.sound)).toEqual(['gig-success', 'rating-gold']);
    expect(mapGig(gigFixtures[5]!)[1]!.delay).toBeGreaterThan(.5);
    expect(mapGameplay(gameplayFixtures[3]!)[0]?.sound).toBe('gigga-grow');
  });
  it('reacts to discriminant payloads rather than blindly playing the same patch', () => {
    expect(mapGameplay({ type: 'size:changed', data: {
      from: 'GIGGA', to: 'Kid', targetScale: .6,
    } })[0]?.sound).toBe('gigga-shrink');
    expect(mapGameplay({ type: 'coins:changed', data: {
      before: 5, after: 3, reason: 'buy',
    } })[0]?.sound).toBe('ui-back');
    expect(mapPhysics({ type: 'tongueDetach', goatId: 'g', time: 0,
      reason: 'replaced' })).toEqual([]);
    expect(mapChaos({ type: 'destruction', time: 1, bodyHandle: 2,
      cause: 'soda', mass: 20, position, debrisHandles: [],
    })[0]?.sound).toBe('soda-pop');
  });
});

/** Web Audio mock uses actual node types only through a test-only cast. */
class MockParam {
  value = 1;
  setValueAtTime(v: number): void { this.value = v; }
  linearRampToValueAtTime(v: number): void { this.value = v; }
  exponentialRampToValueAtTime(v: number): void { this.value = v; }
  setTargetAtTime(v: number): void { this.value = v; }
  cancelScheduledValues(): void {}
}
class MockNode {
  connected: unknown[] = [];
  connect(dest: unknown): unknown { this.connected.push(dest); return dest; }
  disconnect(): void { this.connected = []; }
}
class MockGain extends MockNode { gain = new MockParam(); }
class MockFilter extends MockNode { type: BiquadFilterType = 'lowpass'; frequency = new MockParam(); Q = new MockParam(); }
class MockOsc extends MockNode {
  type: OscillatorType = 'sine';
  frequency = new MockParam();
  onended: ((ev: Event) => void) | null = null;
  started = false;
  stopped = false;
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
  finish(): void { this.onended?.(new Event('ended')); }
}
class MockSource extends MockOsc { buffer: unknown; loop = false; }
class MockCompressor extends MockNode {
  threshold = new MockParam(); knee = new MockParam(); ratio = new MockParam();
  attack = new MockParam(); release = new MockParam();
}
class MockPanner extends MockNode {
  panningModel: PanningModelType = 'equalpower'; distanceModel: DistanceModelType = 'linear';
  refDistance = 1; maxDistance = 1000; rolloffFactor = 1;
  positionX = new MockParam(); positionY = new MockParam(); positionZ = new MockParam();
}
class MockContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 22050;
  destination = new MockNode();
  listener = {
    positionX: new MockParam(), positionY: new MockParam(), positionZ: new MockParam(),
    forwardX: new MockParam(), forwardY: new MockParam(), forwardZ: new MockParam(),
    upX: new MockParam(), upY: new MockParam(), upZ: new MockParam(),
  };
  oscillators: MockOsc[] = [];
  sources: MockSource[] = [];
  compressors: MockCompressor[] = [];
  panners: MockPanner[] = [];
  createGain(): MockGain { return new MockGain(); }
  createOscillator(): MockOsc { const o = new MockOsc(); this.oscillators.push(o); return o; }
  createBufferSource(): MockSource { const s = new MockSource(); this.sources.push(s); return s; }
  createBiquadFilter(): MockFilter { return new MockFilter(); }
  createPanner(): MockPanner { const p = new MockPanner(); this.panners.push(p); return p; }
  createDynamicsCompressor(): MockCompressor {
    const c = new MockCompressor(); this.compressors.push(c); return c;
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  async resume(): Promise<void> { this.state = 'running'; }
  async close(): Promise<void> { this.state = 'closed'; }
  asAudioContext(): AudioContext { return this as unknown as AudioContext; }
}
describe('mocked WebAudio integration', () => {
  it('does not allocate a context before explicit unlock, creates the buses and limiter after', async () => {
    const ctx = new MockContext();
    const saved: unknown[] = [];
    const audio = new AudioEngine({ contextFactory: () => ctx.asAudioContext(),
      storage: { load: () => ({ music: .4, muted: false }), save: data => { saved.push(data); } } });
    expect(audio.audioContext).toBeNull();
    expect(audio.play('bleat')).toBe(false);
    expect(audio.status.unlocked).toBe(false);
    expect(await audio.unlock()).toBe(true);
    expect(audio.audioContext).toBe(ctx);
    expect(ctx.compressors).toHaveLength(1);
    expect(ctx.compressors[0]!.ratio.value).toBe(18);
    expect(audio.status.unlocked).toBe(true);
    expect(audio.settings.music).toBe(.4);
    audio.setSettings({ music: .1, master: .7, muted: true });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ music: .1, master: .7, muted: true });
    audio.dispose();
    expect(audio.status.unlocked).toBe(false);
    expect(await audio.unlock()).toBe(false);
  });

  it('synthesizes every catalog patch with finite duration and scheduled sources', () => {
    const ctx = new MockContext();
    ctx.state = 'running';
    const synth = new ProceduralSynth(ctx.asAudioContext(), new AudioRandom(7));
    for (const id of SOUND_IDS) {
      const render = synth.play(id, ctx.createGain() as unknown as AudioNode, {
        size: 3, intensity: .8, voice: 'raspy', combo: 7,
      });
      expect(render.duration).toBeGreaterThan(0);
      expect(render.sources.length, id).toBeGreaterThan(0);
      expect(render.sources.every(s => (s as unknown as MockOsc).started)).toBe(true);
    }
  });

  it('priority-steals weak SFX and culls distant emitters, then releases finished voices', async () => {
    const ctx = new MockContext();
    const audio = new AudioEngine({ contextFactory: () => ctx.asAudioContext(), maxVoices: 1 });
    await audio.unlock();
    audio.updateFrame({ dt: 1 / 60, camera: {
      position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 },
    } });
    expect(audio.play('footstep-grass', { position: { x: 6, y: 0, z: 0 } })).toBe(true);
    expect(audio.voiceTickets.map(t => t.sound)).toEqual(['footstep-grass']);
    expect(audio.play('victory')).toBe(true);
    expect(audio.voiceTickets.map(t => t.sound)).toEqual(['victory']);
    expect(audio.play('footstep-rock')).toBe(false);
    expect(audio.play('bleat', { position: { x: 400, y: 0, z: 0 } })).toBe(false);
    expect(ctx.panners[0]!.positionX.value).toBe(6);
    // End the victory sources. The stopped footstep source is no longer counted.
    for (const source of [...ctx.oscillators, ...ctx.sources]) source.finish();
    expect(audio.status.voices).toBe(0);
    audio.dispose();
  });

  it('preserves the local goat size for keyed ability bleats without a goat ID', async () => {
    async function firstBleatPitch(size: number): Promise<number> {
      const ctx = new MockContext();
      const audio = new AudioEngine({ seed: 91, contextFactory: () => ctx.asAudioContext() });
      await audio.unlock();
      audio.updateFrame({ dt: 1 / 60,
        camera: { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } },
        goats: [{ id: 'local', position: { x: 3, y: 0, z: 0 },
          size, grounded: false, speed: 0, surface: 'grass' }],
        gameplay: [{ type: 'ability:used', data: { name: 'bleat' } }],
      });
      expect(ctx.panners.some(p => p.positionX.value === 3)).toBe(true);
      const frequency = ctx.oscillators[0]!.frequency.value;
      audio.dispose();
      return frequency;
    }
    expect(await firstBleatPitch(.6)).toBeGreaterThan(await firstBleatPitch(3));
  });

  it('plays one flop cue, skips get-up contact noise, and keeps deliberate jumps and landings', async () => {
    const ctx = new MockContext();
    const audio = new AudioEngine({ contextFactory: () => ctx.asAudioContext() });
    await audio.unlock();
    try {
      const goatId = 'player';
      audio.updateFrame({
        dt: 1 / 60,
        physics: [{ type: 'ragdollStart', goatId, time: 1, reason: 'flop' }],
        gameplay: [
          { type: 'balance:knockdown', data: { reason: 'flop' } },
          { type: 'ability:used', data: { name: 'flop' } },
        ],
      });
      audio.updateFrame({
        dt: 1 / 60,
        physics: [
          { type: 'ragdollEnd', goatId, time: 2.33 },
          { type: 'landed', goatId, time: 2.48, airtime: .15, verticalSpeed: 1.49 },
          { type: 'landed', goatId, time: 2.53, airtime: .03, verticalSpeed: 1.59 },
        ],
        gameplay: [{ type: 'balance:recovered', data: { balance: 45 } }],
      });
      expect(audio.voiceTickets.map(t => t.sound)).toEqual(['ragdoll-flop']);

      audio.updateFrame({
        dt: 1 / 60,
        physics: [
          { type: 'jumped', goatId, time: 3 },
          { type: 'landed', goatId, time: 3.75, airtime: .75, verticalSpeed: 1.6 },
          { type: 'landed', goatId, time: 4, airtime: .1, verticalSpeed: 3.1 },
        ],
      });
      expect(audio.voiceTickets.map(t => t.sound)).toEqual(['ragdoll-flop', 'jump', 'landing', 'landing']);
    } finally {
      audio.dispose();
    }
  });

  it('follows camera orientation, schedules music and accepts typed frame events', async () => {
    const ctx = new MockContext();
    const audio = new AudioEngine({ seed: 3, contextFactory: () => ctx.asAudioContext() });
    await audio.unlock();
    audio.updateFrame({
      dt: 1 / 60,
      camera: { position: { x: 25, y: 4, z: 0 },
        forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
      state: { mode: 'party', tide: .9, combo: 7, meter: 90, poi: 'the-dam', night: true },
      physics: [physicsFixtures[0]!],
      gigs: [gigFixtures[5]!],
      cues: [{ sound: 'headbutt-charge', intensity: .8 }],
      goatPosition: { x: 25, y: 4, z: 4 },
    });
    expect(ctx.listener.positionX.value).toBe(25);
    expect(ctx.listener.forwardX.value).toBe(1);
    expect(audio.status.music.poi).toBe('the-dam');
    expect(audio.voiceTickets.some(t => t.sound === 'landing')).toBe(true);
    expect(audio.voiceTickets.some(t => t.sound === 'gig-success')).toBe(true);
    expect(audio.voiceTickets.some(t => t.sound === 'headbutt-charge')).toBe(true);
    expect(ctx.oscillators.length).toBeGreaterThan(0); // song and sounds are actually scheduled
    audio.dispose();
  });
});
