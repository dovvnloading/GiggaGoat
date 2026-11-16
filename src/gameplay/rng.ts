import { integer, requireNumber, requireRecord } from './math';

export interface RngSnapshot { state: number }

/** xorshift32: independent of Math.random and identical across browsers and Node. */
export class SeededRng {
  private state: number;
  constructor(seed: number) {
    integer(seed, 'seed');
    if (seed > 0xffffffff) throw new RangeError('seed must fit a uint32');
    this.state = seed === 0 ? 0x6d2b79f5 : seed >>> 0;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }
  int(minInclusive: number, maxExclusive: number): number {
    integer(minInclusive, 'min'); integer(maxExclusive, 'max');
    if (maxExclusive <= minInclusive || maxExclusive > 0x100000000) throw new RangeError('invalid integer range');
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }
  toJSON(): RngSnapshot { return { state: this.state }; }
  static fromJSON(raw: unknown): SeededRng {
    const state = requireNumber(requireRecord(raw, 'rng').state, 'rng.state');
    integer(state, 'rng.state');
    if (state === 0 || state > 0xffffffff) throw new RangeError('rng state must be nonzero uint32');
    return new SeededRng(state);
  }
}
