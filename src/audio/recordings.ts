import { goatPitch, clamp } from './logic';
import type { AudioLocation, MusicState, SoundId } from './logic';
import type { SfxOptions, SoundRender } from './synth';
import type { RECORDED_EFFECTS } from './recorded-effects';

export type RecordedEffect = keyof typeof RECORDED_EFFECTS;
type Region = 'farm' | 'town' | 'coast';
type Track = Region | AudioLocation | 'party';

interface FoleyBank {
  url: string;
  contacts: Readonly<Record<string, ReadonlyArray<ReadonlyArray<number>>>>;
}
export interface RecordedAssets {
  foley?: FoleyBank;
  ambience?: import('./zone-ambience').AmbienceLibrary;
  music: Readonly<Record<Region, string> & Partial<Record<AudioLocation | 'party', string>>>;
  effects: Readonly<Partial<Record<RecordedEffect, string>>>;
}

const TRACKS: Readonly<Record<AudioLocation, Region>> = {
  hoofington: 'farm', 'whispering-pines': 'farm', 'crane-yard': 'town',
  'downtown-bleatsville': 'town', 'the-dam': 'town', 'baa-ardwalk': 'coast',
  'old-lighthouse': 'coast', 'mt-gigga': 'coast',
};
const EFFECTS: Partial<Record<SoundId, RecordedEffect>> = {
  bleat: 'goat-bleat',
  'footstep-grass': 'footstep-grass', 'footstep-sand': 'footstep-sand',
  'footstep-wood': 'footstep-wood', 'footstep-rock': 'hoof-step-stone',
  'footstep-metal': 'footstep-metal', 'footstep-water': 'footstep-water',
  jump: 'jump', 'flip-whoosh': 'flip-whoosh', landing: 'landing',
  'ragdoll-flop': 'ragdoll-flop', climb: 'climb', 'headbutt-charge': 'headbutt-charge',
  'tongue-shoot': 'tongue-shoot', 'tongue-stick': 'tongue-latch',
  'tongue-reel': 'tongue-reel', 'tongue-snap': 'tongue-snap',
  'build-place': 'build-place', 'build-snap': 'build-snap', 'build-collapse': 'build-collapse',
  trampoline: 'trampoline', coin: 'coin', 'gig-fail': 'gig-fail', victory: 'victory',
  'ui-click': 'ui-click', 'ui-back': 'ui-back', 'ui-confirm': 'ui-confirm',
};

/** Use the same unlocked context, volumes, and voice limits as the synthesized mix. */
export class RecordedAudio {
  readonly proceduralOutput: GainNode;
  private readonly effects = new Map<RecordedEffect, { buffer: AudioBuffer; offset: number }>();
  private foley?: AudioBuffer;
  private readonly foleyRequest = new AbortController();
  private readonly variations = new Map<string, number>();
  private loadFailed = false;
  private target?: Track | null;
  private due = 0;
  private pending: AbortController | null = null;
  private ready: { track: Track; buffer: AudioBuffer } | null = null;
  private readonly positions = new Map<Track, number>();
  private playing: { track: Track; source: AudioBufferSourceNode; gain: GainNode; origin: number } | null = null;
  private disposed = false;

  constructor(private readonly context: AudioContext, private readonly assets: RecordedAssets,
    private readonly output: AudioNode) {
    this.proceduralOutput = context.createGain();
    this.proceduralOutput.gain.value = 0; // No unrelated intro while the selected track decodes.
    this.proceduralOutput.connect(output);
    void this.decodeEffects();
    if (assets.foley) void this.decodeFoley(assets.foley.url);
  }

  private async decodeFoley(url: string): Promise<void> {
    try {
      const res = await fetch(url, { signal: this.foleyRequest.signal });
      if (!res.ok) return;
      const buffer = await this.context.decodeAudioData(await res.arrayBuffer());
      if (!this.disposed) this.foley = buffer;
    } catch { /* The individually embedded recordings remain playable. */ }
  }

  private async decodeEffects(): Promise<void> {
    // These are small one-shots. Decode them once after the first real interaction.
    const entries = Object.entries(this.assets.effects).sort(([a], [b]) => Number(b.startsWith('ui-')) - Number(a.startsWith('ui-')));
    for (const [name, data] of entries) {
      if (this.disposed) break;
      try {
        const bytes = Uint8Array.from(atob(data), byte => byte.charCodeAt(0));
        const buffer = await this.context.decodeAudioData(bytes.buffer);
        // Keep the recorded attack and remove encoder padding before time-critical cues.
        const samples = buffer.getChannelData(0);
        const limit = Math.min(samples.length, Math.floor(buffer.sampleRate * .13));
        let first = 0;
        while (first < limit && Math.abs(samples[first]!) < .004) first++;
        const offset = first === limit ? 0 : Math.max(0, first / buffer.sampleRate - .005);
        if (!this.disposed) this.effects.set(name as RecordedEffect, { buffer, offset });
      } catch { /* A synthesized cue is available while a recording is unavailable. */ }
    }
  }

  render(sound: SoundId, output: AudioNode, opts: SfxOptions, selected?: RecordedEffect): SoundRender | null {
    const effect = selected ?? EFFECTS[sound];
    if (this.disposed || (sound === 'bleat' && opts.voice)) return null;
    const key = !selected && opts.surface && (sound === 'jump' || sound === 'landing')
      ? sound + '-' + opts.surface : selected ?? sound;
    const variants = this.assets.foley?.contacts[key];
    let clip = effect && this.effects.get(effect);
    let length: number | undefined;
    if (this.foley && variants?.length) {
      const index = this.variations.get(key) ?? 0;
      const [offset, duration] = variants[index]!;
      this.variations.set(key, (index + 1) % variants.length);
      if (offset !== undefined && duration !== undefined) {
        clip = { buffer: this.foley, offset };
        length = duration;
      }
    }
    if (!clip) return null;
    const source = this.context.createBufferSource();
    const when = Math.max(this.context.currentTime, opts.when ?? 0);
    const pitch = (sound === 'bleat' ? goatPitch(opts.size ?? 1) : 1) * (opts.pitch ?? 1);
    const rate = clamp(pitch, .55, 1.75);
    const { buffer, offset } = clip;
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(output);
    source.onended = () => source.disconnect();
    if (length !== undefined) source.start(when, offset, length);
    else source.start(when, offset);
    return { sources: [source], duration: (length ?? buffer.duration - offset) / rate };
  }

  updateMusic(state: MusicState): void {
    if (this.disposed) return;
    const freeRoamTrack = this.assets.music[state.poi] ? state.poi : TRACKS[state.poi];
    const next = state.mode === 'free' ? freeRoamTrack : this.assets.music.party ? 'party' : null;
    const now = this.context.currentTime;
    if (next !== this.target) {
      this.pending?.abort();
      this.pending = null;
      this.ready = null;
      this.target = next;
      this.loadFailed = false;
      this.due = now + (this.playing ? .85 : 0);
      if (!next) this.useProcedural();
    }
    if (!next || this.playing?.track === next || now < this.due) return;
    if (this.ready?.track === next) {
      this.startTrack(next, this.ready.buffer);
      this.ready = null;
    } else if (!this.pending && !this.loadFailed) {
      void this.loadTrack(next);
    }
  }

  private async loadTrack(track: Track): Promise<void> {
    const pending = new AbortController();
    this.pending = pending;
    try {
      const url = this.assets.music[track];
      if (!url) return;
      const response = await fetch(url, { signal: pending.signal });
      if (!response.ok) throw new Error('Soundtrack unavailable');
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (!pending.signal.aborted && !this.disposed) this.ready = { track, buffer };
    } catch {
      if (!pending.signal.aborted && !this.disposed) {
        this.loadFailed = true;
        this.useProcedural();
      }
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  private startTrack(track: Track, buffer: AudioBuffer): void {
    this.stopTrack(1.4);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    gain.gain.value = 0;
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(this.output);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    const offset = (this.positions.get(track) ?? 0) % buffer.duration;
    source.start(now, offset);
    gain.gain.setTargetAtTime(.50, now, .38);
    this.proceduralOutput.gain.setTargetAtTime(0, now, .13);
    this.playing = { track, source, gain, origin: now - offset };
  }

  private useProcedural(): void {
    this.stopTrack(.45);
    this.proceduralOutput.gain.setTargetAtTime(1, this.context.currentTime, .12);
  }

  private stopTrack(fade: number): void {
    const playing = this.playing;
    if (!playing) return;
    const now = this.context.currentTime;
    this.positions.set(playing.track, now - playing.origin);
    playing.gain.gain.setTargetAtTime(0, now, fade / 4);
    playing.source.stop(now + fade);
    this.playing = null;
  }

  dispose(): void {
    this.disposed = true;
    this.foleyRequest.abort();
    this.foley = undefined;
    this.pending?.abort();
    this.pending = null;
    this.ready = null;
    this.stopTrack(.01);
    this.effects.clear();
    this.proceduralOutput.disconnect();
  }
}
