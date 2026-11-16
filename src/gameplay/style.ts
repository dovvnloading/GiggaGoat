import { TUNING } from './config';
import type { BuiltinTrick, SizeTier } from './config';
import { EventBus } from './events';
import { clamp, copyJSON, nonNegative, requireNumber, requireRecord, requireString } from './math';

export type StyleEvent = { type: BuiltinTrick; quality?: number } |
  { type: 'custom'; id: string; basePoints: number; quality?: number };

export interface ComboSnapshot {
  count: number; points: number; lastAt: number; types: Record<string, number>;
  recent: string[]; title: string;
}
export interface StyleSnapshot {
  score: number; meter: number; tier: SizeTier; scale: number; clock: number;
  combo: ComboSnapshot;
}
const initialCombo = (): ComboSnapshot => ({ count: 0, points: 0, lastAt: -1, types: {}, recent: [], title: '' });
const initialState = (): StyleSnapshot => ({ score: 0, meter: 0, tier: 'Kid', scale: 0.6, clock: 0, combo: initialCombo() });

/** Chaotic, but earned: variety builds the meter; repeated actions lose value. */
export class StyleSystem {
  private state = initialState();
  constructor(private readonly bus: EventBus) {
    this.bus.on('style:input', event => { this.ingest(event); });
  }
  get score(): number { return this.state.score; }
  get meter(): number { return this.state.meter; }
  get tier(): SizeTier { return this.state.tier; }
  get scale(): number { return this.state.scale; }
  get targetScale(): number { return TUNING.size[this.state.tier].scale; }
  get combo(): ComboSnapshot { return copyJSON(this.state.combo); }

  /** Id/quality are declarative; never trust client-supplied raw score or timestamps. */
  ingest(event: StyleEvent): number {
    const t = TUNING.style;
    const isCustom = event.type === 'custom';
    const key = isCustom ? `custom:${event.id}` : event.type;
    if (isCustom && (!event.id.trim() || event.id.length > t.customMaxIdLength)) throw new RangeError('custom trick ID is empty or too long');
    const base: number = isCustom ? event.basePoints : t.trickPoints[event.type];
    nonNegative(base, 'style base points');
    if (base > t.customMaxPoints || (isCustom && !Number.isInteger(base))) throw new RangeError('style base points out of range');
    const quality = event.quality ?? 1;
    nonNegative(quality, 'style quality');
    if (quality < t.qualityMin || quality > t.qualityMax) throw new RangeError('style quality out of range');
    this.endComboIfExpired();
    const s = this.state;
    const combo = s.combo;
    const timesAlreadyUsed = combo.types[key] ?? 0;
    combo.types[key] = timesAlreadyUsed + 1;
    combo.count++;
    combo.lastAt = s.clock;
    const distinct = Object.keys(combo.types).length;
    const variety = 1 + Math.min(t.varietyMaxBonus, (distinct - 1) * t.varietyPerNewType);
    const repeat = Math.pow(t.repeatFactor, timesAlreadyUsed);
    const multiplier = variety * repeat;
    const points = Math.round(base * quality * multiplier);
    combo.points = Math.min(Number.MAX_SAFE_INTEGER, combo.points + points);
    s.score = Math.min(Number.MAX_SAFE_INTEGER, s.score + points);
    combo.recent.push(key);
    if (combo.recent.length > 5) combo.recent.shift();
    combo.title = this.titleFor(combo);
    // A single-action farm earns score but NEVER any growth, even after a combo resets.
    if (distinct >= 2) s.meter = clamp(s.meter + points * t.pointsToMeter, 0, t.meterMax);
    this.refreshTier();
    this.bus.emit('style:scored', {
      trick: key, points, comboPoints: combo.points, comboCount: combo.count,
      distinct, multiplier, title: combo.title, meter: s.meter,
    });
    return points;
  }

  private titleFor(combo: ComboSnapshot): string {
    const recent = combo.recent;
    const pair = recent.slice(-2).join('>');
    if (pair === 'flip>knockback') return 'GOAT-ROCKET';
    if (pair === 'tongue-swing>knockback') return 'LICK-SLINGSHOT';
    if (pair === 'wall-climb>flip') return 'CLIFF-KICK';
    if (pair === 'ragdoll-bounce>big-splash') return 'BELLY-FLOP TSUNAMI';
    if (Object.keys(combo.types).length >= 5) return 'CHAOS CONDUCTOR';
    if (combo.count >= 4) return 'HOOF HURRICANE';
    if (combo.count >= 2) return 'TRICK CHAIN';
    return 'WARM-UP';
  }

  private endComboIfExpired(): void {
    const c = this.state.combo;
    if (c.count > 0 && this.state.clock - c.lastAt >= TUNING.style.comboWindow) {
      this.bus.emit('combo:ended', { points: c.points, tricks: c.count, title: c.title });
      this.state.combo = initialCombo();
    }
  }

  update(dt: number): void {
    nonNegative(dt, 'dt');
    // If a caller advances more than one tick, only the time AFTER the
    // combo window closes drains the meter (not the earlier active window).
    const combo = this.state.combo;
    const aliveFor = combo.count > 0 ? Math.max(0, TUNING.style.comboWindow - (this.state.clock - combo.lastAt)) : 0;
    this.state.clock += dt;
    this.endComboIfExpired();
    const idleSeconds = combo.count > 0 ? Math.max(0, dt - aliveFor) : dt;
    if (idleSeconds > 0) {
      const drain = this.state.tier === 'GIGGA' ? TUNING.style.giggaIdleDrain : TUNING.style.idleDrain;
      this.state.meter = Math.max(0, this.state.meter - idleSeconds * drain);
    }
    this.refreshTier();
    // Exponential response is frame-rate independent and cannot overshoot.
    const alpha = -Math.expm1(-TUNING.style.scaleEaseRate * dt);
    this.state.scale += (this.targetScale - this.state.scale) * alpha;
  }

  private refreshTier(): void {
    const s = this.state; const t = TUNING.style;
    let next: SizeTier = s.tier;
    const distinct = Object.keys(s.combo.types).length;
    if (s.tier === 'GIGGA') {
      if (s.meter < t.tierExit.GIGGA) next = 'Big';
    } else if (s.meter >= t.tierEnter.GIGGA &&
      s.combo.count >= t.giggaMinTricks && distinct >= t.giggaMinDistinct) next = 'GIGGA';
    else if (s.tier === 'Big') {
      if (s.meter < t.tierExit.Big) next = s.meter >= t.tierExit.Billy ? 'Billy' : 'Kid';
    } else if (s.meter >= t.tierEnter.Big) next = 'Big';
    else if (s.tier === 'Billy' && s.meter < t.tierExit.Billy) next = 'Kid';
    else if (s.tier === 'Kid' && s.meter >= t.tierEnter.Billy) next = 'Billy';
    if (next !== s.tier) {
      const from = s.tier;
      s.tier = next;
      this.bus.emit('size:changed', { from, to: next, targetScale: TUNING.size[next].scale });
    }
  }

  toJSON(): StyleSnapshot { return copyJSON(this.state); }
  static fromJSON(raw: unknown, bus: EventBus): StyleSystem {
    const o = requireRecord(raw, 'style'); const c = requireRecord(o.combo, 'style.combo');
    const types = requireRecord(c.types, 'style.combo.types');
    const combo = initialCombo();
    for (const [key, n] of Object.entries(types)) {
      const count = requireNumber(n, `style count ${key}`);
      if (!key || !Number.isSafeInteger(count) || count <= 0) throw new RangeError('invalid trick counter');
      Object.defineProperty(combo.types, key, { value: count, writable: true, enumerable: true, configurable: true });
    }
    combo.count = requireNumber(c.count, 'combo.count');
    combo.points = requireNumber(c.points, 'combo.points');
    combo.lastAt = requireNumber(c.lastAt, 'combo.lastAt');
    combo.title = requireString(c.title, 'combo.title');
    if (!Array.isArray(c.recent) || c.recent.length > 5) throw new TypeError('invalid combo recent');
    combo.recent = c.recent.map((item: unknown) => requireString(item, 'recent trick'));
    const tier = requireString(o.tier, 'style.tier');
    if (!(tier in TUNING.size)) throw new RangeError('invalid tier');
    const next: StyleSnapshot = {
      score: requireNumber(o.score, 'style.score'), meter: requireNumber(o.meter, 'style.meter'),
      tier: tier as SizeTier, scale: requireNumber(o.scale, 'style.scale'),
      clock: requireNumber(o.clock, 'style.clock'), combo,
    };
    if (next.score < 0 || !Number.isSafeInteger(next.score) || next.meter < 0 || next.meter > TUNING.style.meterMax ||
      next.clock < 0 || next.scale < TUNING.size.Kid.scale || next.scale > TUNING.size.GIGGA.scale ||
      combo.count < 0 || !Number.isSafeInteger(combo.count) || combo.points < 0 ||
      !Number.isSafeInteger(combo.points) || combo.lastAt > next.clock ||
      Object.values(combo.types).reduce((a, b) => a + b, 0) !== combo.count) {
      throw new RangeError('invalid style snapshot');
    }
    const system = new StyleSystem(bus);
    system.state = next;
    return system;
  }
}
