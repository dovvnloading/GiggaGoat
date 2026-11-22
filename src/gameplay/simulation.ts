import { TUNING } from './config';
import { EventBus } from './events';
import { SeededRng } from './rng';
import type { RngSnapshot } from './rng';
import { GoatAbilities, NEUTRAL_FACTS } from './abilities';
import type { AbilitiesSnapshot, AbilityCommands, GoatIntent, GoatPhysicsFacts } from './abilities';
import { StyleSystem } from './style';
import type { StyleEvent, StyleSnapshot } from './style';
import { HayBuild, Inventory } from './build';
import type { BuildSnapshot, MaterialCounts } from './build';
import { ChallengeTracker, CudWallet, UnlockRegistry } from './progression';
import type { ChallengesSnapshot, UnlocksSnapshot, WalletSnapshot } from './progression';
import { integer, nonNegative, requireNumber, requireRecord } from './math';

export interface GameSnapshot {
  version: 1; tick: number; remainder: number; pendingClimbDistance: number;
  pendingImpact: number; pendingPulses: { jump: boolean; bleat: boolean; flop: boolean; flingTongue: boolean };
  rng: RngSnapshot; abilities: AbilitiesSnapshot; style: StyleSnapshot;
  inventory: MaterialCounts; build: BuildSnapshot; wallet: WalletSnapshot;
  unlocks: UnlocksSnapshot; challenges: ChallengesSnapshot;
}
export interface SimulationStep { ticks: number; commands: AbilityCommands[]; alpha: number }

/** All state is owned per-instance. No rendering, physics, clocks or random globals. */
export class GameSimulation {
  readonly events = new EventBus();
  rng: SeededRng;
  abilities: GoatAbilities;
  style: StyleSystem;
  inventory: Inventory;
  build: HayBuild;
  wallet: CudWallet;
  unlocks: UnlockRegistry;
  challenges: ChallengeTracker;
  private tickCount = 0;
  private remainder = 0;
  private pendingClimbDistance = 0;
  private pendingImpact = 0;
  private pendingPulses = { jump: false, bleat: false, flop: false, flingTongue: false };

  constructor(seed = 1) {
    this.rng = new SeededRng(seed);
    this.abilities = new GoatAbilities(this.events);
    this.style = new StyleSystem(this.events);
    this.inventory = new Inventory(this.events);
    this.build = new HayBuild(this.inventory, this.events);
    this.wallet = new CudWallet(this.events);
    this.unlocks = new UnlockRegistry(this.wallet, this.events);
    this.challenges = new ChallengeTracker(this.wallet, this.events);
  }
  get tick(): number { return this.tickCount; }
  get time(): number { return this.tickCount * TUNING.fixedDt; }

  awardStyle(event: StyleEvent): number { return this.style.ingest(event); }
  recordClimb(metres: number): void {
    nonNegative(metres, 'climb distance');
    if (metres) this.events.emit('traversal', { kind: 'climb', metres });
  }

  resetForRespawn(held: GoatIntent): void {
    this.pendingClimbDistance = 0;
    this.pendingImpact = 0;
    this.pendingPulses = { jump: false, bleat: false, flop: false, flingTongue: false };
    this.abilities.resetForRespawn(held);
  }

  /** Advance only COMPLETE 60Hz ticks. Input/facts describe the latest external frame;
   * callers should sample physics each tick for precision-sensitive actions. */
  update(dt: number, intent: GoatIntent = {}, facts: GoatPhysicsFacts = NEUTRAL_FACTS): SimulationStep {
    nonNegative(dt, 'dt');
    if (facts.climbDistance !== undefined) nonNegative(facts.climbDistance, 'climbDistance');
    if (facts.impact !== undefined) nonNegative(facts.impact, 'impact');
    const total = this.remainder + dt;
    const ticks = Math.floor(total / TUNING.fixedDt + 1e-9);
    if (ticks > TUNING.maxTicksPerAdvance) throw new RangeError('frame advance exceeds safe tick limit');
    if (!Number.isFinite(this.pendingClimbDistance + (facts.climbDistance ?? 0)) ||
      !Number.isFinite(this.pendingImpact + (facts.impact ?? 0))) {
      throw new RangeError('pending physics measurements overflowed');
    }
    if (facts.climbDistance) this.pendingClimbDistance += facts.climbDistance;
    if (facts.impact) this.pendingImpact += facts.impact;
    for (const key of ['jump', 'bleat', 'flop', 'flingTongue'] as const) {
      if (intent[key]) this.pendingPulses[key] = true;
    }
    this.remainder = Math.max(0, total - ticks * TUNING.fixedDt);
    if (this.remainder < 1e-10) this.remainder = 0;
    const commands: AbilityCommands[] = [];
    const climbPerTick = ticks ? this.pendingClimbDistance / ticks : 0;
    const impact = this.pendingImpact;
    const pulses = { ...this.pendingPulses };
    if (ticks) {
      this.pendingClimbDistance = 0;
      this.pendingImpact = 0;
      this.pendingPulses = { jump: false, bleat: false, flop: false, flingTongue: false };
    }
    for (let i = 0; i < ticks; i++) {
      this.style.update(TUNING.fixedDt);
      const tickIntent = i === 0 ? { ...intent,
        jump: Boolean(intent.jump || pulses.jump),
        bleat: Boolean(intent.bleat || pulses.bleat),
        flop: Boolean(intent.flop || pulses.flop),
        flingTongue: Boolean(intent.flingTongue || pulses.flingTongue),
      } : intent;
      const command = this.abilities.update(TUNING.fixedDt, tickIntent, { ...facts, size: this.style.tier,
        // Impact is an impulse/event, not repeated across catch-up substeps.
        impact: i === 0 ? impact : 0,
        climbDistance: climbPerTick,
      }, {
        glideUnlocked: this.unlocks.isUnlocked('glide'),
        wallChalkUnlocked: this.unlocks.isUnlocked('wall-chalk'),
        aerialHornsUnlocked: this.unlocks.isUnlocked('aerial-horns'),
      });
      if (command.setClimb && climbPerTick > 0) this.recordClimb(climbPerTick);
      commands.push(command);
      this.tickCount++;
    }
    return { ticks, commands, alpha: this.remainder / TUNING.fixedDt };
  }

  toJSON(): GameSnapshot {
    return {
      version: 1, tick: this.tickCount, remainder: this.remainder,
      pendingClimbDistance: this.pendingClimbDistance,
      pendingImpact: this.pendingImpact, pendingPulses: { ...this.pendingPulses },
      rng: this.rng.toJSON(), abilities: this.abilities.toJSON(), style: this.style.toJSON(),
      inventory: this.inventory.toJSON(), build: this.build.toJSON(), wallet: this.wallet.toJSON(),
      unlocks: this.unlocks.toJSON(), challenges: this.challenges.toJSON(),
    };
  }

  /** Reconstruct every component without emitting gameplay events or using Math.random. */
  static fromJSON(raw: unknown): GameSimulation {
    const obj = requireRecord(raw, 'simulation snapshot');
    if (obj.version !== 1) throw new RangeError('unsupported gameplay snapshot version');
    const tick = requireNumber(obj.tick, 'tick'); integer(tick, 'tick');
    const remainder = requireNumber(obj.remainder, 'remainder');
    const pending = requireNumber(obj.pendingClimbDistance, 'pendingClimbDistance');
    nonNegative(pending, 'pendingClimbDistance');
    const impact = requireNumber(obj.pendingImpact, 'pendingImpact');
    nonNegative(impact, 'pendingImpact');
    const pendingPulses = requireRecord(obj.pendingPulses, 'pendingPulses');
    for (const key of ['jump', 'bleat', 'flop', 'flingTongue']) {
      if (typeof pendingPulses[key] !== 'boolean') throw new TypeError(`invalid pending pulse ${key}`);
    }
    if (remainder < 0 || remainder >= TUNING.fixedDt) throw new RangeError('invalid frame remainder');
    const restored = new GameSimulation(1);
    restored.events.clear();
    restored.rng = SeededRng.fromJSON(obj.rng);
    restored.abilities = GoatAbilities.fromJSON(obj.abilities, restored.events);
    restored.style = StyleSystem.fromJSON(obj.style, restored.events);
    restored.inventory = Inventory.fromJSON(obj.inventory, restored.events);
    restored.build = HayBuild.fromJSON(obj.build, restored.inventory, restored.events);
    restored.wallet = CudWallet.fromJSON(obj.wallet, restored.events);
    restored.unlocks = UnlockRegistry.fromJSON(obj.unlocks, restored.wallet, restored.events);
    restored.challenges = ChallengeTracker.fromJSON(obj.challenges, restored.wallet, restored.events);
    restored.tickCount = tick;
    restored.remainder = remainder;
    restored.pendingClimbDistance = pending;
    restored.pendingImpact = impact;
    restored.pendingPulses = {
      jump: pendingPulses.jump as boolean, bleat: pendingPulses.bleat as boolean,
      flop: pendingPulses.flop as boolean, flingTongue: pendingPulses.flingTongue as boolean,
    };
    return restored;
  }
}
