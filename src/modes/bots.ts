import type {
  Difficulty, GoatObservation, MatchView, ModeInputIntent, Point,
} from './types';
import { direction, distanceSquared, compareIds } from './internal';

type BotGoal = 'wander' | 'chase' | 'shove' | 'flee' | 'capture' | 'grab-hay' | 'carry-hay';
export interface BotSnapshot {
  version: 1;
  playerId: string;
  difficulty: Difficulty;
  rngState: number;
  nextPlanTick: number;
  lastButtTick: number;
  goal: BotGoal;
  target: Point;
  targetId: string | null;
}
const SKILL = {
  easy: { reaction: 45, error: 0.58, sprint: false, shoveRange: 2.3 },
  normal: { reaction: 18, error: 0.26, sprint: true, shoveRange: 2.7 },
  hard: { reaction: 5, error: 0.075, sprint: true, shoveRange: 3 },
} as const;

function mixSeed(seed: number, id: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h || 0x6d2b79f5;
}

/** Each bot owns its private PRNG and serializable tactical memory. It returns
 * the exact same ModeInputIntent contract as a human control adapter. */
export class BotBrain {
  private state: BotSnapshot;
  constructor(playerId: string, difficulty: Difficulty = 'normal', seed = 1) {
    if (!playerId || !(difficulty in SKILL) || !Number.isSafeInteger(seed)) {
      throw new Error('invalid bot ID, difficulty or seed');
    }
    this.state = { version: 1, playerId, difficulty, rngState: mixSeed(seed, playerId),
      nextPlanTick: 0, lastButtTick: -120, goal: 'wander', target: { x: 0, z: 0 },
      targetId: null };
  }
  get goal(): BotGoal { return this.state.goal; }
  toJSON(): BotSnapshot { return JSON.parse(JSON.stringify(this.state)) as BotSnapshot; }
  static fromJSON(snapshot: BotSnapshot): BotBrain {
    if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.rngState) ||
        !Number.isSafeInteger(snapshot.nextPlanTick) || !Number.isSafeInteger(snapshot.lastButtTick) ||
        !Number.isFinite(snapshot.target.x) || !Number.isFinite(snapshot.target.z)) {
      throw new Error('invalid bot snapshot');
    }
    const bot = new BotBrain(snapshot.playerId, snapshot.difficulty);
    bot.state = JSON.parse(JSON.stringify(snapshot)) as BotSnapshot;
    return bot;
  }
  /** xorshift32: predictable cross-browser, including a saved zero-free state. */
  private random(): number {
    let x = this.state.rngState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.state.rngState = x >>> 0;
    return this.state.rngState / 0x100000000;
  }
  private plan(view: MatchView, goats: readonly GoatObservation[], self: GoatObservation): void {
    const state = this.state;
    const me = view.players.find(p => p.id === state.playerId)!;
    const rivals = goats.filter(g => g.id !== state.playerId &&
      view.players.some(p => p.id === g.id && p.eliminatedAt === null &&
        (view.mode !== 'hay-heist' || p.teamId !== me.teamId)));
    rivals.sort((a, b) => distanceSquared(self.position, a.position) -
      distanceSquared(self.position, b.position) || compareIds(a.id, b.id));
    const nearest = rivals[0];
    state.targetId = null;

    if (view.mode === 'hay-heist') {
      const carried = view.bales.find(b => b.carrierId === state.playerId);
      if (carried) {
        state.goal = 'carry-hay';
        const barn = view.arena.barns.find(b => b.teamId === me.teamId)!;
        state.target = { x: barn.position.x, z: barn.position.z };
      } else {
        const candidates = view.bales.filter(b => b.homeTeam !== me.teamId && !b.carrierId)
          .sort((a, b) => distanceSquared(self.position, a.position) -
            distanceSquared(self.position, b.position) || compareIds(a.id, b.id));
        if (candidates.length) {
          state.goal = 'grab-hay';
          state.target = { x: candidates[0]!.position.x, z: candidates[0]!.position.z };
          state.targetId = candidates[0]!.id;
        } else if (nearest) {
          state.goal = 'chase';
          state.target = { x: nearest.position.x, z: nearest.position.z };
          state.targetId = nearest.id;
        }
      }
    } else if (view.mode === 'king-of-the-peak') {
      state.goal = 'capture';
      state.target = { x: view.arena.summit.x + (this.random() - 0.5) * 3.5,
        z: view.arena.summit.z + (this.random() - 0.5) * 3.5 };
      if (nearest && distanceSquared(self.position, nearest.position) < 7 ** 2) {
        state.goal = 'shove';
        state.targetId = nearest.id;
        state.target = { x: nearest.position.x, z: nearest.position.z };
      }
    } else {
      const nextLevel = view.arena.tideLevels.find(level => level > view.tideLevel) ??
        view.tideLevel;
      const safe = view.arena.elevationAt(self.position.x, self.position.z) > nextLevel + 4;
      if (!safe) {
        state.goal = 'flee';
        state.target = { x: view.arena.summit.x, z: view.arena.summit.z };
      } else if (nearest && distanceSquared(self.position, nearest.position) < 13 ** 2) {
        state.goal = 'shove';
        state.targetId = nearest.id;
        state.target = { x: nearest.position.x, z: nearest.position.z };
      } else {
        state.goal = 'wander';
        const angle = this.random() * Math.PI * 2;
        const distance = 8 + this.random() * 20;
        state.target = { x: self.position.x + Math.cos(angle) * distance,
          z: self.position.z + Math.sin(angle) * distance };
      }
    }
    state.nextPlanTick = view.tick + SKILL[state.difficulty].reaction;
  }

  decide(view: MatchView, goats: readonly GoatObservation[]): ModeInputIntent {
    const self = goats.find(g => g.id === this.state.playerId);
    const me = view.players.find(p => p.id === this.state.playerId);
    if (!self || !me) throw new Error('bot needs its observation and match player');
    if (view.phase !== 'playing' && view.phase !== 'overtime' || me.eliminatedAt !== null) {
      return { moveX: 0, moveZ: 0 };
    }
    const skill = SKILL[this.state.difficulty];
    // Picking up cargo changes our strategic objective immediately, even on easy.
    const carrying = view.bales.some(b => b.carrierId === me.id);
    if (view.tick >= this.state.nextPlanTick ||
        (carrying && this.state.goal !== 'carry-hay') ||
        (!carrying && this.state.goal === 'carry-hay')) this.plan(view, goats, self);

    const point = this.state.targetId && !['grab-hay'].includes(this.state.goal)
      ? goats.find(g => g.id === this.state.targetId)?.position ?? this.state.target
      : this.state.target;
    const dx = point.x - self.position.x;
    const dz = point.z - self.position.z;
    const distance = Math.hypot(dx, dz);
    const error = (this.random() - 0.5) * skill.error;
    const angle = Math.atan2(dz, dx) + error;
    const move = distance > (this.state.goal === 'carry-hay' ? 1 : 1.7)
      ? { x: Math.cos(angle), z: Math.sin(angle) } : { x: 0, z: 0 };
    const nearest = goats.filter(g => g.id !== me.id &&
      view.players.some(p => p.id === g.id && p.eliminatedAt === null &&
        (view.mode !== 'hay-heist' || p.teamId !== me.teamId)))
      .sort((a, b) => distanceSquared(a.position, self.position) -
        distanceSquared(b.position, self.position) || compareIds(a.id, b.id))[0];
    const opponentClose = nearest && distanceSquared(nearest.position, self.position) <
      skill.shoveRange ** 2;
    const butt = !!opponentClose && view.tick - this.state.lastButtTick >=
      (this.state.difficulty === 'easy' ? 100 : 40);
    if (butt) this.state.lastButtTick = view.tick;

    const wantsTongue = view.mode === 'hay-heist' && (
      carrying || (this.state.goal === 'grab-hay' &&
        view.bales.some(b => b.id === this.state.targetId && !b.carrierId &&
          distanceSquared(b.position, self.position) <= view.config.hayPickupRadius ** 2)));
    // Hard bots conserve stamina for the last delivery; carrying always disables sprint.
    const sprint = skill.sprint && !carrying && me.stamina > 25 && distance > 7;
    const answer: ModeInputIntent = {
      moveX: move.x, moveZ: move.z, sprint,
      tongue: wantsTongue,
      chargeHeadbutt: butt && this.state.goal !== 'carry-hay',
    };
    // The game adapter gets normalized camera-independent X/Z movement.
    const magnitude = Math.hypot(answer.moveX ?? 0, answer.moveZ ?? 0);
    if (magnitude > 1) {
      const d = direction({ x: answer.moveX!, z: answer.moveZ! });
      answer.moveX = d.x; answer.moveZ = d.z;
    }
    return answer;
  }
}
