import { TUNING } from './config';
import { EventBus } from './events';
import { copyJSON, integer, nonNegative, requireNumber, requireRecord, requireString } from './math';

export interface WalletSnapshot { coins: number }
export class CudWallet {
  private amount = 0;
  constructor(private readonly bus: EventBus, initial = 0) {
    integer(initial, 'starting Cud Coins');
    this.amount = initial;
  }
  get coins(): number { return this.amount; }
  credit(coins: number, reason = 'reward'): void {
    integer(coins, 'coin reward');
    if (!coins) return;
    if (!Number.isSafeInteger(this.amount + coins)) throw new RangeError('wallet overflow');
    const before = this.amount; this.amount += coins;
    this.bus.emit('coins:changed', { before, after: this.amount, reason });
  }
  spend(coins: number, reason = 'purchase'): boolean {
    integer(coins, 'coin cost');
    if (coins > this.amount) return false;
    if (coins) {
      const before = this.amount; this.amount -= coins;
      this.bus.emit('coins:changed', { before, after: this.amount, reason });
    }
    return true;
  }
  toJSON(): WalletSnapshot { return { coins: this.amount }; }
  static fromJSON(raw: unknown, bus: EventBus): CudWallet {
    return new CudWallet(bus, requireNumber(requireRecord(raw, 'wallet').coins, 'wallet.coins'));
  }
}

export type UnlockId = keyof typeof TUNING.progression.unlockCosts;
export interface UnlockDefinition { id: UnlockId; category: 'ability' | 'gear'; description: string;
  cost: number; prerequisites: readonly UnlockId[] }
const definitions: Record<UnlockId, UnlockDefinition> = {
  glide: { id: 'glide', category: 'ability', cost: TUNING.progression.unlockCosts.glide,
    description: 'Hold jump in the air to open the sail. Steer with movement and release to fold.', prerequisites: [] },
  'wall-chalk': { id: 'wall-chalk', category: 'ability', cost: TUNING.progression.unlockCosts['wall-chalk'],
    description: 'Climbing grip sidegrade for tight routes.', prerequisites: [] },
  'aerial-horns': { id: 'aerial-horns', category: 'ability', cost: TUNING.progression.unlockCosts['aerial-horns'],
    description: 'Aerial flourish upgrade for physics adapters.', prerequisites: ['glide'] },
  'kite-cape': { id: 'kite-cape', category: 'gear', cost: TUNING.progression.unlockCosts['kite-cape'],
    description: 'Glider cosmetic with a glorious goat silhouette.', prerequisites: ['glide'] },
  'neon-hooves': { id: 'neon-hooves', category: 'gear', cost: TUNING.progression.unlockCosts['neon-hooves'],
    description: 'Hoof trail cosmetic; no gameplay advantage.', prerequisites: [] },
  'meteor-horns': { id: 'meteor-horns', category: 'gear', cost: TUNING.progression.unlockCosts['meteor-horns'],
    description: 'Show-off horn gear; no raw damage purchase.', prerequisites: ['aerial-horns'] },
};
export interface UnlocksSnapshot { unlocked: UnlockId[] }
export type UnlockResult = { ok: true } | { ok: false; reason: 'unknown' | 'owned' | 'prerequisite' | 'coins' };

export class UnlockRegistry {
  private readonly unlocked = new Set<UnlockId>();
  constructor(private readonly wallet: CudWallet, private readonly bus: EventBus) {}
  get catalog(): UnlockDefinition[] { return Object.values(definitions).map(d => copyJSON(d)); }
  isUnlocked(id: UnlockId): boolean { return this.unlocked.has(id); }
  purchase(id: UnlockId): UnlockResult {
    const definition = definitions[id] as UnlockDefinition | undefined;
    if (!definition) return { ok: false, reason: 'unknown' };
    if (this.unlocked.has(id)) return { ok: false, reason: 'owned' };
    if (definition.prerequisites.some(req => !this.unlocked.has(req))) return { ok: false, reason: 'prerequisite' };
    if (!this.wallet.spend(definition.cost, `unlock:${id}`)) return { ok: false, reason: 'coins' };
    this.unlocked.add(id);
    this.bus.emit('unlock:claimed', { id, category: definition.category });
    return { ok: true };
  }
  toJSON(): UnlocksSnapshot { return { unlocked: [...this.unlocked].sort() }; }
  static fromJSON(raw: unknown, wallet: CudWallet, bus: EventBus): UnlockRegistry {
    const obj = requireRecord(raw, 'unlocks');
    if (!Array.isArray(obj.unlocked)) throw new TypeError('unlocks.unlocked must be an array');
    const result = new UnlockRegistry(wallet, bus);
    for (const item of obj.unlocked) {
      const id = requireString(item, 'unlock id') as UnlockId;
      if (!definitions[id] || result.unlocked.has(id)) throw new RangeError('unknown/duplicate unlocked ID');
      result.unlocked.add(id);
    }
    for (const id of result.unlocked) {
      if (definitions[id].prerequisites.some(pr => !result.unlocked.has(pr))) throw new RangeError('orphaned unlock prerequisite');
    }
    return result;
  }
}

export type ChallengeId = keyof typeof TUNING.progression.challengeGoals;
export interface ChallengeProgress { value: number; completed: boolean }
export interface ChallengesSnapshot { progress: Record<ChallengeId, ChallengeProgress> }
export interface ChallengeDefinition { id: ChallengeId; title: string; goal: number; reward: number; unit: 'tricks' | 'metres' | 'events' | 'pieces' }
const challenges: Record<ChallengeId, ChallengeDefinition> = {
  'five-trick-combo': { id: 'five-trick-combo', title: 'Five-Trick Stampede', unit: 'tricks',
    goal: TUNING.progression.challengeGoals['five-trick-combo'], reward: TUNING.progression.challengeRewards['five-trick-combo'] },
  'mountain-goat': { id: 'mountain-goat', title: 'Vertical Legend', unit: 'metres',
    goal: TUNING.progression.challengeGoals['mountain-goat'], reward: TUNING.progression.challengeRewards['mountain-goat'] },
  'wrecking-crew': { id: 'wrecking-crew', title: 'Wrecking Crew', unit: 'events',
    goal: TUNING.progression.challengeGoals['wrecking-crew'], reward: TUNING.progression.challengeRewards['wrecking-crew'] },
  'sling-king': { id: 'sling-king', title: 'Lick-Sling King', unit: 'events',
    goal: TUNING.progression.challengeGoals['sling-king'], reward: TUNING.progression.challengeRewards['sling-king'] },
  'master-builder': { id: 'master-builder', title: 'Hay Architect', unit: 'pieces',
    goal: TUNING.progression.challengeGoals['master-builder'], reward: TUNING.progression.challengeRewards['master-builder'] },
};

/** Uses the SAME typed events as scoring/building; achievements cannot re-pay. */
export class ChallengeTracker {
  private progress: Record<ChallengeId, ChallengeProgress> = {
    'five-trick-combo': { value: 0, completed: false },
    'mountain-goat': { value: 0, completed: false },
    'wrecking-crew': { value: 0, completed: false },
    'sling-king': { value: 0, completed: false },
    'master-builder': { value: 0, completed: false },
  };
  constructor(private readonly wallet: CudWallet, private readonly bus: EventBus) {
    bus.on('style:scored', e => {
      if (e.distinct >= TUNING.progression.fiveTrickDistinct && e.points > 0) {
        this.advance('five-trick-combo', e.comboCount, true);
      }
      if (e.trick === 'destruction') this.advance('wrecking-crew', 1);
      if (e.trick === 'tongue-swing') this.advance('sling-king', 1);
    });
    bus.on('traversal', e => { if (e.kind === 'climb') this.advance('mountain-goat', e.metres); });
    bus.on('build:placed', () => this.advance('master-builder', 1));
  }
  get catalog(): ChallengeDefinition[] { return Object.values(challenges).map(d => copyJSON(d)); }
  getProgress(id: ChallengeId): ChallengeProgress { return { ...this.progress[id] }; }
  private advance(id: ChallengeId, value: number, absolute = false): void {
    nonNegative(value, 'challenge progress');
    const current = this.progress[id];
    if (current.completed || !value) return;
    current.value = Math.min(challenges[id].goal, absolute ? Math.max(current.value, value) : current.value + value);
    this.bus.emit('challenge:progress', { id, value: current.value, goal: challenges[id].goal });
    if (current.value >= challenges[id].goal) {
      current.completed = true;
      this.wallet.credit(challenges[id].reward, `challenge:${id}`);
      this.bus.emit('challenge:completed', { id, reward: challenges[id].reward });
    }
  }
  toJSON(): ChallengesSnapshot { return { progress: copyJSON(this.progress) }; }
  static fromJSON(raw: unknown, wallet: CudWallet, bus: EventBus): ChallengeTracker {
    const obj = requireRecord(raw, 'challenges');
    const progress = requireRecord(obj.progress, 'challenge progress');
    const next = new ChallengeTracker(wallet, bus);
    for (const id of Object.keys(challenges) as ChallengeId[]) {
      const row = requireRecord(progress[id], `challenge ${id}`);
      const value = requireNumber(row.value, `challenge ${id} value`);
      if (value < 0 || value > challenges[id].goal || typeof row.completed !== 'boolean' ||
        (row.completed !== (value >= challenges[id].goal))) throw new RangeError(`invalid challenge ${id}`);
      next.progress[id] = { value, completed: row.completed };
    }
    return next;
  }
}
