import type { Craft } from './IslandTravel';
import type { HappeningMessage } from './IslandHappenings';

export const TRAVEL_TRIALS = {
  boat: {
    title: 'Harbourmaster’s ticket',
    briefing: 'Take the runabout past the harbour mouth, make a wide turn and bring it gently back to its berth.',
    steps: ['Sail 35 m from the berth', 'Turn 75° at cruising speed', 'Idle within 14 m of the berth for 1 s'],
  },
  plane: {
    title: 'Saltwind checkride',
    briefing: 'Take off under power, bank through a quarter turn and put both floats down on open water.',
    steps: ['Climb 10 m at 60 km/h', 'Bank through a 90° turn', 'Land on open water below 25 km/h'],
  },
  balloon: {
    title: 'Meadow weather sounding',
    briefing: 'Lift the weather gauge, hold a steady altitude for a reading and bring the basket back to dry ground.',
    steps: ['Climb 14 m above launch', 'Hold altitude for 3 s', 'Vent and settle on dry ground'],
  },
} as const;

export type TrialId = keyof typeof TRAVEL_TRIALS;
export const trialIds = Object.keys(TRAVEL_TRIALS) as TrialId[];
export type TrialBests = Partial<Record<TrialId, number>>;
const FIRST_FINISH_COINS = 60;
const RAD = Math.PI / 180;

export function trialTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  return Math.floor(tenths / 600) + ':' + ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
}

export class TravelTrials {
  readonly best: TrialBests = {};
  active?: { id: TrialId; stage: 0 | 1 | 2; seconds: number; heading: number; steady: number };
  result?: { id: TrialId; seconds: number; first: boolean; improved: boolean };

  constructor(saved?: TrialBests) {
    for (const id of trialIds) {
      const seconds = saved?.[id];
      if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) this.best[id] = seconds;
    }
  }

  start(id: TrialId, heading: number): void {
    this.result = undefined;
    this.active = { id, stage: 0, seconds: 0, heading, steady: 0 };
  }

  clear(): void {
    this.active = undefined;
    this.result = undefined;
  }

  tick(c: Craft, dt: number, ground: number, sea: number): number {
    const run = this.active;
    if (!run || c.kind !== run.id) return 0;
    run.seconds += dt;
    const p = c.position;
    const radius = Math.hypot(p.x - c.home.x, p.z - c.home.z);
    const height = p.y - Math.max(ground, sea);
    const turn = Math.abs(Math.atan2(Math.sin(c.heading - run.heading), Math.cos(c.heading - run.heading)));
    let reached: boolean;
    switch (run.id) {
      case 'boat':
        if (run.stage === 0) reached = radius >= 35 && c.speed >= 6;
        else if (run.stage === 1) reached = turn >= 75 * RAD && c.speed >= 6;
        else {
          run.steady = radius <= 14 && Math.abs(c.speed) <= 3 ? run.steady + dt : 0;
          reached = run.steady >= 1;
        }
        break;
      case 'plane':
        if (run.stage === 0) reached = height >= 10 && c.speed >= 60 / 3.6;
        else if (run.stage === 1) reached = height >= 6 && Math.abs(c.bank) >= .22 && turn >= 90 * RAD;
        else reached = ground < sea - .35 && Math.abs(p.y - sea) <= .25 &&
          Math.abs(c.vertical) < .5 && c.speed < 25 / 3.6;
        break;
      case 'balloon':
        if (run.stage === 0) reached = p.y >= c.home.y + 14 && height >= 6;
        else if (run.stage === 1) {
          run.steady = p.y >= c.home.y + 12 && height >= 6 && Math.abs(c.vertical) < .65 ? run.steady + dt : 0;
          reached = run.steady >= 3;
        } else reached = ground > sea + .22 && height <= .35 && Math.abs(c.vertical) < .5;
        break;
    }
    if (!reached) return 0;
    if (run.stage < 2) {
      run.stage = run.stage === 0 ? 1 : 2;
      run.heading = c.heading;
      run.steady = 0;
      return 0;
    }
    const previous = this.best[run.id];
    const seconds = Math.round(run.seconds * 100) / 100;
    const improved = previous === undefined || seconds < previous;
    if (improved) this.best[run.id] = seconds;
    this.result = { id: run.id, seconds, first: previous === undefined, improved };
    this.active = undefined;
    return previous === undefined ? FIRST_FINISH_COINS : 0;
  }

  message(instruments: string): HappeningMessage | undefined {
    if (this.result) {
      const { id, seconds, first, improved } = this.result;
      return { title: TRAVEL_TRIALS[id].title, task: 'Finished in ' + trialTime(seconds),
        detail: first ? '+60 CUD COINS · FIRST FINISH' : (improved ? 'NEW BEST ' : 'BEST ') + trialTime(this.best[id]!) };
    }
    const run = this.active;
    if (!run) return;
    const trial = TRAVEL_TRIALS[run.id];
    const reading = run.id === 'balloon' && run.stage === 1 ? ' · ' + Math.min(3, run.steady).toFixed(1) + '/3 s' : '';
    return { title: trial.title, task: (run.stage + 1) + '/3 · ' + trial.steps[run.stage] + reading,
      detail: trialTime(run.seconds) + ' · ' + instruments };
  }
}
