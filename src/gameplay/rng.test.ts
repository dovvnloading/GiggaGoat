import { describe, expect, it } from 'vitest';
import { SeededRng, EventBus } from './index';

describe('SeededRng', () => {
  it('has deterministic sequences independent of other streams', () => {
    const a = new SeededRng(123); const b = new SeededRng(123); const c = new SeededRng(124);
    const samples = Array.from({ length: 300 }, () => a.next());
    expect(samples).toEqual(Array.from({ length: 300 }, () => b.next()));
    expect(samples).not.toEqual(Array.from({ length: 300 }, () => c.next()));
    expect(samples.every(n => n >= 0 && n < 1)).toBe(true);
  });
  it('resumes the exact RNG sequence from a JSON snapshot', () => {
    const rng = new SeededRng(0);
    for (let i = 0; i < 31; i++) rng.next();
    const resumed = SeededRng.fromJSON(JSON.parse(JSON.stringify(rng.toJSON())) as unknown);
    expect(Array.from({ length: 100 }, () => rng.int(4, 12)))
      .toEqual(Array.from({ length: 100 }, () => resumed.int(4, 12)));
  });
  it('validates range and corrupt seed', () => {
    expect(() => new SeededRng(-1)).toThrow();
    expect(() => new SeededRng(2 ** 32)).toThrow();
    expect(() => new SeededRng(NaN)).toThrow();
    expect(() => new SeededRng(1).int(3, 3)).toThrow();
    expect(() => SeededRng.fromJSON({ state: 0 })).toThrow();
  });
});

describe('typed event bus', () => {
  it('emits synchronously in subscription order and unsubscribes safely', () => {
    const bus = new EventBus(); const events: string[] = [];
    let unsub = () => {};
    bus.on('style:input', () => { events.push('first'); unsub(); });
    unsub = bus.on('style:input', () => { events.push('second'); });
    bus.on('style:input', () => { events.push('third'); });
    bus.emit('style:input', { type: 'flip' });
    bus.emit('style:input', { type: 'flip' });
    expect(events).toEqual(['first', 'second', 'third', 'first', 'third']);
    bus.clear(); bus.emit('style:input', { type: 'flip' });
    expect(events).toHaveLength(5);
  });
});
