import { describe, expect, it } from 'vitest';
import { PartyMatch } from './match';
import { makeMockIsland } from './mock-island';
import { frame, goat, readyMatch } from './test-utils';

const separated = frame(goat('a', 0, 0), goat('b', 45, 0));

describe('KING OF THE PEAK — contested capture sprint', () => {
  it('freezes capture when two goats share the summit, then requires a full second', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', config: {
      peakPointsPerSecond: 3, durationTicks: 300 } });
    const contested: ReturnType<typeof match.step> = [];
    for (let i = 0; i < 60; i++) {
      contested.push(...match.step(frame(goat('a', 0, 0), goat('b', 0, 1))));
    }
    expect(contested.filter(e => e.type === 'peak.contested')).toHaveLength(1);
    expect(match.players.map(p => p.score)).toEqual([0, 0]);
    for (let i = 0; i < 59; i++) match.step(separated);
    expect(match.players[0]!.score).toBe(0);
    const last = match.step(separated);
    expect(last).toContainEqual(expect.objectContaining({
      type: 'peak.scored', playerId: 'a', points: 3, comeback: false,
    }));
  });

  it('resets partial capture progress when the summit is vacant', () => {
    const match = readyMatch({ mode: 'king-of-the-peak' });
    for (let i = 0; i < 30; i++) match.step(separated);
    match.step(frame(goat('a', 25, 0), goat('b', 45, 0)));
    for (let i = 0; i < 30; i++) match.step(separated);
    expect(match.players[0]!.score).toBe(0);
    for (let i = 0; i < 30; i++) match.step(separated);
    expect(match.players[0]!.score).toBe(3);
  });

  it('awards one predictable comeback point only when significantly behind', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', config: {
      peakComebackGap: 20, peakPointsPerSecond: 3 } });
    const snapshot = match.toJSON();
    snapshot.players.find(p => p.id === 'a')!.score = 35;
    const loaded = PartyMatch.fromJSON(snapshot, makeMockIsland());
    let events: ReturnType<typeof loaded.step> = [];
    for (let i = 0; i < 60; i++) events = loaded.step(frame(goat('a', 40), goat('b', 0, 0)));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'peak.scored', playerId: 'b', points: 4, comeback: true,
    }));
    expect(loaded.players.find(p => p.id === 'b')!.score).toBe(4);
    // As the gap closes, bonus is no longer granted.
    const snap2 = loaded.toJSON();
    snap2.players.find(p => p.id === 'b')!.score = 20;
    const close = PartyMatch.fromJSON(snap2, makeMockIsland());
    for (let i = 0; i < 60; i++) events = close.step(frame(goat('a', 40), goat('b', 0, 0)));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'peak.scored', points: 3, comeback: false,
    }));
  });

  it('never captures the zone through the rock face below the summit', () => {
    const match = readyMatch({ mode: 'king-of-the-peak' });
    for (let i = 0; i < 90; i++) match.step(frame(goat('a', 0, 0, 10), goat('b', 40, 0)));
    expect(match.players.map(p => p.score)).toEqual([0, 0]);
  });

  it('finishes exactly on the points target', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', config: {
      peakTargetScore: 2, peakPointsPerSecond: 2, durationTicks: 300 } });
    for (let i = 0; i < 59; i++) match.step(separated);
    expect(match.phase).toBe('playing');
    const events = match.step(separated);
    expect(match.phase).toBe('results');
    expect(events.filter(e => e.type === 'match.finished')).toHaveLength(1);
    expect(match.placements.map(p => p.rank)).toEqual([1, 2]);
  });

  it('uses golden-point overtime for a tied time limit', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', config: {
      durationTicks: 1, overtimeTicks: 62, peakTargetScore: 1000 } });
    match.step(frame(goat('a', 40, 0), goat('b', -40, 0)));
    expect(match.phase).toBe('overtime');
    for (let i = 0; i < 59; i++) match.step(separated);
    expect(match.phase).toBe('overtime');
    const golden = match.step(separated);
    expect(golden.some(e => e.type === 'match.finished')).toBe(true);
    expect(match.placements[0]!.playerId).toBe('a');
  });

  it('finishes tied if nobody owns the peak before the overtime cap', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', config: {
      durationTicks: 2, overtimeTicks: 3 } });
    for (let i = 0; i < 5; i++) match.step(frame(goat('a', 30), goat('b', -30)));
    expect(match.phase).toBe('results');
    expect(match.placements).toEqual([
      { playerId: 'a', score: 0, rank: 1, placementPoints: 83 },
      { playerId: 'b', score: 0, rank: 1, placementPoints: 83 },
    ]);
  });
});
