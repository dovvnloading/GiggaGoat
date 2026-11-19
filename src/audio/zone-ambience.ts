import type { AudioLocation } from './logic';

export type Habitat = 'farm-paddock' | 'pines-understory';
export type AmbienceKey = AudioLocation | Habitat;
export type AmbienceLibrary = Readonly<Record<AmbienceKey, string>>;

/** A settled listener crosses into a new soundscape while the previous recording keeps playing. */
export class ZoneAmbience {
  private target?: AmbienceKey;
  private playing?: { key: AmbienceKey; source: AudioBufferSourceNode; gain: GainNode };
  private pending?: AbortController;
  private due = 0;
  private disposed = false;

  constructor(private readonly context: AudioContext, private readonly output: AudioNode,
    private readonly files: AmbienceLibrary) {}

  update(location: AudioLocation, _night: boolean, habitat?: Habitat): void {
    const key = habitat ?? location;
    if (this.disposed || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.target !== key) {
      this.pending?.abort();
      this.pending = undefined;
      this.target = key;
      this.due = now + (this.playing ? .8 : 0);
    }
    if (!this.pending && this.playing?.key !== key && now >= this.due) void this.load(key);
  }

  private async load(key: AmbienceKey): Promise<void> {
    const request = new AbortController();
    this.pending = request;
    try {
      const response = await fetch(this.files[key], { signal: request.signal });
      if (!response.ok) throw new Error('Missing zone ambience');
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (this.disposed || request.signal.aborted) return;
      const now = this.context.currentTime;
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain); gain.connect(this.output);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      gain.gain.value = 0;
      source.start(now, now % buffer.duration);
      gain.gain.setTargetAtTime(.40, now, .42);
      this.fadeOut(1.8);
      this.playing = { key, source, gain };
    } catch {
      if (!request.signal.aborted) this.due = this.context.currentTime + 8;
    } finally {
      if (this.pending === request) this.pending = undefined;
    }
  }

  private fadeOut(seconds: number): void {
    if (!this.playing) return;
    const { source, gain } = this.playing, now = this.context.currentTime;
    gain.gain.setTargetAtTime(0, now, seconds / 5);
    source.stop(now + seconds);
    this.playing = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.abort();
    this.fadeOut(.02);
  }
}
