import { describe, expect, it } from 'vitest';
import { PartyMatch } from './match';
import { makeMockIsland } from './mock-island';
import { frame, goat, readyMatch } from './test-utils';

const quick = { tideRiseEveryTicks: 4, tideWarningTicks: 2,
  submergeTicks: 2, knockoutWindowTicks: 2, durationTicks: 80, overtimeTicks: 4 };

describe('RISING TIDE — Last Goat Standing', () => {
  it('announces the upcoming step before flooding, with real dry-area facts', () => {
    const match = readyMatch({ mode: 'rising-tide', config: quick });
    expect(match.tideLevel).toBe(0);
    expect(match.step(frame(goat('a'), goat('b')))).not.toContainEqual(
      expect.objectContaining({ type: 'tide.warning' }));
    const warn = match.step(frame(goat('a'), goat('b')));
    expect(warn).toContainEqual(expect.objectContaining({
      type: 'tide.warning', level: 3, ticksUntilRise: 2,
      dryArea: makeMockIsland().dryAreaAtTideLevel(3),
    }));
    match.step(frame(goat('a'), goat('b')));
    const rise = match.step(frame(goat('a'), goat('b')));
    expect(match.tideLevel).toBe(3);
    expect(rise).toContainEqual(expect.objectContaining({ type: 'tide.rose', level: 3 }));
    expect(rise).not.toContainEqual(expect.objectContaining({ type: 'tide.warning' }));
  });

  it('requires continuous head submersion and resets the counter after escape', () => {
    const match = readyMatch({ mode: 'rising-tide', config: quick });
    match.step(frame(goat('a', 0, 0, -1), goat('b')));
    match.step(frame(goat('a', 0, 0, 2), goat('b')));
    expect(match.players.find(p => p.id === 'a')!.submergedTicks).toBe(0);
    match.step(frame(goat('a', 0, 0, -1), goat('b')));
    expect(match.phase).toBe('playing');
    const events = match.step(frame(goat('a', 0, 0, -1), goat('b')));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'goat.eliminated', playerId: 'a', creditedTo: null,
    }));
    expect(match.phase).toBe('results');
    expect(match.placements.map(p => [p.playerId, p.rank, p.placementPoints]))
      .toEqual([['b', 1, 100], ['a', 2, 65]]);
  });

  it('credits a last shover exactly at the credit-window boundary', () => {
    const match = readyMatch({ mode: 'rising-tide', config: quick });
    match.step({ ...frame(goat('a'), goat('b')), contacts: [{ attackerId: 'a', victimId: 'b' }] });
    match.step(frame(goat('a'), goat('b', 0, 0, -1)));
    const events = match.step(frame(goat('a'), goat('b', 0, 0, -1)));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'goat.knockout', attackerId: 'a', victimId: 'b',
    }));
    expect(match.players.find(p => p.id === 'a')!.knockouts).toBe(1);
  });

  it('expires credit after the window without manufacturing a knockout', () => {
    const match = readyMatch({ mode: 'rising-tide', config: quick });
    match.step({ ...frame(goat('a'), goat('b')), contacts: [{ attackerId: 'a', victimId: 'b' }] });
    match.step(frame(goat('a'), goat('b')));
    match.step(frame(goat('a'), goat('b')));
    match.step(frame(goat('a'), goat('b', 0, 0, -1)));
    const events = match.step(frame(goat('a'), goat('b', 0, 0, -1)));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'goat.eliminated', creditedTo: null,
    }));
    expect(match.players.find(p => p.id === 'a')!.knockouts).toBe(0);
  });

  it('eliminates everyone on one tick as a joint first, not an invented winner', () => {
    const match = readyMatch({ mode: 'rising-tide', config: quick });
    match.step(frame(goat('a', 0, 0, -1), goat('b', 0, 0, -1)));
    const events = match.step(frame(goat('a', 0, 0, -1), goat('b', 0, 0, -1)));
    expect(events.filter(e => e.type === 'goat.eliminated')).toHaveLength(2);
    expect(events.filter(e => e.type === 'match.finished')).toHaveLength(1);
    expect(match.placements.map(p => p.rank)).toEqual([1, 1]);
    expect(match.placements.map(p => p.placementPoints)).toEqual([83, 83]);
  });

  it('shares rank for simultaneous runners-up and skips occupied ranks', () => {
    const match = readyMatch({ mode: 'rising-tide', config: { ...quick, submergeTicks: 1 } },
      ['a', 'b', 'c']);
    match.step(frame(goat('a', 0, 0, -1), goat('b'), goat('c')));
    match.step(frame(goat('a'), goat('b', 0, 0, -1), goat('c', 0, 0, -1)));
    expect(match.placements.map(p => [p.playerId, p.rank])).toEqual([
      ['b', 1], ['c', 1], ['a', 3],
    ]);
  });

  it('arbitrates same-tick contacts regardless of callback arrival order', () => {
    const contacts = [
      { attackerId: 'a', victimId: 'c' },
      { attackerId: 'b', victimId: 'c' },
    ];
    const run = (reversed: boolean) => {
      const match = readyMatch({ mode: 'rising-tide',
        config: { ...quick, submergeTicks: 1 } }, ['a', 'b', 'c']);
      match.step({ ...frame(goat('a'), goat('b'), goat('c', 0, 0, -1)),
        contacts: reversed ? [...contacts].reverse() : contacts });
      return match.toJSON();
    };
    expect(run(false)).toEqual(run(true));
    const snap = run(false);
    expect(snap.players.find(p => p.id === 'b')!.knockouts).toBe(1);
    expect(snap.players.find(p => p.id === 'a')!.knockouts).toBe(0);
  });

  it('at the final tide enters overtime; highest surviving perch wins at cap', () => {
    const arena = { ...makeMockIsland(), tideLevels: [0, 1] };
    const match = new PartyMatch({ mode: 'rising-tide',
      config: { countdownTicks: 0, tideRiseEveryTicks: 2, tideWarningTicks: 1,
        submergeTicks: 3, overtimeTicks: 3 } }, arena);
    for (const id of ['a', 'b']) { match.join({ id, name: id }); match.setReady(id, true); }
    match.start();
    match.step(frame(goat('a', 0, 0, 8), goat('b', 0, 0, 9)));
    const lastRise = match.step(frame(goat('a', 0, 0, 8), goat('b', 0, 0, 9)));
    expect(lastRise).toContainEqual(expect.objectContaining({ type: 'phase.changed', to: 'overtime' }));
    expect(match.tideLevel).toBe(1);
    for (let i = 0; i < 3; i++) match.step(frame(goat('a', 0, 0, 8), goat('b', 0, 0, 9)));
    expect(match.phase).toBe('results');
    expect(match.placements[0]).toEqual(expect.objectContaining({ playerId: 'b', rank: 1 }));
    expect(match.placements[1]).toEqual(expect.objectContaining({ playerId: 'a', rank: 2 }));
  });

  it('ends overtime immediately on last-goat-standing, before the cap', () => {
    const arena = { ...makeMockIsland(), tideLevels: [0, 1] };
    const match = new PartyMatch({ mode: 'rising-tide',
      config: { countdownTicks: 0, tideRiseEveryTicks: 1, tideWarningTicks: 0,
        submergeTicks: 1, overtimeTicks: 80 } }, arena);
    for (const id of ['a', 'b']) { match.join({ id, name: id }); match.setReady(id, true); }
    match.start();
    match.step(frame(goat('a'), goat('b')));
    expect(match.phase).toBe('overtime');
    const event = match.step(frame(goat('a'), goat('b', 0, 0, -2)));
    expect(event.some(e => e.type === 'match.finished')).toBe(true);
    expect(match.tick).toBe(2);
  });
});
