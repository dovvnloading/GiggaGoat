import { describe, expect, it } from 'vitest';
import { StyleSystem, EventBus, TUNING } from './index';
import type { BuiltinTrick, SizeTier } from './index';
const c = TUNING.style;
const uniqueTricks: BuiltinTrick[] = [
  'flip', 'airtime', 'wall-climb', 'tongue-swing', 'knockback',
  'topple', 'destruction', 'near-miss', 'ragdoll-bounce', 'big-splash',
];
function maxCombo(system: StyleSystem): void {
  for (const type of uniqueTricks) system.ingest({ type, quality: 2 });
}

describe('StyleSystem combos and GIGGA growth', () => {
  it('scores variety, decays repetition and tracks exact named trick chains', () => {
    const s = new StyleSystem(new EventBus());
    const a = s.ingest({ type: 'flip' });
    const repeat = s.ingest({ type: 'flip' });
    const fresh = s.ingest({ type: 'knockback' });
    expect(repeat).toBeLessThan(a);
    expect(fresh).toBeGreaterThan(a);
    expect(s.combo.title).toBe('GOAT-ROCKET');
    expect(s.combo.count).toBe(3);
    const rocket = new StyleSystem(new EventBus());
    rocket.ingest({ type: 'flip' }); rocket.ingest({ type: 'knockback' });
    expect(rocket.combo.title).toBe('GOAT-ROCKET');
    const slingshot = new StyleSystem(new EventBus());
    slingshot.ingest({ type: 'tongue-swing' }); slingshot.ingest({ type: 'knockback' });
    expect(slingshot.combo.title).toBe('LICK-SLINGSHOT');
  });
  it('one-trick farming can never fill GIGGA, including across combo resets', () => {
    const s = new StyleSystem(new EventBus());
    for (let episode = 0; episode < 15; episode++) {
      for (let i = 0; i < 500; i++) s.ingest({ type: 'destruction', quality: 2 });
      expect(s.meter).toBe(0);
      s.update(c.comboWindow + 0.01);
    }
    expect(s.tier).toBe('Kid');
    expect(s.score).toBeGreaterThan(0);
  });
  it('requires 8+ events and 4+ distinct types AND a full meter for GIGGA', () => {
    const s = new StyleSystem(new EventBus());
    for (const trick of uniqueTricks.slice(0, c.giggaMinTricks - 1)) {
      s.ingest({ type: trick, quality: 2 });
      expect(s.tier).not.toBe('GIGGA');
    }
    s.ingest({ type: uniqueTricks[c.giggaMinTricks - 1]!, quality: 2 });
    expect(s.meter).toBe(100);
    expect(s.tier).toBe('GIGGA');
    expect(s.targetScale).toBe(3);
  });
  it('locks GIGGA behind distinct types even with sufficient trick count', () => {
    const s = new StyleSystem(new EventBus());
    for (let i = 0; i < 45; i++) {
      s.ingest({ type: i % 2 ? 'destruction' : 'big-splash', quality: 2 });
    }
    expect(s.tier).not.toBe('GIGGA');
  });
  it('expires a combo once, drains dead-combo GIGGA and hysteretically shrinks', () => {
    const bus = new EventBus(); const s = new StyleSystem(bus);
    const ends: number[] = []; const transitions: SizeTier[] = [];
    bus.on('combo:ended', e => ends.push(e.tricks));
    bus.on('size:changed', e => transitions.push(e.to));
    maxCombo(s);
    expect(s.tier).toBe('GIGGA');
    s.update(1);
    expect(s.meter).toBe(100);
    expect(s.scale).toBeGreaterThan(2.9);
    s.update(c.comboWindow - 1);
    expect(ends).toHaveLength(1);
    expect(s.tier).toBe('GIGGA');
    const afterExpiry = s.meter;
    s.update(5);
    expect(s.meter).toBeLessThan(afterExpiry);
    expect(s.tier).toBe('Big');
    expect(s.scale).toBeGreaterThanOrEqual(TUNING.size.Kid.scale);
    expect(s.scale).toBeLessThanOrEqual(TUNING.size.GIGGA.scale);
    expect(ends).toEqual([10]);
    expect(transitions).toContain('GIGGA');
    expect(transitions).toContain('Big');
  });
  it('emits canonical scored events for challenges and immune defensive combo views', () => {
    const bus = new EventBus(); const s = new StyleSystem(bus);
    const received: string[] = [];
    bus.on('style:scored', e => received.push(`${e.trick}:${e.comboCount}`));
    bus.emit('style:input', { type: 'near-miss' });
    s.ingest({ type: 'flip' });
    const leaked = s.combo;
    leaked.types.flip = 12345;
    leaked.recent.push('fake');
    expect(s.combo.types.flip).toBe(1);
    expect(s.combo.recent).toEqual(['near-miss', 'flip']);
    expect(received).toEqual(['near-miss:1', 'flip:2']);
  });
  it('accepts capped extensible tricks, rejects unbounded values and invalid deltas', () => {
    const s = new StyleSystem(new EventBus());
    expect(s.ingest({ type: 'custom', id: 'rail-grind', basePoints: 18 })).toBe(18);
    expect(() => s.ingest({ type: 'custom', id: '', basePoints: 3 })).toThrow();
    expect(() => s.ingest({ type: 'custom', id: 'hax', basePoints: 2_000 })).toThrow();
    expect(() => s.ingest({ type: 'flip', quality: Infinity })).toThrow();
    expect(() => s.ingest({ type: 'flip', quality: -1 })).toThrow();
    expect(() => s.update(NaN)).toThrow();
  });

  it('long update calls drain only the elapsed dead-combo time, not active-window time', () => {
    const a = new StyleSystem(new EventBus());
    const b = new StyleSystem(new EventBus());
    for (const system of [a, b]) {
      system.ingest({ type: 'flip' }); system.ingest({ type: 'destruction' });
    }
    a.update(7);
    for (let i = 0; i < 420; i++) b.update(1 / 60);
    expect(a.meter).toBeCloseTo(b.meter, 1);
    expect(a.combo.count).toBe(0);
  });
  it('snapshots round-trip active combo and easing with exact replay', () => {
    const bus = new EventBus(); const s = new StyleSystem(bus);
    for (const trick of uniqueTricks.slice(0, 6)) s.ingest({ type: trick });
    s.update(0.325);
    const restored = StyleSystem.fromJSON(JSON.parse(JSON.stringify(s.toJSON())) as unknown, new EventBus());
    expect(restored.toJSON()).toEqual(s.toJSON());
    const first = s.ingest({ type: 'topple', quality: 1.4 });
    const second = restored.ingest({ type: 'topple', quality: 1.4 });
    expect(second).toBe(first);
    s.update(3.9); restored.update(3.9);
    expect(restored.toJSON()).toEqual(s.toJSON());
    expect(() => StyleSystem.fromJSON({ ...s.toJSON(), meter: NaN }, new EventBus())).toThrow();
  });
});
