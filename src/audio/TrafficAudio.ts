import lightMotor from './assets/traffic/motor.ogg?url';
import dieselMotor from './assets/traffic/diesel.ogg?url';
import horn from './assets/traffic/acknowledgement.ogg?url';
import type { Vec3 } from './logic';

export interface TrafficEmitter {
  id: string;
  engine: 'motor' | 'diesel';
  position: Vec3;
  gain: number;
  rate: number;
  acknowledgement?: number;
}
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: PannerNode;
}

/** Real recordings follow the two nearest vehicles on the world's existing audio buses. */
export class TrafficAudio {
  private readonly clips = new Map<string, AudioBuffer>();
  private readonly fetching = new Set<string>();
  private readonly retry = new Map<string, number>();
  private readonly engines = new Map<string, Voice>();
  private readonly heard = new Map<string, number>();
  private horn?: Voice;
  private disposed = false;
  constructor(
    private ctx: AudioContext,
    private ambience: GainNode,
    private sfx: GainNode
  ) {}
  private buffer(key: 'motor' | 'diesel' | 'horn'): AudioBuffer | undefined {
    const existing = this.clips.get(key);
    if (existing || this.fetching.has(key) || this.ctx.currentTime < (this.retry.get(key) ?? 0))
      return existing;
    this.fetching.add(key);
    void fetch({ motor: lightMotor, diesel: dieselMotor, horn }[key])
      .then((response) => {
        if (!response.ok) throw Error(String(response.status));
        return response.arrayBuffer();
      })
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buffer) => {
        if (!this.disposed) this.clips.set(key, buffer);
      })
      .catch(() => this.retry.set(key, this.ctx.currentTime + 8))
      .finally(() => this.fetching.delete(key));
  }
  private start(buffer: AudioBuffer, loop: boolean, at: Vec3): Voice {
    const source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain(),
      pan = this.ctx.createPanner();
    pan.panningModel = 'equalpower';
    pan.rolloffFactor = 0;
    pan.positionX.value = at.x;
    pan.positionY.value = at.y;
    pan.positionZ.value = at.z;
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(pan);
    pan.connect(loop ? this.ambience : this.sfx);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
    source.start();
    return { source, gain, pan };
  }
  private fade(voice: Voice): void {
    const now = this.ctx.currentTime;
    voice.gain.gain.setTargetAtTime(0, now, 0.035);
    voice.source.stop(now + 0.15);
  }
  update(emitters: readonly TrafficEmitter[] = []): void {
    const now = this.ctx.currentTime;
    for (const [id, voice] of this.engines)
      if (!emitters.some((e) => e.id === id)) {
        this.fade(voice);
        this.engines.delete(id);
      }
    for (const e of emitters) {
      const clip = this.buffer(e.engine),
        beep = this.buffer('horn');
      if (clip) {
        let voice = this.engines.get(e.id);
        if (!voice) {
          voice = this.start(clip, true, e.position);
          this.engines.set(e.id, voice);
        }
        voice.pan.positionX.value = e.position.x;
        voice.pan.positionY.value = e.position.y;
        voice.pan.positionZ.value = e.position.z;
        voice.gain.gain.setTargetAtTime(e.gain * 0.52, now, 0.07);
        voice.source.playbackRate.setTargetAtTime(e.rate, now, 0.09);
      }
      if (beep && e.acknowledgement !== undefined && this.heard.get(e.id) !== e.acknowledgement) {
        this.heard.set(e.id, e.acknowledgement);
        if (this.horn) this.fade(this.horn);
        const voice = this.start(beep, false, e.position);
        voice.gain.gain.setTargetAtTime(e.gain * 0.9, now, 0.008);
        voice.source.playbackRate.value = e.engine === 'diesel' ? 0.83 : 1.04;
        this.horn = voice;
        const cleanup = voice.source.onended!;
        voice.source.onended = (event) => {
          cleanup.call(voice.source, event);
          if (this.horn === voice) this.horn = undefined;
        };
      }
    }
  }
  stop(): void {
    for (const v of this.engines.values()) this.fade(v);
    this.engines.clear();
    if (this.horn) {
      this.fade(this.horn);
      this.horn = undefined;
    }
  }
  dispose(): void {
    this.disposed = true;
    this.stop();
    this.clips.clear();
  }
}
