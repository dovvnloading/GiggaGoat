import type { AudioLocation } from './logic';

export type Habitat = 'farm-paddock' | 'pines-understory';
export type EnvironmentSound = 'rain-lane' | 'rain-shelter' | 'after-rain' | 'pier-rigging' |
  'pine-crickets' | 'mill-axle' | 'turbine-house';
export type AmbienceLibrary = Readonly<Record<AudioLocation | Habitat, string> &
  Partial<Record<EnvironmentSound, string>>>;
export interface EnvironmentMix {
  rain: number;
  wet: number;
  sheltered: boolean;
  atPier: boolean;
  mill: number;
  turbine: number;
}
interface Layer { key: EnvironmentSound; level: number }

export function environmentLayers(location: AudioLocation, night: boolean,
  environment?: EnvironmentMix): { weather?: Layer; detail?: Layer } {
  if (!environment) return {};
  const { rain, wet, sheltered, atPier, mill, turbine } = environment;
  let weather: Layer | undefined;
  if (rain > .035) {
    weather = { key: sheltered ? 'rain-shelter' : 'rain-lane', level: .46 * rain };
  } else if (wet > .15 && (sheltered || location === 'whispering-pines' || location === 'hoofington')) {
    weather = { key: 'after-rain', level: .30 * wet };
  }
  let detail: Layer | undefined;
  if (location === 'hoofington' && mill > .015) detail = { key: 'mill-axle', level: mill * .56 };
  else if (turbine > .015) detail = { key: 'turbine-house', level: turbine * .60 };
  else if (location === 'baa-ardwalk' && atPier) detail = { key: 'pier-rigging', level: .44 };
  else if (location === 'whispering-pines' && night && rain < .90) {
    detail = { key: 'pine-crickets', level: .50 * (1 - rain) };
  }
  return { weather, detail };
}

// Only the selected recording is fetched. Crossing a boundary while a file
// decodes leaves the previous source audible until its replacement is ready.
class LoopLayer {
  private target?: string;
  private level = 0;
  private playing?: { url: string; source: AudioBufferSourceNode; gain: GainNode };
  private pending?: AbortController;
  private due = 0;
  private disposed = false;

  constructor(private readonly context: AudioContext, private readonly output: AudioNode) {}

  update(url: string | undefined, level: number): void {
    if (this.disposed || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.target !== url) {
      this.pending?.abort();
      this.pending = undefined;
      this.target = url;
      this.due = now + (this.playing ? .55 : 0);
      if (!url) this.fadeOut(1.4);
    }
    if (!url) return;
    const changed = Math.abs(this.level - level) > .006;
    if (changed || !this.playing) this.level = level;
    if (this.playing?.url === url) {
      if (changed) this.playing.gain.gain.setTargetAtTime(level, now, .28);
    } else if (!this.pending && now >= this.due) {
      void this.load(url);
    }
  }

  private async load(url: string): Promise<void> {
    const request = new AbortController();
    this.pending = request;
    try {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) throw new Error('Missing ambience recording');
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
      gain.gain.setTargetAtTime(this.level, now, .32);
      this.fadeOut(1.5);
      this.playing = { url, source, gain };
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

export class ZoneAmbience {
  private readonly base: LoopLayer;
  private readonly weather: LoopLayer;
  private readonly detail: LoopLayer;

  constructor(context: AudioContext, output: AudioNode, private readonly files: AmbienceLibrary) {
    this.base = new LoopLayer(context, output);
    this.weather = new LoopLayer(context, output);
    this.detail = new LoopLayer(context, output);
  }

  update(location: AudioLocation, night: boolean, habitat?: Habitat, env?: EnvironmentMix): void {
    const layers = environmentLayers(location, night, env);
    const rain = env?.rain ?? 0;
    const bedtime = night && location === 'whispering-pines' ? .62 : 1;
    this.base.update(this.files[habitat ?? location], .40 * bedtime * (1 - rain * .42));
    this.weather.update(layers.weather && this.files[layers.weather.key], layers.weather?.level ?? 0);
    this.detail.update(layers.detail && this.files[layers.detail.key], layers.detail?.level ?? 0);
  }

  dispose(): void { this.base.dispose(); this.weather.dispose(); this.detail.dispose(); }
}
