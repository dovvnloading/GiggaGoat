import {
  AudioRandom, DEFAULT_MUSIC_STATE, LOCATIONS, scorePattern, selectMusic, clamp,
} from './logic';
import type { AudioLocation, MusicPlan, MusicState, SoundId } from './logic';
import { ProceduralSynth } from './synth';

type Flavor = 'farm' | 'coast' | 'town' | 'forest' | 'mountain' | 'dam';
type Layer = 'chords' | 'rhythm' | 'drums' | 'bass' | 'lead';
const FLAVORS: readonly Flavor[] = ['farm', 'coast', 'town', 'forest', 'mountain', 'dam'];
const LAYERS: readonly Layer[] = ['chords', 'rhythm', 'drums', 'bass', 'lead'];
const ROOTS: Readonly<Record<Flavor, number>> = {
  farm: 196, coast: 220, town: 174.61, forest: 220, mountain: 146.83, dam: 164.81,
};
export function locationFlavor(poi: AudioLocation): Flavor {
  switch (poi) {
    case 'hoofington': return 'farm';
    case 'baa-ardwalk': case 'old-lighthouse': return 'coast';
    case 'crane-yard': case 'downtown-bleatsville': return 'town';
    case 'whispering-pines': return 'forest';
    case 'mt-gigga': return 'mountain';
    case 'the-dam': return 'dam';
    default: { const exhaustive: never = poi; return exhaustive; }
  }
}
/** Uses the browser's audio clock, not render dt, so frame hitches cannot change song pitch. */
export class AdaptiveMusic {
  private readonly gains: Record<Layer, GainNode>;
  private readonly flavors: Record<Flavor, GainNode>;
  private state: MusicState = { ...DEFAULT_MUSIC_STATE };
  private plan: MusicPlan = selectMusic(this.state);
  private previousFlavor: Flavor | null = null;
  private transitionEnd = 0;
  private nextStepTime: number;
  private stepIndex = 0;
  private readonly seed: string | number;
  private readonly random: AudioRandom;
  private stopped = false;
  private lastPlanKey = '';

  constructor(private readonly context: AudioContext,
    private readonly synth: ProceduralSynth, private readonly output: AudioNode,
    seed: string | number = 12) {
    this.seed = seed;
    this.random = new AudioRandom('song-' + String(seed));
    const gain = (): GainNode => {
      const n = context.createGain();
      n.gain.value = 0;
      n.connect(output);
      return n;
    };
    this.gains = { chords: gain(), rhythm: gain(), drums: gain(), bass: gain(), lead: gain() };
    this.flavors = { farm: gain(), coast: gain(), town: gain(), forest: gain(),
      mountain: gain(), dam: gain() };
    this.nextStepTime = context.currentTime + .065;
    this.applyMix(true);
  }

  get currentPlan(): MusicPlan { return { ...this.plan }; }

  update(state: MusicState): void {
    if (this.stopped || this.context.state !== 'running') return;
    this.state = {
      ...state, combo: Math.max(0, state.combo), meter: clamp(state.meter, 0, 100),
      tide: clamp(state.tide),
      poi: LOCATIONS.includes(state.poi) ? state.poi : 'hoofington',
    };
    const next = selectMusic(this.state);
    const flavor = locationFlavor(next.poi), old = locationFlavor(this.plan.poi);
    if (flavor !== old) {
      this.previousFlavor = old;
      this.transitionEnd = this.context.currentTime + 2;
    }
    this.plan = next;
    this.applyMix();
    if (this.nextStepTime < this.context.currentTime - .25) {
      // On a tab waking from sleep, drop missed notes rather than a burst of 1000 events.
      this.nextStepTime = this.context.currentTime + .055;
    }
    const horizon = this.context.currentTime + .19;
    let budget = 0;
    while (this.nextStepTime < horizon && budget++ < 12) {
      const step = this.stepIndex++;
      this.scheduleStep(step, this.nextStepTime);
      this.nextStepTime += 60 / this.plan.bpm / 4;
    }
    if (this.previousFlavor && this.nextStepTime > this.transitionEnd) this.previousFlavor = null;
  }

  private applyMix(initial = false): void {
    const p = this.plan, now = this.context.currentTime;
    const flavor = locationFlavor(p.poi);
    const mix: Record<Layer, number> = {
      chords: .76 * p.brightness, rhythm: p.rhythm ? .72 : 0,
      drums: p.drums ? .68 + p.tension * .16 : 0,
      bass: p.bass ? .65 : 0, lead: p.lead ? .77 : 0,
    };
    const key = LAYERS.map(k => Math.round(mix[k] * 100)).join(':') + ':' + flavor +
      ':' + p.mode + ':' + p.night;
    if (key === this.lastPlanKey && !initial) return;
    this.lastPlanKey = key;
    for (const layer of LAYERS) {
      const param = this.gains[layer].gain;
      if (initial) param.value = mix[layer];
      else param.setTargetAtTime(mix[layer], now, .32);
    }
    for (const zone of FLAVORS) {
      const param = this.flavors[zone].gain;
      const target = flavor === zone ? .64 : 0;
      if (initial) param.value = target;
      else param.setTargetAtTime(target, now, .56);
    }
  }

  private scheduleStep(step: number, at: number): void {
    const p = this.plan, beat = step % 16, bar = Math.floor(step / 16);
    const flavor = locationFlavor(p.poi);
    const minor = p.night || p.mode === 'party';
    const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const chords = minor ? [0, 5, 3, 4] : [0, 3, 4, 5];
    const degree = chords[bar % chords.length]!;
    const melodic = scorePattern(this.seed, bar);
    const phraseNote = melodic[beat] ?? -1;
    const noteHz = (index: number, octave = 0): number => {
      const d = Math.max(0, index);
      return ROOTS[flavor] * Math.pow(2, (scale[d % 7]! + 12 * (Math.floor(d / 7) + octave)) / 12);
    };
    const duration = 60 / p.bpm;

    // Soft offbeat three-note chord pulse: cheerful farm pluck, night subdued.
    if (beat === 0 || beat === 8) {
      for (const note of [degree, degree + 2, degree + 4]) {
        this.synth.tone(this.gains.chords, at, noteHz(note, -1), duration * 1.65,
          .075 * p.intensity, flavor === 'town' ? 'triangle' : 'sine');
      }
    }

    if (p.rhythm && (beat === 0 || beat === 4 || beat === 7 || beat === 12)) {
      const wave: OscillatorType = flavor === 'coast' || flavor === 'forest' ? 'sine' :
        flavor === 'farm' ? 'triangle' : 'square';
      this.synth.tone(this.gains.rhythm, at, noteHz(degree + (beat === 7 ? 4 : 2), 0),
        flavor === 'mountain' ? .38 : .18, .11 * p.intensity, wave);
    }
    if (p.drums) {
      if (beat === 0 || beat === 8 || (beat === 12 && p.tension > .55)) {
        this.synth.tone(this.gains.drums, at, 105, .19, .26, 'sine', 48);
      }
      if (beat === 4 || beat === 12) this.synth.noise(this.gains.drums, at, .09, .16, 1700);
      if (beat % 2 === 0 || (p.tension > .6 && beat % 2 === 1)) {
        this.synth.noise(this.gains.drums, at, .048, .042, p.night ? 3200 : 5500, 'highpass');
      }
      if (beat === 15 && p.tension > .75 && this.random.next() > .42) {
        this.synth.tone(this.gains.drums, at, 250, .08, .095, 'triangle', 160);
      }
    }
    if (p.bass && (beat === 0 || beat === 6 || beat === 10 || beat === 12)) {
      const bass = noteHz(degree, -2);
      this.synth.tone(this.gains.bass, at, bass, duration * (beat === 0 ? .85 : .46),
        .25 * p.intensity, 'triangle', bass * .98);
    }
    if (p.lead && phraseNote >= 0 && [2, 3, 6, 9, 10, 14].includes(beat)) {
      this.scheduleMelody(flavor, at, noteHz(phraseNote + degree, 1), p.intensity);
    }
    // Keep the crossfade musically alive; don't just fade silence from the old area.
    if (this.previousFlavor && this.previousFlavor !== flavor &&
        at < this.transitionEnd && (beat === 2 || beat === 10)) {
      const old = this.previousFlavor;
      this.scheduleMelody(old, at, ROOTS[old] * 2, p.intensity * .58);
    }
  }

  private scheduleMelody(flavor: Flavor, at: number, hz: number, intensity: number): void {
    const node = this.flavors[flavor];
    const envelope: OscillatorType = flavor === 'farm' ? 'triangle' :
      flavor === 'coast' ? 'sine' : flavor === 'town' ? 'square' :
      flavor === 'forest' ? 'sine' : flavor === 'mountain' ? 'sine' : 'sawtooth';
    const sustain = flavor === 'mountain' || flavor === 'forest' ? .45 : .21;
    const amp = (flavor === 'town' || flavor === 'dam' ? .11 : .18) * intensity;
    this.synth.tone(node, at, hz, sustain, amp, envelope, hz * (flavor === 'coast' ? 1.015 : .996));
    if (flavor === 'mountain' || flavor === 'coast') {
      this.synth.tone(node, at + .045, hz * 2, sustain * .75, amp * .2, 'sine');
    }
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const g of Object.values(this.gains)) g.disconnect();
    for (const g of Object.values(this.flavors)) g.disconnect();
  }
}

/** Six inexpensive continuous procedural noise beds + sparse nature calls. */
export class IslandAmbience {
  private readonly beds = new Map<Flavor, {
    source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode;
  }>();
  private nextAccent: number;
  private updateAt = 0;
  private location: AudioLocation = 'hoofington';
  private night = false;
  private disposed = false;
  private readonly rng: AudioRandom;
  constructor(private readonly context: AudioContext,
    private readonly synth: ProceduralSynth, private readonly output: AudioNode,
    seed: number | string = 1) {
    this.rng = new AudioRandom('air-' + String(seed));
    this.nextAccent = context.currentTime + 2;
    const filters: Record<Flavor, number> = {
      farm: 840, coast: 1400, town: 570, forest: 2200, mountain: 500, dam: 280,
    };
    for (const flavor of FLAVORS) {
      const source = context.createBufferSource();
      source.buffer = synth.noiseBuffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = flavor === 'forest' ? 'bandpass' : 'lowpass';
      filter.frequency.value = filters[flavor];
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(output);
      source.start(context.currentTime);
      this.beds.set(flavor, { source, filter, gain });
    }
  }
  update(location: AudioLocation, night: boolean): void {
    if (this.disposed || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const changed = location !== this.location || night !== this.night;
    this.location = location;
    this.night = night;
    if (changed || now >= this.updateAt) {
      this.updateAt = now + .32;
      const target = locationFlavor(location);
      for (const [flavor, bed] of this.beds) {
        // At the dam it is a roaring low rumble; on the coast broad surf;
        // forest has soft stream noise with chirps; mountain has windy gusts.
        const volume: Record<Flavor, number> = {
          farm: .065, coast: .2, town: .085, forest: .14, mountain: .18, dam: .24,
        };
        const gust = flavor === 'mountain' ? .82 + .17 * Math.sin(now * .33) : 1;
        const afterDark = night && (flavor === 'forest' || flavor === 'farm') ? .55 : 1;
        bed.gain.gain.setTargetAtTime(flavor === target ?
          volume[flavor] * gust * afterDark : 0, now, .85);
        if (changed) {
          const fc = flavor === 'forest' ? (night ? 1250 : 2100) :
            flavor === 'coast' ? 1400 : flavor === 'dam' ? 280 : 750;
          bed.filter.frequency.setTargetAtTime(fc, now, .9);
        }
      }
    }
    if (now >= this.nextAccent) {
      const flavor = locationFlavor(location);
      let cue: SoundId | null = null;
      if (flavor === 'forest' || flavor === 'farm') cue = night ? null : 'ambient-bird';
      if (flavor === 'coast') cue = 'ambient-gull';
      if (flavor === 'town') cue = 'ambient-town';
      if (flavor === 'mountain') cue = 'ambient-wind';
      if (flavor === 'dam') cue = 'ambient-dam';
      if (cue) this.synth.play(cue, this.output, { when: now + .03, intensity: .28 });
      this.nextAccent = now + this.rng.range(night ? 6 : 3.4, night ? 11 : 7.2);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { source, filter, gain } of this.beds.values()) {
      try { source.stop(); } catch { /* already stopped during teardown */ }
      source.disconnect(); filter.disconnect(); gain.disconnect();
    }
    this.beds.clear();
  }
}
