import { goatPitch, clamp } from './logic';
import type { AudioLocation, MusicState, SoundId } from './logic';
import type { SfxOptions, SoundRender } from './synth';

export type RecordedEffect = 'goat-bleat' | 'hoof-step-stone' | 'headbutt-wood' |
  'tongue-latch' | 'water-flop-splash' | 'gig-reward';
type Track = 'farm' | 'town' | 'coast';

export interface RecordedAssets {
  music: Readonly<Record<Track, string>>;
  effects: Readonly<Record<RecordedEffect, string>>;
}

const TRACKS: Readonly<Record<AudioLocation, Track>> = {
  hoofington: 'farm', 'whispering-pines': 'farm', 'crane-yard': 'town',
  'downtown-bleatsville': 'town', 'the-dam': 'town', 'baa-ardwalk': 'coast',
  'old-lighthouse': 'coast', 'mt-gigga': 'coast',
};
const EFFECTS: Partial<Record<SoundId, RecordedEffect>> = {
  bleat: 'goat-bleat', 'footstep-rock': 'hoof-step-stone', 'tongue-stick': 'tongue-latch',
};

/** Use the same unlocked context, volumes, and voice limits as the synthesized mix. */
export class RecordedAudio {
  readonly proceduralOutput: GainNode;
  private readonly effects = new Map<RecordedEffect, AudioBuffer>();
  private readonly failures = new Set<Track>();
  private target: Track | null = null;
  private due = 0;
  private pending: AbortController | null = null;
  private ready: { track: Track; buffer: AudioBuffer } | null = null;
  private playing: { track: Track; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private disposed = false;

  constructor(private readonly context: AudioContext, private readonly assets: RecordedAssets,
    private readonly output: AudioNode) {
    this.proceduralOutput = context.createGain();
    this.proceduralOutput.connect(output);
    void this.decodeEffects();
  }

  private async decodeEffects(): Promise<void> {
    // These are small one-shots. Decode them once after the first real interaction.
    for (const [name, data] of Object.entries(this.assets.effects)) {
      if (this.disposed) break;
      try {
        const bytes = Uint8Array.from(atob(data), byte => byte.charCodeAt(0));
        const buffer = await this.context.decodeAudioData(bytes.buffer);
        if (!this.disposed) this.effects.set(name as RecordedEffect, buffer);
      } catch { /* A synthesized cue is available while a recording is unavailable. */ }
    }
  }

  render(sound: SoundId, output: AudioNode, opts: SfxOptions, selected?: RecordedEffect): SoundRender | null {
    const effect = selected ?? EFFECTS[sound];
    const buffer = effect && this.effects.get(effect);
    if (!buffer || this.disposed || (sound === 'bleat' && opts.voice)) return null;
    const source = this.context.createBufferSource();
    const when = Math.max(this.context.currentTime, opts.when ?? 0);
    const pitch = (sound === 'bleat' ? goatPitch(opts.size ?? 1) : 1) * (opts.pitch ?? 1);
    const rate = clamp(pitch, .55, 1.75);
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(output);
    source.onended = () => source.disconnect();
    source.start(when);
    return { sources: [source], duration: buffer.duration / rate };
  }

  updateMusic(state: MusicState): void {
    if (this.disposed) return;
    const next = state.mode === 'free' ? TRACKS[state.poi] : null;
    const now = this.context.currentTime;
    if (next !== this.target) {
      this.pending?.abort();
      this.pending = null;
      this.ready = null;
      this.target = next;
      this.due = now + (this.playing ? .85 : 0);
      if (!next || this.failures.has(next)) this.useProcedural();
    }
    if (!next || this.playing?.track === next || now < this.due) return;
    if (this.ready?.track === next) {
      this.startTrack(next, this.ready.buffer);
      this.ready = null;
    } else if (!this.pending && !this.failures.has(next)) {
      void this.loadTrack(next);
    }
  }

  private async loadTrack(track: Track): Promise<void> {
    const pending = new AbortController();
    this.pending = pending;
    try {
      const response = await fetch(this.assets.music[track], { signal: pending.signal });
      if (!response.ok) throw new Error('Soundtrack unavailable');
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (!pending.signal.aborted && !this.disposed) this.ready = { track, buffer };
    } catch {
      if (!pending.signal.aborted && !this.disposed) {
        this.failures.add(track);
        if (track === this.target) this.useProcedural();
      }
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  private startTrack(track: Track, buffer: AudioBuffer): void {
    this.stopTrack(.6);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    gain.gain.value = 0;
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(this.output);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    source.start(now);
    gain.gain.setTargetAtTime(.50, now, .14);
    this.proceduralOutput.gain.setTargetAtTime(0, now, .13);
    this.playing = { track, source, gain };
  }

  private useProcedural(): void {
    this.stopTrack(.45);
    this.proceduralOutput.gain.setTargetAtTime(1, this.context.currentTime, .12);
  }

  private stopTrack(fade: number): void {
    const playing = this.playing;
    if (!playing) return;
    const now = this.context.currentTime;
    playing.gain.gain.setTargetAtTime(0, now, fade / 4);
    playing.source.stop(now + fade);
    this.playing = null;
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.abort();
    this.pending = null;
    this.ready = null;
    this.stopTrack(.01);
    this.effects.clear();
    this.proceduralOutput.disconnect();
  }
}
