import {
  AudioRandom, CULL_DISTANCE, DEFAULT_MUSIC_STATE, distance, distanceGain,
  decideVoice, isBigMoment, settingsFrom, soundPriority, stepLength, clamp,
} from './logic';
import type {
  AudioBus, AudioSettings, MusicState, SoundId, Surface, Vec3, VoiceTicket, GoatVoice,
} from './logic';
import { ProceduralSynth } from './synth';
import type { SfxOptions } from './synth';
import { AdaptiveMusic, IslandAmbience } from './music';
import { mapLaneEvent } from './events';
import type {
  AudioCue, ChaosEvent, GameplayAudioEvent, LaneAudioEvent, ResultAudioKind,
} from './events';
import type { PhysicsEvent } from '../physics';
import type { MatchEvent } from '../modes';
import type { GigEvent } from '../gigs';

export interface AudioSettingsStore {
  load(): unknown;
  save(settings: AudioSettings): void;
}
/** Explicitly opt in to persistence. Safe for SSR / disabled or full storage. */
export function localAudioSettings(key = 'gigga-goat.audio.v1'): AudioSettingsStore {
  return {
    load: () => {
      try { return JSON.parse(localStorage.getItem(key) ?? 'null') as unknown; }
      catch { return null; }
    },
    save: settings => { try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* unavailable */ } },
  };
}
export interface AudioEngineOptions {
  seed?: string | number;
  /** Optional injection for headless tests or a preexisting host WebAudio context. */
  contextFactory?: () => AudioContext;
  settings?: unknown;
  storage?: AudioSettingsStore;
  maxVoices?: number;
}
export interface CameraAudioPose {
  position: Vec3;
  forward: Vec3;
  up?: Vec3;
}
export interface WalkingGoat {
  id: string; position: Vec3; size: number;
  grounded: boolean; speed: number; surface: Surface;
}
export interface AudioFrame {
  dt: number;
  camera?: CameraAudioPose;
  /** Input-only one-shots (charge start, UI or explicit jump) in the same frame call. */
  cues?: readonly AudioCue[];
  /** Partial updates preserve prior music state. Meters are normalized by the adapter. */
  state?: Partial<MusicState>;
  physics?: readonly PhysicsEvent[];
  gameplay?: readonly GameplayAudioEvent[];
  chaos?: readonly ChaosEvent[];
  modes?: readonly MatchEvent[];
  gigs?: readonly GigEvent[];
  goats?: readonly WalkingGoat[];
  goatPosition?: Vec3;
  positionForGoat?: (id: string) => Vec3 | undefined;
  positionForBody?: (handle: number) => Vec3 | undefined;
  sizeForGoat?: (id: string) => number | undefined;
}
export interface PlayOptions extends SfxOptions {
  position?: Vec3;
  bus?: AudioBus;
  priority?: number;
  result?: ResultAudioKind;
}
export interface AudioStatus {
  unlocked: boolean;
  voices: number;
  settings: AudioSettings;
  music: MusicState;
}
interface Voice {
  ticket: VoiceTicket;
  gain: GainNode;
  panner: PannerNode | null;
  sources: AudioScheduledSourceNode[];
  position: Vec3 | null;
  result?: ResultAudioKind;
  endsAt: number;
  baseGain: number;
  remaining: number;
  disposed: boolean;
}
export class VoiceManager {
  private readonly voices = new Map<number, Voice>();
  private nextId = 1;
  private listenerPosition: Vec3 = { x: 0, y: 0, z: 0 };
  constructor(private readonly context: AudioContext, private readonly synth: ProceduralSynth,
    private readonly buses: Readonly<Record<AudioBus, GainNode>>, readonly maxVoices = 32) {
    if (!Number.isInteger(maxVoices) || maxVoices < 1) throw new RangeError('maxVoices must be positive');
  }
  get activeCount(): number { return this.voices.size; }
  get tickets(): readonly VoiceTicket[] { return [...this.voices.values()].map(v => ({ ...v.ticket })); }
  setListenerPosition(p: Vec3): void {
    this.listenerPosition = p;
    const now = this.context.currentTime;
    for (const v of this.voices.values()) {
      if (!v.position) continue;
      const d = distance(p, v.position);
      if (d >= CULL_DISTANCE) { this.stop(v.ticket.id, .025); continue; }
      v.gain.gain.setTargetAtTime(v.baseGain * distanceGain(d), now, .06);
    }
  }
  play(sound: SoundId, opts: PlayOptions = {}): boolean {
    const ctx = this.context;
    if (ctx.state !== 'running') return false;
    const d = opts.position ? distance(opts.position, this.listenerPosition) : 0;
    const spatial = opts.position ? distanceGain(d) : 1;
    const level = clamp(opts.intensity ?? .7, 0, 1);
    const loudness = spatial * (level * .8 + .2);
    const priority = opts.priority ?? soundPriority(sound);
    const result = decideVoice(this.tickets, sound, priority, loudness, this.maxVoices);
    if (!result.allowed) return false;
    if (result.steal !== null) this.stop(result.steal, .018);
    const id = this.nextId++;
    const voiceGain = ctx.createGain();
    const baseGain = .38 * (.55 + level * .45);
    voiceGain.gain.value = Math.max(.0001, baseGain * spatial);
    const bus: AudioBus = opts.bus ?? (sound.startsWith('ui-') ? 'ui' :
      sound.startsWith('ambient-') ? 'ambience' : 'sfx');
    let panner: PannerNode | null = null;
    if (opts.position) {
      panner = ctx.createPanner();
      // Manual attenuation is shared with our culler and polyphony decisions.
      // Equal-power is far cheaper than HRTF for 32 moving sources on low-end phones.
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.refDistance = 1;
      panner.maxDistance = CULL_DISTANCE;
      panner.rolloffFactor = 0;
      panner.positionX.value = opts.position.x;
      panner.positionY.value = opts.position.y;
      panner.positionZ.value = opts.position.z;
      voiceGain.connect(panner); panner.connect(this.buses[bus]);
    } else {
      voiceGain.connect(this.buses[bus]);
    }
    let render;
    try {
      render = this.synth.play(sound, voiceGain, opts);
    } catch (error) {
      voiceGain.disconnect(); panner?.disconnect();
      throw error;
    }
    const voice: Voice = {
      ticket: { id, sound, priority, loudness, started: ctx.currentTime },
      gain: voiceGain, panner, sources: render.sources,
      remaining: render.sources.length, position: opts.position ?? null, baseGain,
      result: opts.result, endsAt: Math.max(ctx.currentTime, opts.when ?? 0) + render.duration,
      disposed: false,
    };
    this.voices.set(id, voice);
    if (voice.remaining === 0) { this.release(voice); return false; }
    for (const source of voice.sources) {
      const cleanup = source.onended;
      source.onended = ev => {
        cleanup?.call(source, ev);
        if (--voice.remaining <= 0) this.release(voice);
      };
    }
    return true;
  }
  stop(id: number, fadeSeconds = .02): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    this.voices.delete(id);
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(.00001, now, Math.max(.005, fadeSeconds / 3));
    for (const source of voice.sources) {
      try { source.stop(now + fadeSeconds); }
      catch { /* already ended */ }
    }
    // Let onended disconnect the nodes after the tiny click-free tail.
  }
  private release(v: Voice): void {
    if (v.disposed) return;
    v.disposed = true;
    this.voices.delete(v.ticket.id);
    v.gain.disconnect(); v.panner?.disconnect();
  }
  retainResultVoices(result: ResultAudioKind): number | null {
    let end = this.context.currentTime;
    for (const voice of this.voices.values()) {
      if (voice.result === result) end = Math.max(end, voice.endsAt);
      else this.stop(voice.ticket.id);
    }
    return end > this.context.currentTime ? end : null;
  }

  cancelResultVoices(): void {
    for (const voice of this.voices.values()) {
      if (voice.result) this.stopNow(voice);
    }
  }

  private stopNow(voice: Voice): void {
    // Disconnect now so a stopped or delayed cue cannot return after context resume.
    this.release(voice);
    for (const source of voice.sources) {
      try { source.stop(); } catch { /* stopped already */ }
    }
  }

  dispose(): void {
    for (const voice of this.voices.values()) this.stopNow(voice);
  }
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private voiceManager: VoiceManager | null = null;
  private musicPlayer: AdaptiveMusic | null = null;
  private ambiencePlayer: IslandAmbience | null = null;
  private synth: ProceduralSynth | null = null;
  private buses: Record<AudioBus, GainNode> | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private settingsValue: AudioSettings;
  private readonly storage?: AudioSettingsStore;
  private readonly seed: string | number;
  private readonly factory?: () => AudioContext;
  private readonly maxVoices: number;
  private readonly rng: AudioRandom;
  private readonly unbinders = new Set<() => void>();
  private unlocking: Promise<boolean> | null = null;
  private disposed = false;
  private resultTail = false;
  private currentState: MusicState = { ...DEFAULT_MUSIC_STATE };
  private camera: Vec3 = { x: 0, y: 0, z: 0 };
  private lastDuckAt = -Infinity;
  private readonly stepPhases = new Map<string, { distance: number; seenAt: number }>();
  private elapsed = 0;
  private readonly lastPlayed = new Map<SoundId, number>();

  constructor(options: AudioEngineOptions = {}) {
    this.seed = options.seed ?? 1;
    this.rng = new AudioRandom('events:' + String(this.seed));
    this.storage = options.storage;
    this.factory = options.contextFactory;
    this.maxVoices = options.maxVoices ?? 32;
    this.settingsValue = settingsFrom(options.settings ?? this.storage?.load());
  }

  get settings(): AudioSettings { return { ...this.settingsValue }; }
  get status(): AudioStatus {
    return {
      unlocked: this.context?.state === 'running' && !this.disposed,
      voices: this.voiceManager?.activeCount ?? 0,
      settings: this.settings,
      music: { ...this.currentState },
    };
  }
  get audioContext(): AudioContext | null { return this.context; }
  get voiceTickets(): readonly VoiceTicket[] { return this.voiceManager?.tickets ?? []; }

  setSettings(partial: Partial<AudioSettings>): AudioSettings {
    this.settingsValue = settingsFrom({ ...this.settingsValue, ...partial });
    this.applySettings();
    this.storage?.save(this.settings);
    return this.settings;
  }
  private applySettings(): void {
    if (!this.master || !this.buses || !this.context) return;
    const now = this.context.currentTime, s = this.settingsValue;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, now, .03);
    for (const name of ['music', 'sfx', 'ui', 'ambience'] as const) {
      const quiet = this.resultTail && (name === 'music' || name === 'ambience');
      this.buses[name].gain.setTargetAtTime(quiet ? 0 : s[name], now, .03);
    }
  }

  /** Let admitted result cues finish without continuing the live scene mix. */
  beginResultAudio(result: ResultAudioKind): number | null {
    this.resultTail = true;
    this.applySettings();
    return this.context?.state === 'running'
      ? this.voiceManager?.retainResultVoices(result) ?? null : null;
  }

  endResultAudio(): void {
    this.voiceManager?.cancelResultVoices();
    if (!this.resultTail) return;
    this.resultTail = false;
    this.applySettings();
  }

  /** Must be called in a genuine pointer/key/touch event to satisfy autoplay rules. */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.unlocking) return this.unlocking;
    this.unlocking = this.startAudio();
    try { return await this.unlocking; }
    finally { this.unlocking = null; }
  }
  private async startAudio(): Promise<boolean> {
    try {
      if (!this.context) {
        const Ctor = typeof AudioContext === 'undefined' ? null : AudioContext;
        if (!this.factory && !Ctor) return false;
        this.context = this.factory ? this.factory() : new Ctor!();
        this.makeGraph(this.context);
      }
      if (this.context.state !== 'running') await this.context.resume();
      return !this.disposed && this.context.state === 'running';
    } catch { return false; } // No rejection leaks out of the input event handler.
  }

  private makeGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 5;
    limiter.ratio.value = 18;
    limiter.attack.value = .002;
    limiter.release.value = .14;
    master.connect(limiter); limiter.connect(ctx.destination);
    const duck = ctx.createGain();
    duck.gain.value = 1;
    const gain = (): GainNode => ctx.createGain();
    const buses = {
      music: gain(), sfx: gain(), ui: gain(), ambience: gain(),
    };
    buses.music.connect(duck); duck.connect(master);
    buses.sfx.connect(master); buses.ui.connect(master); buses.ambience.connect(master);
    this.master = master; this.limiter = limiter; this.duck = duck;
    this.buses = buses;
    this.synth = new ProceduralSynth(ctx, new AudioRandom('timbre:' + String(this.seed)));
    this.voiceManager = new VoiceManager(ctx, this.synth, buses, this.maxVoices);
    this.musicPlayer = new AdaptiveMusic(ctx, this.synth, buses.music, this.seed);
    this.ambiencePlayer = new IslandAmbience(ctx, this.synth, buses.ambience, this.seed);
    this.applySettings();
  }

  /** Attach until the first successful gesture. Returns a complete unbinder. */
  unlockOnFirstInput(target?: EventTarget): () => void {
    if (this.disposed) return () => {};
    const resolved = target ?? (typeof document === 'undefined' ? null : document);
    if (!resolved) return () => {};
    let bound = true;
    const handler = (): void => {
      void this.unlock().then(ok => { if (ok) unbind(); });
    };
    const unbind = (): void => {
      if (!bound) return;
      bound = false;
      for (const type of ['pointerdown', 'keydown', 'touchstart']) {
        resolved.removeEventListener(type, handler);
      }
      this.unbinders.delete(unbind);
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      resolved.addEventListener(type, handler, { passive: true });
    }
    this.unbinders.add(unbind);
    return unbind;
  }

  /** Direct UI or scripted one-shot. World-space positional SFX use metres, Y up. */
  play(sound: SoundId, options: PlayOptions = {}): boolean {
    if (this.disposed || this.resultTail || !this.voiceManager) return false;
    const now = this.context?.currentTime ?? 0;
    const cooldown = sound === 'climb' || sound.startsWith('footstep-') ? .085 :
      sound === 'domino' ? .028 : sound === 'ui-click' ? .035 : 0;
    if (cooldown && now - (this.lastPlayed.get(sound) ?? -Infinity) < cooldown) return false;
    const result = this.voiceManager.play(sound, options);
    if (result) {
      this.lastPlayed.set(sound, now);
      if (isBigMoment(sound, options.intensity)) {
        this.lastDuckAt = now - .05; // start on the plateau; ramp by setTarget is click-free.
        this.duck?.gain.setTargetAtTime(.34, now, .022);
      }
    }
    return result;
  }

  /** One invocation per rendering frame, with each lane's drained events since last frame. */
  updateFrame(frame: AudioFrame): void {
    if (this.disposed) return;
    if (!Number.isFinite(frame.dt) || frame.dt < 0) throw new RangeError('Audio frame dt must be nonnegative');
    this.elapsed += Math.min(frame.dt, .25);
    if (frame.state) this.currentState = { ...this.currentState, ...frame.state };
    if (frame.camera) this.updateListener(frame.camera);
    if (this.resultTail || !this.context || this.context.state !== 'running') return;
    const audioNow = this.context.currentTime;
    const resolve = (input: AudioCue): PlayOptions => {
      // Physics/mode events carry goat IDs. Keyed gameplay events don't, so the
      // first observed goat is the local player (documented host convention).
      const owner = input.goatId ?? input.playerId;
      const observed = owner ? frame.goats?.find(goat => goat.id === owner) : frame.goats?.[0];
      const location = input.position ??
        (input.bodyHandle !== undefined ? frame.positionForBody?.(input.bodyHandle) : undefined) ??
        (owner ? frame.positionForGoat?.(owner) : undefined) ??
        observed?.position ?? frame.goatPosition;
      return {
        position: location, intensity: input.intensity, pitch: input.pitch,
        combo: input.combo, result: input.result,
        when: input.delay === undefined ? undefined : audioNow + Math.max(0, input.delay),
        size: input.size ??
          (owner ? frame.sizeForGoat?.(owner) : undefined) ?? observed?.size,
      };
    };
    const playLane = (lane: LaneAudioEvent): void => {
      for (const sound of mapLaneEvent(lane)) this.play(sound.sound, resolve(sound));
    };
    for (const event of frame.physics ?? []) playLane({ lane: 'physics', event });
    for (const event of frame.gameplay ?? []) playLane({ lane: 'gameplay', event });
    for (const event of frame.chaos ?? []) playLane({ lane: 'chaos', event });
    for (const event of frame.modes ?? []) playLane({ lane: 'modes', event });
    for (const event of frame.gigs ?? []) playLane({ lane: 'gigs', event });
    for (const sound of frame.cues ?? []) this.play(sound.sound, resolve(sound));
    for (const goat of frame.goats ?? []) this.updateFootsteps(goat, frame.dt);
    if (this.elapsed % 6 < .26) {
      for (const [id, foot] of this.stepPhases) {
        if (this.elapsed - foot.seenAt > 6) this.stepPhases.delete(id);
      }
    }
    const now = this.context.currentTime;
    this.duck?.gain.setTargetAtTime(
      (awaitDuckGain(now - this.lastDuckAt)), now, .04);
    this.musicPlayer?.update(this.currentState);
    this.ambiencePlayer?.update(this.currentState.poi, this.currentState.night);
  }

  private updateFootsteps(goat: WalkingGoat, dt: number): void {
    let state = this.stepPhases.get(goat.id);
    if (!state) {
      state = { distance: 0, seenAt: this.elapsed };
      this.stepPhases.set(goat.id, state);
    }
    state.seenAt = this.elapsed;
    if (!goat.grounded || goat.speed < .65) { state.distance = 0; return; }
    const step = stepLength(goat.size);
    state.distance += Math.max(0, goat.speed) * Math.min(dt, .12);
    let count = 0;
    while (state.distance >= step && count++ < 2) {
      state.distance -= step;
      this.play(('footstep-' + goat.surface) as SoundId, {
        position: goat.position, size: goat.size,
        intensity: clamp(.23 + goat.speed / 13, .24, .92),
        pitch: this.rng.range(.94, 1.07),
      });
    }
    if (count > 2) state.distance %= step;
  }

  private updateListener(camera: CameraAudioPose): void {
    this.camera = camera.position;
    const ctx = this.context;
    if (!ctx) return;
    const l = ctx.listener, now = ctx.currentTime;
    const forward = normal(camera.forward, { x: 0, y: 0, z: -1 });
    const up = normal(camera.up ?? { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    l.positionX.setValueAtTime(camera.position.x, now);
    l.positionY.setValueAtTime(camera.position.y, now);
    l.positionZ.setValueAtTime(camera.position.z, now);
    l.forwardX.setValueAtTime(forward.x, now);
    l.forwardY.setValueAtTime(forward.y, now);
    l.forwardZ.setValueAtTime(forward.z, now);
    l.upX.setValueAtTime(up.x, now);
    l.upY.setValueAtTime(up.y, now);
    l.upZ.setValueAtTime(up.z, now);
    this.voiceManager?.setListenerPosition(camera.position);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unbind of [...this.unbinders]) unbind();
    this.voiceManager?.dispose();
    this.musicPlayer?.dispose();
    this.ambiencePlayer?.dispose();
    this.master?.disconnect(); this.limiter?.disconnect(); this.duck?.disconnect();
    for (const bus of Object.values(this.buses ?? {})) bus.disconnect();
    this.stepPhases.clear(); this.lastPlayed.clear();
    if (this.context) void this.context.close().catch(() => {});
  }
}
function normal(vector: Vec3, fallback: Vec3): Vec3 {
  const len = Math.hypot(vector.x, vector.y, vector.z);
  return len > .0001 ?
    { x: vector.x / len, y: vector.y / len, z: vector.z / len } : fallback;
}
import { duckGainSince as awaitDuckGain } from './logic';
