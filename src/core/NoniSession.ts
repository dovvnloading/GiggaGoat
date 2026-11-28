import type { HappeningSite, HappeningMessage } from './IslandHappenings';

export const NONIS = "Noni's Metal Records";
export const RECORDS = ['Basalt Teeth', 'Midnight Molt'] as const;
export const BAR = 2; // Both pressings are in 4/4 at 120 BPM.
export const HIT_WINDOW = 0.32;
export interface RecordPlayback {
  side: 0 | 1;
  age: number;
  gain: number;
}

export class NoniSession {
  readonly site: HappeningSite;
  side: 0 | 1 = 0;
  hits = 0;
  private started = -Infinity;
  private lastBar = -1;
  private feedback = '';
  private feedbackUntil = 0;

  constructor(site: HappeningSite) {
    this.site = site;
  }

  age(time: number): number | undefined {
    const age = time - this.started;
    return age >= 0 && age < 16 ? age : undefined;
  }

  lights(age: number): number {
    const downbeat = Math.round(age / BAR) * BAR;
    if (downbeat >= BAR && downbeat <= 14 && Math.abs(age - downbeat) <= HIT_WINDOW) return 4;
    return Math.min(3, Math.floor((age % BAR) / 0.5));
  }

  stop(): void {
    this.started = -Infinity;
  }

  /** Return true only on the transition into the B-side. */
  play(time: number): boolean {
    const age = this.age(time);
    if (age === undefined) {
      this.started = time;
      this.side = 0;
      this.hits = 0;
      this.lastBar = 0;
      this.feedback = '';
      return false;
    }
    if (this.side === 1) return false;
    const bar = Math.round(age / BAR);
    if (bar === this.lastBar) return false;
    if (bar < 1 || bar > 7 || Math.abs(age - bar * BAR) > HIT_WINDOW) {
      this.feedback = 'Listen for the next downbeat';
    } else {
      this.hits++;
      this.lastBar = bar;
      this.feedback = 'Right on the beat!';
      if (this.hits === 3) {
        this.side = 1;
        this.started = time;
        return true;
      }
    }
    this.feedbackUntil = time + 0.7;
    return false;
  }

  message(time: number, rewarded: boolean): HappeningMessage | undefined {
    const age = this.age(time);
    if (age === undefined) return;
    if (this.side === 1)
      return {
        title: NONIS,
        task: 'Flipside · ' + RECORDS[1],
        detail: rewarded ? 'FIRST ENCORE · +35 CUD COINS' : 'ENCORE · SIDE B',
      };
    const lights = this.lights(age);
    const cue = lights === 4;
    const task =
      this.feedback && time < this.feedbackUntil
        ? this.feedback
        : cue
          ? 'Bleat now!'
          : 'Bleat when all four lamps light';
    return {
      title: RECORDS[0],
      task,
      detail: this.hits + '/3 DOWNBEATS · ' + ('● '.repeat(lights) + '○ '.repeat(4 - lights)).trimEnd(),
    };
  }
}
