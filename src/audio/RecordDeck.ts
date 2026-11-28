import sideA from './assets/nonis/basalt-teeth.ogg?url';
import sideB from './assets/nonis/midnight-molt.ogg?url';
import type { RecordPlayback } from '../core/NoniSession';

/** Keep the needle on the simulation clock, including after pause or walking back into earshot. */
export class RecordDeck {
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly loading = new Set<number>();
  private retryAfter = 0;
  private playing?: { source: AudioBufferSourceNode; side: number; origin: number };
  private readonly volume: GainNode;
  private disposed = false;

  constructor(
    private ctx: AudioContext,
    output: GainNode,
    private bed: GainNode,
  ) {
    this.volume = ctx.createGain();
    this.volume.gain.value = 0;
    this.volume.connect(output);
  }

  private async load(side: 0 | 1) {
    if (this.loading.has(side) || this.ctx.currentTime < this.retryAfter) return;
    this.loading.add(side);
    try {
      const response = await fetch(side === 0 ? sideA : sideB);
      if (!response.ok) throw new Error(String(response.status));
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      if (!this.disposed) this.buffers.set(side, buffer);
    } catch {
      this.retryAfter = this.ctx.currentTime + 4;
    } finally {
      this.loading.delete(side);
    }
  }

  update(play?: RecordPlayback) {
    if (!play || play.gain <= 0.005) {
      this.stop();
      return;
    }
    const buffer = this.buffers.get(play.side);
    if (!buffer) {
      this.stop();
      void this.load(play.side);
      return;
    }
    if (play.age >= buffer.duration) {
      this.stop();
      return;
    }
    const now = this.ctx.currentTime;
    if (
      !this.playing ||
      this.playing.side !== play.side ||
      Math.abs(now - this.playing.origin - play.age) > 0.22
    ) {
      this.stop();
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.volume);
      source.onended = () => source.disconnect();
      source.start(now, play.age);
      this.playing = { source, side: play.side, origin: now - play.age };
    }
    this.volume.gain.setTargetAtTime(play.gain * 0.72, now, 0.045);
    this.bed.gain.setTargetAtTime(1 - play.gain * 0.88, now, 0.12);
    if (play.side === 0 && !this.buffers.has(1)) void this.load(1);
  }

  stop() {
    if (!this.playing) return;
    this.playing.source.stop();
    this.playing = undefined;
    this.volume.gain.setTargetAtTime(0, this.ctx.currentTime, 0.025);
    this.bed.gain.setTargetAtTime(1, this.ctx.currentTime, 0.15);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.volume.disconnect();
    this.buffers.clear();
  }
}
