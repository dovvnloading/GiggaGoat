import type { AudioCue, Vec3 } from '../audio';
import type { AmbientResidentState } from '../world';

/** Distance-driven, bounded Foley on the existing audio engine, never a second context. */
export class IslandLifeAudio {
  private readonly steps = new Map<string, number>();
  private readonly reactions = new Map<string, number>();
  private lastTime = -Infinity;
  private nextWater = 0;
  private disposed = false;
  constructor(private readonly fountains: readonly Vec3[]) {}

  sample(time: number, residents: readonly AmbientResidentState[], listener: Vec3,
    enabled: boolean): AudioCue[] {
    if (this.disposed || !Number.isFinite(time) || time === this.lastTime) return [];
    const first = this.lastTime === -Infinity || time < this.lastTime;
    if (first) this.nextWater = time;
    this.lastTime = time;
    const cues: Array<{cue:AudioCue;distance:number}> = [];
    for (const actor of residents) {
      const step = Math.floor(actor.distanceTravelled / (actor.height * .91 / 2) + actor.phase * 2);
      const previous = this.steps.get(actor.id);
      const reaction = this.reactions.get(actor.id) ?? actor.reactionUntil;
      this.steps.set(actor.id, step);
      this.reactions.set(actor.id, actor.reactionUntil);
      if (!enabled || first) continue;
      const p = actor.position;
      const distance = Math.hypot(p.x-listener.x,p.y-listener.y,p.z-listener.z);
      if (distance > 24) continue;
      if (previous !== undefined && step !== previous && actor.speed > .15) {
        cues.push({distance, cue:{sound:'footstep-resident',position:{...p},
          intensity:.25,pitch:.92+actor.phase*.14}});
      }
      if (actor.reactionUntil > reaction && (actor.activity === 'startle' || actor.activity === 'wave')) {
        cues.push({distance, cue:{sound:'ambient-resident',position:{x:p.x,y:p.y+actor.height*.8,z:p.z},
          intensity:.25,pitch:.9+actor.phase*.2}});
      }
    }
    if (enabled && time >= this.nextWater) {
      this.nextWater = time + .72;
      let closest: Vec3 | undefined, distance = 28;
      for (const p of this.fountains) {
        const d = Math.hypot(p.x-listener.x,p.y-listener.y,p.z-listener.z);
        if (d < distance) { distance=d; closest=p; }
      }
      if (closest) cues.push({distance, cue:{sound:'ambient-fountain',position:{...closest},intensity:.3}});
    }
    // Cull after observing all strides: returning to a busy street never replays missed steps.
    return cues.sort((a,b)=>a.distance-b.distance).slice(0,4).map(item=>item.cue);
  }
  dispose(): void { this.disposed = true; this.steps.clear(); this.reactions.clear(); }
}
