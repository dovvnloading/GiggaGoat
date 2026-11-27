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
import { ZoneAmbience, type EnvironmentMix, type Habitat } from './zone-ambience';
import { RecordedAudio } from './recordings';
import type { RecordedAssets, RecordedEffect } from './recordings';
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
  recordedAssets?: RecordedAssets;
}
export interface CameraAudioPose {
  position: Vec3;
  forward: Vec3;
  up?: Vec3;
}
export interface WalkingGoat {
  id: string; position: Vec3; size: number;
  grounded: boolean; speed: number; surface: Surface; gait?: 'walk' | 'gallop' | 'still' | 'climb';
}
export interface AudioFrame {
  dt: number;
  camera?: CameraAudioPose;
  habitat?: Habitat;
  environment?: EnvironmentMix;
  vehicle?: {kind: 'boat' | 'plane' | 'tram' | 'balloon'; speed: number; lift: number};
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
  audioKindForBody?: (handle: number) => 'goat' | 'wood' | undefined;
  sizeForGoat?: (id: string) => number | undefined;
}
export interface PlayOptions extends SfxOptions {
  position?: Vec3;
  bus?: AudioBus;
  priority?: number;
  result?: ResultAudioKind;
  recordedEffect?: RecordedEffect;
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
function audibleDistance(sound: SoundId, metres: number): number {
  // Close Foley falls away rapidly after the third-person camera's normal follow distance.
  const scale = sound.startsWith('footstep-') || sound === 'climb' || sound === 'domino' ||
    sound === 'ambient-resident' || sound === 'ambient-fountain' || sound === 'market-rustle' ? 7 :
    sound === 'splash' || sound === 'landing' || sound.startsWith('tongue-') ? 4 : 1;
  return metres + Math.max(0, metres - 8) * (scale - 1);
}

export class VoiceManager {
  private readonly voices = new Map<number, Voice>();
  private nextId = 1;
  private listenerPosition: Vec3 = { x: 0, y: 0, z: 0 };
  constructor(private readonly context: AudioContext, private readonly synth: ProceduralSynth,
    private readonly buses: Readonly<Record<AudioBus, GainNode>>, readonly maxVoices = 32,
    private readonly recordings?: RecordedAudio) {
    if (!Number.isInteger(maxVoices) || maxVoices < 1) throw new RangeError('maxVoices must be positive');
  }
  get activeCount(): number { return this.voices.size; }
  get tickets(): readonly VoiceTicket[] { return [...this.voices.values()].map(v => ({ ...v.ticket })); }
  setListenerPosition(p: Vec3): void {
    this.listenerPosition = p;
    const now = this.context.currentTime;
    for (const v of this.voices.values()) {
      if (!v.position) continue;
      const d = audibleDistance(v.ticket.sound, distance(p, v.position));
      if (d >= CULL_DISTANCE) { this.stop(v.ticket.id, .025); continue; }
      v.gain.gain.setTargetAtTime(v.baseGain * distanceGain(d), now, .06);
    }
  }
  play(sound: SoundId, opts: PlayOptions = {}): boolean {
    const ctx = this.context;
    if (ctx.state !== 'running') return false;
    const d = opts.position ? audibleDistance(sound, distance(opts.position, this.listenerPosition)) : 0;
    const spatial = opts.position ? distanceGain(d) : 1;
    const level = clamp(opts.intensity ?? .7, 0, 1);
    const loudness = spatial * (level * .8 + .2);
    if (spatial <= 0) return false;
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
      render = this.recordings?.render(sound, voiceGain, opts, opts.recordedEffect) ??
        this.synth.play(sound, voiceGain, opts);
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

  stopWorldVoices(): void {
    for (const voice of this.voices.values()) {
      if (!voice.ticket.sound.startsWith('ui-')) this.stopNow(voice);
    }
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
  private recordings: RecordedAudio | null = null;
  private ambiencePlayer: ZoneAmbience | IslandAmbience | null = null;
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
  private readonly recordedAssets?: RecordedAssets;
  private readonly rng: AudioRandom;
  private readonly unbinders = new Set<() => void>();
  private unlocking: Promise<boolean> | null = null;
  private disposed = false;
  private menuOnly = false;
  private resultTail = false;
  private currentState: MusicState = { ...DEFAULT_MUSIC_STATE };
  private camera: Vec3 = { x: 0, y: 0, z: 0 };
  private lastDuckAt = -Infinity;
  private readonly stepPhases = new Map<string, { distance: number; seenAt: number; soundedAt: number }>();
  private elapsed = 0;
  private readonly lastPlayed = new Map<SoundId, number>();

  constructor(options: AudioEngineOptions = {}) {
    this.seed = options.seed ?? 1;
    this.rng = new AudioRandom('events:' + String(this.seed));
    this.storage = options.storage;
    this.factory = options.contextFactory;
    this.maxVoices = options.maxVoices ?? 32;
    this.recordedAssets = options.recordedAssets;
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
      const quiet = ((this.menuOnly || this.resultTail) && (name === 'music' || name === 'ambience')) ||
        (this.menuOnly && !this.resultTail && name === 'sfx');
      this.buses[name].gain.setTargetAtTime(quiet ? 0 : s[name], now, .03);
    }
  }

  setMenuAudio(enabled: boolean): void {
    if (enabled === this.menuOnly) return;
    this.menuOnly = enabled;
    if(enabled)this.stopVehicle();
    if (enabled && !this.resultTail) this.voiceManager?.stopWorldVoices();
    this.applySettings();
  }

  stopCue(sound: SoundId): void {
    for (const voice of this.voiceManager?.tickets ?? []) {
      if (voice.sound === sound) this.voiceManager?.stop(voice.id);
    }
  }

  /** Disconnect active one-shots so backgrounding cannot replay them on return. */
  clearVoices(): void { this.voiceManager?.dispose(); }

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
    this.recordings = this.recordedAssets ? new RecordedAudio(ctx, this.recordedAssets, buses.music) : null;
    this.voiceManager = new VoiceManager(ctx, this.synth, buses, this.maxVoices, this.recordings ?? undefined);
    this.musicPlayer = new AdaptiveMusic(ctx, this.synth, this.recordings?.proceduralOutput ?? buses.music, this.seed);
    this.ambiencePlayer = this.recordedAssets?.ambience
      ? new ZoneAmbience(ctx, buses.ambience, this.recordedAssets.ambience)
      : new IslandAmbience(ctx, this.synth, buses.ambience, this.seed);
    this.applySettings();
  }

  /** Attach until the first successful gesture. Returns a complete unbinder. */
  unlockOnFirstInput(target?: EventTarget, onUnlocked?: () => void): () => void {
    if (this.disposed) return () => {};
    const resolved = target ?? (typeof document === 'undefined' ? null : document);
    if (!resolved) return () => {};
    let bound = true;
    const types = ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click'];
    const handler = (event: Event): void => {
      if (!event.isTrusted || (typeof document !== 'undefined' && document.hidden)) return;
      void this.unlock().then(ok => {
        if (ok && bound) {
          unbind();
          onUnlocked?.();
        }
      });
    };
    const unbind = (): void => {
      if (!bound) return;
      bound = false;
      for (const type of types) resolved.removeEventListener(type, handler, true);
      this.unbinders.delete(unbind);
    };
    for (const type of types) {
      resolved.addEventListener(type, handler, { capture: true, passive: true });
    }
    this.unbinders.add(unbind);
    return unbind;
  }

  /** Direct UI or scripted one-shot. World-space positional SFX use metres, Y up. */
  play(sound: SoundId, options: PlayOptions = {}): boolean {
    if (this.disposed || !this.voiceManager) return false;
    if ((this.menuOnly || this.resultTail) && !sound.startsWith('ui-')) return false;
    const now = this.context?.currentTime ?? 0;
    const cooldown = sound === 'domino' ? .028 : sound === 'ui-click' ? .035 : 0;
    if (cooldown && now - (this.lastPlayed.get(sound) ?? -Infinity) < cooldown) return false;
    const result = this.voiceManager.play(sound, options);
    if (result) {
      this.lastPlayed.set(sound, now);
      if (isBigMoment(sound, options.intensity) && (!options.position ||
        distance(options.position, this.camera) < 26)) {
        this.lastDuckAt = now - .05; // start on the plateau; ramp by setTarget is click-free.
        this.duck?.gain.setTargetAtTime(.34, now, .022);
      }
    }
    return result;
  }

  /** One invocation per rendering frame, with each lane's drained events since last frame. */
  private vehicleVoice?: {kind: string; source: OscillatorNode | AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode};

  private stopVehicle(): void {
    const voice=this.vehicleVoice;
    if(!voice || !this.context)return;
    this.vehicleVoice=undefined;
    const now=this.context.currentTime;
    voice.gain.gain.setTargetAtTime(0,now,.025);
    voice.source.onended=()=>{voice.source.disconnect();voice.gain.disconnect();voice.filter.disconnect();};
    voice.source.stop(now+.14);
  }

  private soundVehicle(vehicle: AudioFrame['vehicle']): void {
    if(!vehicle || this.menuOnly || this.resultTail){this.stopVehicle();return;}
    const ctx=this.context;
    if(!ctx || !this.buses)return;
    if(this.vehicleVoice?.kind!==vehicle.kind){
      this.stopVehicle();
      const filter=ctx.createBiquadFilter(),gain=ctx.createGain();
      filter.type='lowpass';gain.gain.value=0;
      let source: OscillatorNode | AudioBufferSourceNode;
      if(vehicle.kind==='balloon'){
        const noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),data=noise.getChannelData(0);
        let seed=421;
        for(let i=0;i<data.length;i++){seed=(Math.imul(1664525,seed)+1013904223)>>>0;data[i]=seed/2147483648-1;}
        const burner=ctx.createBufferSource();burner.buffer=noise;burner.loop=true;source=burner;
      }else{
        const engine=ctx.createOscillator();engine.type=vehicle.kind==='tram'?'triangle':'sawtooth';source=engine;
      }
      source.connect(filter);filter.connect(gain);gain.connect(this.buses.sfx);source.start();
      this.vehicleVoice={kind:vehicle.kind,source,gain,filter};
    }
    const voice=this.vehicleVoice,now=ctx.currentTime,speed=Math.abs(vehicle.speed);
    if('frequency' in voice.source)voice.source.frequency.setTargetAtTime(
      vehicle.kind==='tram'?93:vehicle.kind==='plane'?48+speed*2.8:34+speed*3.3,now,.12);
    voice.filter.frequency.setTargetAtTime(vehicle.kind==='balloon'?590:180+speed*9,now,.14);
    const level=vehicle.kind==='balloon'?Math.max(0,vehicle.lift)*.033:vehicle.kind==='tram'?(speed>0?.036:0):.039+speed*.0008;
    voice.gain.gain.setTargetAtTime(level,now,.10);
  }

  updateFrame(frame: AudioFrame): void {
    this.soundVehicle(frame.vehicle);
    if (this.disposed) return;
    if (!Number.isFinite(frame.dt) || frame.dt < 0) throw new RangeError('Audio frame dt must be nonnegative');
    this.elapsed += Math.min(frame.dt, .25);
    if (frame.state) this.currentState = { ...this.currentState, ...frame.state };
    if (frame.camera) this.updateListener(frame.camera);
    if (this.menuOnly || this.resultTail || !this.context || this.context.state !== 'running') return;
    const audioNow = this.context.currentTime;
    const resolve = (input: AudioCue): PlayOptions => {
      // Physics/mode events carry goat IDs. Keyed gameplay events don't, so the
      // first observed goat is the local player (documented host convention).
      const owner = input.goatId ?? input.playerId;
      const observed = owner ? frame.goats?.find(goat => goat.id === owner) : frame.goats?.[0];
      const screenCue = input.sound.startsWith('ui-') || !!input.result;
      const location = screenCue ? undefined : input.position ??
        (input.bodyHandle !== undefined ? frame.positionForBody?.(input.bodyHandle) : undefined) ??
        (owner ? frame.positionForGoat?.(owner) : undefined) ??
        observed?.position ?? frame.goatPosition;
      const material = input.bodyHandle === undefined ? undefined : frame.audioKindForBody?.(input.bodyHandle);
      const recordedEffect = input.recordedEffect ?? (
        input.sound === 'splash' && material === 'goat' ? 'water-flop-splash' :
        input.sound === 'gig-success' && input.result === 'gig' ? 'gig-reward' : undefined
      );
      return {
        position: location, intensity: input.intensity, pitch: input.pitch,
        combo: input.combo, result: input.result, recordedEffect, surface: observed?.surface,
        when: input.delay === undefined ? undefined : audioNow + Math.max(0, input.delay),
        size: input.size ??
          (owner ? frame.sizeForGoat?.(owner) : undefined) ?? observed?.size,
      };
    };
    const playLane = (lane: LaneAudioEvent): void => {
      for (const sound of mapLaneEvent(lane)) {
        if (sound.bodyHandle !== undefined && !sound.goatId && !sound.position &&
            frame.positionForBody && !frame.positionForBody(sound.bodyHandle)) continue;
        this.play(sound.sound, resolve(sound));
      }
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
    this.recordings?.updateMusic(this.currentState);
    this.ambiencePlayer?.update(this.currentState.poi, this.currentState.night, frame.habitat, frame.environment);
  }

  private updateFootsteps(goat: WalkingGoat, dt: number): void {
    let state = this.stepPhases.get(goat.id);
    if (!state) {
      state = { distance: 0, seenAt: this.elapsed, soundedAt: -Infinity };
      this.stepPhases.set(goat.id, state);
    }
    state.seenAt = this.elapsed;
    const climbing = goat.gait === 'climb';
    if ((!goat.grounded && !climbing) || goat.gait === 'still' || goat.speed < (climbing ? .18 : .65)) { state.distance = 0; return; }
    const stride = climbing ? 1.12 : goat.gait === 'gallop' ? 1.95 : 1.5;
    const step = goat.gait ? stride * goat.size / 2 : stepLength(goat.size);
    state.distance += Math.max(0, goat.speed) * Math.min(dt, .12);
    if (state.distance >= step) {
      state.distance %= step; // A stalled frame never replays a pile of missed hoof contacts.
      if (this.elapsed - state.soundedAt < .105) return;
      state.soundedAt = this.elapsed;
      this.play(climbing ? 'climb' : ('footstep-' + goat.surface) as SoundId, {
        position: goat.position, size: goat.size,
        intensity: clamp(.23 + goat.speed / 13, .24, .92),
        pitch: clamp(Math.pow(goat.size, -.22), .74, 1.15) * this.rng.range(.94, 1.07),
      });
    }
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
    this.stopVehicle();
    if (this.disposed) return;
    this.disposed = true;
    for (const unbind of [...this.unbinders]) unbind();
    this.voiceManager?.dispose();
    this.musicPlayer?.dispose();
    this.recordings?.dispose();
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
