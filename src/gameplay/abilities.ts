import { TUNING } from './config';
import type { SizeTier } from './config';
import { EventBus } from './events';
import { clamp, copyJSON, nonNegative, requireBoolean, requireNumber, requireRecord, requireString } from './math';

/** Level-triggered input; short actions fire on their rising edge. */
export interface GoatIntent {
  sprint?: boolean; climb?: boolean; chargeHeadbutt?: boolean;
  tongue?: boolean; reelTongue?: boolean; flingTongue?: boolean;
  bleat?: boolean; flop?: boolean; jump?: boolean; glide?: boolean;
}

/** Observations from a physics engine, never Rapier types. Distances are in metres. */
export interface GoatPhysicsFacts {
  grounded: boolean; airborneTime: number; touchingSteepWall: boolean;
  /** The physics controller can still consume the ordinary jump after losing support. */
  canCoyoteJump?: boolean;
  /** There is not enough time before landing for a safe air flip. */
  landingSoon?: boolean;
  speed: number; size: SizeTier; tongueTarget?: string | null;
  impact?: number; climbDistance?: number; climbEffort?: number;
}

export const NEUTRAL_FACTS: Readonly<GoatPhysicsFacts> = Object.freeze({
  grounded: true, airborneTime: 0, touchingSteepWall: false, speed: 0, size: 'Billy',
});

export type HeadbuttLevel = 'tap' | 'ram' | 'meteor';
export type TongueCommand =
  | { action: 'attach'; targetId: string }
  | { action: 'hold'; targetId: string }
  | { action: 'reel'; targetId: string; speed: number }
  | { action: 'fling'; targetId: string; impulse: number }
  | { action: 'detach'; targetId: string };

export interface AbilityCommands {
  setSprint: boolean;
  setClimb: boolean;
  setGlide: boolean;
  modifiers: (typeof TUNING.size)[SizeTier];
  headbutt?: { level: HeadbuttLevel; charge: number; impulse: number };
  tongue?: TongueCommand;
  bleat?: { radius: number; impulse: number };
  ragdoll?: { cause: 'flop'; minSeconds: number };
  jump?: { kind: 'jump' | 'buffered-jump' | 'flip' | 'wall-kick' };
}

export interface AbilitiesSnapshot {
  stamina: number; balance: number; knockedDown: boolean; recoverWait: number; balanceRegenWait: number;
  regenWait: number; flopCooldown: number; charge: number; charging: boolean;
  headbuttCooldown: number; tongueTarget: string | null; tongueCooldown: number;
  bleatCooldown: number; bleatTimes: number[];
  clock: number; flippedThisAir: boolean; airPressAt?: number;
  previous: { jump: boolean; bleat: boolean; flop: boolean; flingTongue: boolean };
}

function initial(): AbilitiesSnapshot {
  return {
    stamina: TUNING.stamina.max, balance: TUNING.balance.max,
    knockedDown: false, recoverWait: 0, balanceRegenWait: 0, regenWait: 0, flopCooldown: 0,
    charge: 0, charging: false, headbuttCooldown: 0, tongueTarget: null,
    tongueCooldown: 0, bleatCooldown: 0, bleatTimes: [],
    clock: 0, flippedThisAir: false,
    previous: { jump: false, bleat: false, flop: false, flingTongue: false },
  };
}

function checkFacts(facts: GoatPhysicsFacts): void {
  if (typeof facts.grounded !== 'boolean' || typeof facts.touchingSteepWall !== 'boolean') {
    throw new TypeError('grounded and touchingSteepWall must be booleans');
  }
  if (facts.canCoyoteJump !== undefined) requireBoolean(facts.canCoyoteJump, 'canCoyoteJump');
  if (facts.landingSoon !== undefined) requireBoolean(facts.landingSoon, 'landingSoon');
  nonNegative(facts.speed, 'speed'); nonNegative(facts.airborneTime, 'airborneTime');
  if (!(facts.size in TUNING.size)) throw new RangeError('invalid size tier');
  if (facts.impact !== undefined) nonNegative(facts.impact, 'impact');
  if (facts.climbDistance !== undefined) nonNegative(facts.climbDistance, 'climbDistance');
  if (facts.tongueTarget != null && (typeof facts.tongueTarget !== 'string' || !facts.tongueTarget.length)) {
    throw new TypeError('tongueTarget must be a nonempty ID');
  }
}

/** Deterministic goat state machine; returns intents for the physics adapter to apply. */
export class GoatAbilities {
  private state: AbilitiesSnapshot = initial();
  constructor(private readonly bus: EventBus) {}

  get stamina(): number { return this.state.stamina; }
  get balance(): number { return this.state.balance; }
  get knockedDown(): boolean { return this.state.knockedDown; }
  get headbuttCharge(): number { return this.state.charge; }
  get tongueTarget(): string | null { return this.state.tongueTarget; }

  /** Reset interrupted actions while retaining stamina and ability cooldowns. */
  resetForRespawn(held: GoatIntent): void {
    const s = this.state;
    const wasKnockedDown = s.knockedDown;
    s.balance = TUNING.balance.max;
    s.knockedDown = false;
    s.recoverWait = 0;
    s.balanceRegenWait = 0;
    s.charge = 0;
    s.charging = false;
    s.tongueTarget = null;
    s.flippedThisAir = false;
    delete s.airPressAt;
    s.previous = { jump: Boolean(held.jump), bleat: Boolean(held.bleat),
      flop: Boolean(held.flop), flingTongue: Boolean(held.flingTongue) };
    if (wasKnockedDown) this.bus.emit('balance:recovered', { balance: s.balance });
  }

  applyImpact(damage: number): void {
    nonNegative(damage, 'impact');
    const s = this.state;
    s.balance = clamp(s.balance - damage, 0, TUNING.balance.max);
    if (damage) s.balanceRegenWait = TUNING.balance.regenDelay;
    if (!s.knockedDown && s.balance <= TUNING.balance.knockdownAt) this.knockDown('impact');
  }

  private knockDown(reason: 'impact' | 'flop'): void {
    const s = this.state;
    s.knockedDown = true;
    s.recoverWait = TUNING.balance.recoverDelay;
    s.balanceRegenWait = TUNING.balance.regenDelay;
    s.charging = false; s.charge = 0;
    this.bus.emit('balance:knockdown', { reason });
  }

  update(dt: number, intent: GoatIntent, facts: GoatPhysicsFacts, options: { glideUnlocked?: boolean; wallChalkUnlocked?: boolean; aerialHornsUnlocked?: boolean } = {}): AbilityCommands {
    nonNegative(dt, 'dt');
    if (dt === 0) throw new RangeError('ability tick duration must be positive');
    checkFacts(facts);
    const s = this.state;
    const c = TUNING;
    const mods = c.size[facts.size];
    const commands: AbilityCommands = { setSprint: false, setClimb: false, setGlide: false, modifiers: mods };
    s.clock += dt;
    s.regenWait = Math.max(0, s.regenWait - dt);
    s.balanceRegenWait = Math.max(0, s.balanceRegenWait - dt);
    s.flopCooldown = Math.max(0, s.flopCooldown - dt);
    s.headbuttCooldown = Math.max(0, s.headbuttCooldown - dt);
    s.tongueCooldown = Math.max(0, s.tongueCooldown - dt);
    s.bleatCooldown = Math.max(0, s.bleatCooldown - dt);
    if (facts.impact) this.applyImpact(facts.impact);

    const pressed = {
      jump: Boolean(intent.jump), bleat: Boolean(intent.bleat),
      flop: Boolean(intent.flop), flingTongue: Boolean(intent.flingTongue),
    };
    const rising = {
      jump: pressed.jump && !s.previous.jump,
      bleat: pressed.bleat && !s.previous.bleat,
      flop: pressed.flop && !s.previous.flop,
      flingTongue: pressed.flingTongue && !s.previous.flingTongue,
    };
    s.previous = pressed;
    if (facts.grounded) {
      s.flippedThisAir = false;
      delete s.airPressAt;
    }

    if (rising.flop && !s.knockedDown && s.flopCooldown <= 0) {
      s.balance = 0;
      this.knockDown('flop');
      s.flopCooldown = c.balance.flopCooldown;
      commands.ragdoll = { cause: 'flop', minSeconds: c.balance.recoverDelay };
      this.bus.emit('ability:used', { name: 'flop' });
    }
    if (s.knockedDown) {
      delete s.airPressAt;
      s.recoverWait = Math.max(0, s.recoverWait - dt);
      if (s.recoverWait <= 0) {
        s.balance = clamp(s.balance + c.balance.recoverPerSecond * dt, 0, c.balance.max);
        if (s.balance >= c.balance.recoveryToStand) {
          s.knockedDown = false;
          this.bus.emit('balance:recovered', { balance: s.balance });
        }
      }
      if (s.tongueTarget) {
        commands.tongue = { action: 'detach', targetId: s.tongueTarget };
        s.tongueTarget = null;
        s.tongueCooldown = c.tongue.cooldown;
      }
      return commands;
    }

    if (s.balanceRegenWait <= 0) {
      s.balance = Math.min(c.balance.max, s.balance + c.balance.regenPerSecond * dt);
    }
    const canStart = s.stamina >= c.stamina.minStart;
    const climbing = Boolean(intent.climb) && facts.touchingSteepWall && !facts.grounded &&
      mods.canClimb && s.stamina > 0 && (canStart || s.regenWait > 0);
    const sprinting = Boolean(intent.sprint) && facts.grounded && !climbing && s.stamina > 0 &&
      (canStart || s.regenWait > 0);
    let drainRate = 0;
    if (climbing) {
      const effort = clamp(facts.climbEffort ?? 1, 0, 1);
      drainRate += c.stamina.climbDrain * (.35 + .65 * effort) *
        (options.wallChalkUnlocked ? c.progression.wallChalkDrainFactor : 1);
    }
    if (sprinting) drainRate += c.stamina.sprintDrain;
    commands.setClimb = climbing;
    commands.setSprint = sprinting;

    if (climbing || !options.glideUnlocked) delete s.airPressAt;
    if (rising.jump && intent.glide && options.glideUnlocked && !climbing &&
        !facts.grounded && !facts.canCoyoteJump && !facts.landingSoon && !s.flippedThisAir) s.airPressAt = s.clock;
    // A second tap flips on release. Holding the same button opens the sail.
    const tap = s.airPressAt !== undefined && !pressed.jump && s.clock - s.airPressAt < c.glide.holdSeconds;
    if (s.airPressAt !== undefined && (!pressed.jump || s.clock - s.airPressAt >= c.glide.holdSeconds)) {
      delete s.airPressAt;
    }
    if (rising.jump || tap) {
      if (climbing) {
        commands.jump = { kind: 'wall-kick' };
        commands.setClimb = false;
        this.bus.emit('ability:used', { name: 'wall-kick' });
      } else if (facts.grounded || facts.canCoyoteJump) {
        commands.jump = { kind: 'jump' };
      } else if (facts.landingSoon) {
        delete s.airPressAt;
        commands.jump = { kind: 'buffered-jump' };
      } else if (facts.airborneTime >= 0.12 && !s.flippedThisAir && s.airPressAt === undefined) {
        s.flippedThisAir = true;
        commands.jump = { kind: 'flip' };
        this.bus.emit('ability:used', { name: 'flip' });
      }
    }
    commands.setGlide = Boolean(intent.glide) && Boolean(options.glideUnlocked) &&
      !facts.grounded && facts.airborneTime >= c.glide.minAirTime && !climbing && s.airPressAt === undefined;

    // Headbutts are charged while held, fired once on release or exhaustion.
    const holdingCharge = Boolean(intent.chargeHeadbutt);
    if (holdingCharge && s.headbuttCooldown <= 0 && s.stamina > 0 && (canStart || s.charging)) {
      s.charging = true;
      s.charge = Math.min(c.headbutt.maxCharge, s.charge + dt);
      drainRate += c.stamina.chargeDrain * (options.aerialHornsUnlocked && !facts.grounded ?
        c.progression.aerialHornsChargeDrainFactor : 1);
    } else if (s.charging) {
      if (s.charge >= c.headbutt.minCharge && s.headbuttCooldown <= 0) {
        const level: HeadbuttLevel = s.charge >= c.headbutt.level3 ? 'meteor' :
          s.charge >= c.headbutt.level2 ? 'ram' : 'tap';
        const momentum = 1 + Math.min(c.headbutt.maxSpeedBonus, facts.speed * c.headbutt.speedBonusPerMps);
        const power = c.headbutt.baseImpulse * (0.45 + s.charge / c.headbutt.maxCharge) * mods.impulse * momentum *
          (options.aerialHornsUnlocked && !facts.grounded ? c.progression.aerialHornsImpulseFactor : 1);
        commands.headbutt = { level, charge: s.charge, impulse: power };
        s.headbuttCooldown = c.headbutt.cooldown;
        this.bus.emit('ability:used', { name: 'headbutt', power });
      }
      s.charging = false; s.charge = 0;
    }

    if (s.tongueTarget) {
      const targetId = s.tongueTarget;
      if (!intent.tongue) {
        commands.tongue = { action: 'detach', targetId };
        s.tongueTarget = null;
        s.tongueCooldown = c.tongue.cooldown;
      } else if (rising.flingTongue) {
        commands.tongue = { action: 'fling', targetId, impulse: c.tongue.flingImpulse * mods.impulse };
        s.tongueTarget = null;
        s.tongueCooldown = c.tongue.flingCooldown;
        this.bus.emit('ability:used', { name: 'tongue-fling' });
      } else if (intent.reelTongue) {
        commands.tongue = { action: 'reel', targetId, speed: c.tongue.reelSpeed * mods.speed };
      } else commands.tongue = { action: 'hold', targetId };
    } else if (intent.tongue && facts.tongueTarget && s.tongueCooldown <= 0) {
      s.tongueTarget = facts.tongueTarget;
      commands.tongue = { action: 'attach', targetId: facts.tongueTarget };
      this.bus.emit('ability:used', { name: 'tongue-attach' });
    }

    s.bleatTimes = s.bleatTimes.filter(time => s.clock - time < c.bleat.spamWindow);
    if (rising.bleat && s.bleatCooldown <= 0 && s.bleatTimes.length < c.bleat.maxBleatsPerWindow) {
      s.bleatTimes.push(s.clock);
      s.bleatCooldown = c.bleat.cooldown;
      commands.bleat = { radius: c.bleat.radius * mods.reach, impulse: c.bleat.impulse * mods.impulse };
      this.bus.emit('ability:used', { name: 'bleat' });
    }
    if (drainRate > 0) {
      s.stamina = Math.max(0, s.stamina - drainRate * dt);
      s.regenWait = c.stamina.regenDelay;
      if (s.stamina === 0) { commands.setClimb = false; commands.setSprint = false; }
    } else if (s.regenWait <= 0) s.stamina = Math.min(c.stamina.max, s.stamina + c.stamina.regen * dt);
    return commands;
  }

  toJSON(): AbilitiesSnapshot { return copyJSON(this.state); }
  static fromJSON(raw: unknown, bus: EventBus): GoatAbilities {
    const obj = requireRecord(raw, 'abilities');
    const next = initial();
    const numeric: (keyof AbilitiesSnapshot)[] = [
      'stamina', 'balance', 'recoverWait', 'balanceRegenWait', 'regenWait', 'flopCooldown', 'charge',
      'headbuttCooldown', 'tongueCooldown', 'bleatCooldown', 'clock',
    ];
    for (const key of numeric) (next as unknown as Record<string, unknown>)[key] = requireNumber(obj[key], `abilities.${key}`);
    for (const key of ['knockedDown', 'charging', 'flippedThisAir'] as const) next[key] = requireBoolean(obj[key], `abilities.${key}`);
    if (obj.airPressAt !== undefined) {
      next.airPressAt = requireNumber(obj.airPressAt, 'abilities.airPressAt');
      if (next.airPressAt < 0 || next.airPressAt > next.clock) throw new RangeError('invalid air press time');
    }
    if (obj.tongueTarget !== null) next.tongueTarget = requireString(obj.tongueTarget, 'abilities.tongueTarget');
    if (!Array.isArray(obj.bleatTimes) || obj.bleatTimes.length > TUNING.bleat.maxBleatsPerWindow) {
      throw new RangeError('invalid bleat history');
    }
    next.bleatTimes = obj.bleatTimes.map((value: unknown) => requireNumber(value, 'bleat time'));
    if (next.bleatTimes.some((time, i) => time < 0 || time > next.clock ||
      (i > 0 && time < next.bleatTimes[i - 1]!))) throw new RangeError('invalid bleat timestamps');
    const prev = requireRecord(obj.previous, 'abilities.previous');
    for (const key of ['jump', 'bleat', 'flop', 'flingTongue'] as const) next.previous[key] = requireBoolean(prev[key], `previous.${key}`);
    if (next.stamina < 0 || next.stamina > TUNING.stamina.max || next.balance < 0 || next.balance > TUNING.balance.max ||
      next.recoverWait < 0 || next.balanceRegenWait < 0 || next.regenWait < 0 || next.clock < 0 || next.charge < 0 || next.charge > TUNING.headbutt.maxCharge) {
      throw new RangeError('invalid ability state ranges');
    }
    const abilities = new GoatAbilities(bus);
    abilities.state = next;
    return abilities;
  }
}
