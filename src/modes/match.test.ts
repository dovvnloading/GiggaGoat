import { describe, expect, it } from 'vitest';
import { PartyMatch } from './match';
import { makeMockIsland } from './mock-island';
import type { MatchEvent } from './types';
import { goat, readyMatch, frame } from './test-utils';


describe('PartyMatch lifecycle, serialisation and event delivery', () => {
  it('rejects duplicate players, late joining and unready or undersized lobbies', () => {
    const match = new PartyMatch({ mode: 'king-of-the-peak' }, makeMockIsland());
    match.join({ id: 'a', name: 'A' });
    expect(() => match.join({ id: 'a', name: 'copy' })).toThrow();
    expect(() => match.start()).toThrow();
    match.setReady('a', true);
    expect(() => match.start()).toThrow();
    match.join({ id: 'b', name: 'B' });
    expect(() => match.start()).toThrow();
    match.setReady('b', true);
    match.start();
    expect(match.phase).toBe('countdown');
    expect(() => match.join({ id: 'late', name: 'Late' })).toThrow();
  });

  it('counts down on exact ticks, reporting changes and ignoring premature physics', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', config: { countdownTicks: 61 } });
    expect(match.phase).toBe('countdown');
    for (let i = 0; i < 60; i++) match.step();
    expect(match.phase).toBe('countdown');
    expect(match.tick).toBe(60);
    const events = match.step();
    expect(events).toContainEqual(expect.objectContaining({ type: 'phase.changed', to: 'playing', tick: 61 }));
    expect(match.phase).toBe('playing');
    expect(match.toJSON().playTicks).toBe(0);
    match.step(frame(goat('a', 70, 0), goat('b', -70, 0)));
    expect(match.toJSON().playTicks).toBe(1);
  });

  it('enforces strict inputs and validates tide schedule and configuration', () => {
    const arena = makeMockIsland();
    expect(() => new PartyMatch({ mode: 'rising-tide' }, { ...arena, tideLevels: [3, 2] })).toThrow();
    expect(() => new PartyMatch({ mode: 'rising-tide', config: {
      tideRiseEveryTicks: 4, tideWarningTicks: 5,
    } }, arena)).toThrow();
    expect(() => new PartyMatch({ mode: 'king-of-the-peak', config: { durationTicks: 0 } }, arena)).toThrow();
    const match = readyMatch({ mode: 'king-of-the-peak' });
    const before = match.toJSON();
    expect(() => match.step(frame(goat('a')))).toThrow('missing observation');
    expect(() => match.step(frame(goat('a'), { ...goat('b'), headY: NaN }))).toThrow();
    expect(match.toJSON()).toEqual(before);
  });

  it('replays event sequences and score from a JSON round trip', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', seed: 123,
      config: { peakPointsPerSecond: 5, durationTicks: 150 } });
    const inside = frame(goat('a', 0, 0), goat('b', 35, 0));
    for (let i = 0; i < 65; i++) match.step(inside);
    const snapshot = JSON.parse(JSON.stringify(match.toJSON()));
    const restored = PartyMatch.fromJSON(snapshot, makeMockIsland());
    const originalEvents: MatchEvent[] = [];
    const restoredEvents: MatchEvent[] = [];
    for (let i = 0; i < 90; i++) {
      originalEvents.push(...match.step(inside));
      restoredEvents.push(...restored.step(inside));
    }
    expect(originalEvents).toEqual(restoredEvents);
    expect(restored.toJSON()).toEqual(match.toJSON());
  });

  it('returns defensive copies, bounded event history and unsubscribe support', () => {
    const match = readyMatch({ mode: 'king-of-the-peak' });
    let called = 0;
    const unsubscribe = match.onEvent(() => { called++; });
    for (let i = 0; i < 60; i++) match.step(frame(goat('a', 0, 0), goat('b', 50)));
    expect(called).toBeGreaterThan(0);
    unsubscribe();
    const count = called;
    for (let i = 0; i < 400; i++) {
      // Alternate control owners: generate an event every tick.
      match.step(frame(goat('a', i % 2 ? 0 : 45), goat('b', i % 2 ? 45 : 0)));
    }
    expect(called).toBe(count);
    expect(match.toJSON().pendingEvents.length).toBeLessThanOrEqual(256);
    const drained = match.drainEvents();
    expect(drained.length).toBeGreaterThan(0);
    expect(match.drainEvents()).toEqual([]);
    const players = match.players;
    players[0]!.score = 9999;
    expect(match.players[0]!.score).not.toBe(9999);
  });

  it('can restore a lobby then finish a match; results are frozen', () => {
    const match = new PartyMatch({ mode: 'king-of-the-peak',
      config: { countdownTicks: 0, durationTicks: 1, overtimeTicks: 1 } }, makeMockIsland());
    match.join({ id: 'a', name: 'A' });
    const restored = PartyMatch.fromJSON(match.toJSON(), makeMockIsland());
    restored.join({ id: 'b', name: 'B' });
    restored.setReady('a', true); restored.setReady('b', true); restored.start();
    restored.step(frame(goat('a', 0, 0), goat('b', 50, 0)));
    expect(restored.phase).toBe('overtime');
    restored.step(frame(goat('a', 0, 0), goat('b', 50, 0)));
    expect(restored.phase).toBe('results');
    const before = restored.toJSON();
    expect(restored.step(frame(goat('a'), goat('b'))).toEqual([]);
    expect(restored.toJSON()).toEqual(before);
    expect(restored.placements.map(p => p.rank)).toEqual([1, 1]);
  });
});
