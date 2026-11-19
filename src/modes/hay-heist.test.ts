import { describe, expect, it } from 'vitest';
import { PartyMatch } from './match';
import { makeMockIsland } from './mock-island';
import { frame, goat } from './test-utils';
import type { GoatObservation, ModeArena } from './types';

function arena(): ModeArena {
  const base = makeMockIsland();
  return { ...base, barns: [
    { teamId: 'red', position: { x: -10, y: 15, z: 0 }, radius: 3 },
    { teamId: 'blue', position: { x: 10, y: 15, z: 0 }, radius: 3 },
  ] };
}
function heist(config: Partial<ConstructorParameters<typeof PartyMatch>[0]['config']> = {}): PartyMatch {
  const match = new PartyMatch({ mode: 'hay-heist', config: {
    countdownTicks: 0, durationTicks: 600, hayPerTeam: 1,
    hayTargetScore: 2, hayPickupRadius: 3, ...config,
  } }, arena());
  for (const [id, teamId] of [['a', 'red'], ['b', 'blue']]) {
    match.join({ id: id!, teamId: teamId!, name: id! });
    match.setReady(id!, true);
  }
  match.start();
  return match;
}
const red = (x: number, facingX = 1): GoatObservation => ({
  ...goat('a', x, 0, 16), facing: { x: facingX, z: 0 },
});
const blue = (x: number): GoatObservation => goat('b', x, 0, 16);

describe('HAY HEIST — barn scoring and cargo physics contracts', () => {
  it('steals ONLY enemy hay and scores it at the carrier team barn', () => {
    const match = heist();
    expect(match.bales.map(b => b.homeTeam)).toEqual(['blue', 'red']);
    const picked = match.step({ ...frame(red(10.9), blue(0)),
      intents: { a: { tongue: true } } });
    expect(picked).toContainEqual(expect.objectContaining({
      type: 'hay.picked', playerId: 'a', baleId: 'blue-hay-1',
    }));
    expect(match.getEffects('a')).toEqual(expect.objectContaining({
      carryingBaleId: 'blue-hay-1', speedMultiplier: 0.7, canSprint: false,
    }));
    const scored = match.step({ ...frame(red(-10), blue(0)),
      intents: { a: { tongue: true } } });
    expect(scored).toContainEqual(expect.objectContaining({
      type: 'hay.scored', teamId: 'red', playerId: 'a', score: 1,
    }));
    expect(match.view().teamScores).toEqual({ blue: 0, red: 1 });
    expect(match.players.find(p => p.id === 'a')!.score).toBe(1);
    expect(match.bales.find(b => b.id === 'blue-hay-1')!.carrierId).toBeNull();
  });

  it('returns distinct delivered bales to their original barn slots', () => {
    const match = heist({ hayPerTeam: 3, hayTargetScore: 5 });
    const blueStock = () => match.bales.filter(bale => bale.homeTeam === 'blue');
    const initial = blueStock().map(bale => bale.position);
    for (const [index, { x, z }] of initial.entries()) {
      const pick = { ...red(x), position: { x, y: 16, z } };
      expect(match.step({ ...frame(pick, blue(20)), intents: { a: { tongue: true } } }))
        .toContainEqual(expect.objectContaining({ type: 'hay.picked', baleId: 'blue-hay-' + (index + 1) }));
      expect(match.step({ ...frame(red(-10), blue(20)), intents: { a: { tongue: true } } }))
        .toContainEqual(expect.objectContaining({ type: 'hay.scored', teamId: 'red', score: index + 1 }));
    }
    expect(blueStock().map(bale => bale.position)).toEqual(initial);
    expect(blueStock().every(bale => bale.carrierId === null && bale.lastTouchedTeam === null)).toBe(true);
  });

  it('recovers stolen friendly hay without repeatedly picking it up at home', () => {
    const match = heist();
    const redHay = () => match.bales.find(b => b.id === 'red-hay-1')!;
    const holdTongue = { a: { tongue: true } };
    expect(match.step({ ...frame(red(-9.1), blue(20)), intents: holdTongue })
      .some(event => event.type === 'hay.picked')).toBe(false);

    match.step({ ...frame(red(-5.5), blue(-9.1)), intents: { b: { tongue: true } } });
    expect(redHay().carrierId).toBe('b');
    const intercepted = match.step({
      ...frame(red(-5.9), blue(-5.5)), headbutts: [{ attackerId: 'a', facing: { x: 1, z: 0 } }],
      intents: { a: { tongue: true }, b: { tongue: true } },
    });
    expect(intercepted).toContainEqual(expect.objectContaining({
      type: 'hay.dropped', playerId: 'b', reason: 'shoved',
    }));
    expect(intercepted).toContainEqual(expect.objectContaining({
      type: 'hay.picked', playerId: 'a', baleId: 'red-hay-1',
    }));

    for (let tick = 0; tick < 60; tick++) {
      const events = match.step({ ...frame(red(-9), blue(20)), intents: holdTongue });
      expect(events.some(event => event.type === 'hay.picked' || event.type === 'hay.scored')).toBe(false);
      expect(redHay()).toMatchObject({ carrierId: 'a', position: { x: -9 } });
    }

    expect(match.step(frame(red(-9), blue(20)))).toContainEqual(expect.objectContaining({
      type: 'hay.dropped', playerId: 'a', baleId: 'red-hay-1', reason: 'released',
    }));
    expect(redHay()).toMatchObject({ carrierId: null, lastTouchedTeam: null, position: { x: -10 } });
    for (let tick = 0; tick < 60; tick++) {
      const events = match.step({ ...frame(red(-9), blue(20)), intents: holdTongue });
      expect(events.some(event => event.type === 'hay.picked' || event.type === 'hay.scored')).toBe(false);
    }
    expect(match.view().teamScores).toEqual({ blue: 0, red: 0 });
    expect(match.step({ ...frame(red(-9), blue(-10)), intents: { ...holdTongue, b: { tongue: true } } }))
      .toContainEqual(expect.objectContaining({ type: 'hay.picked', playerId: 'b', baleId: 'red-hay-1' }));
  });

  it('drops cargo when tongue releases, and can punt enemy hay across a goal line', () => {
    const match = heist();
    match.step({ ...frame(red(10.9), blue(30)), intents: { a: { tongue: true } } });
    const released = match.step(frame(red(10.9), blue(30)));
    expect(released).toContainEqual(expect.objectContaining({
      type: 'hay.dropped', reason: 'released', playerId: 'a',
    }));
    expect(match.getEffects('a').speedMultiplier).toBe(1);

    const punt = heist({ hayKickDistance: 20, hayTargetScore: 1 });
    const events = punt.step({ ...frame(red(10.9, -1), blue(30)),
      headbutts: [{ attackerId: 'a', facing: { x: -1, z: 0 } }] });
    expect(events).toContainEqual(expect.objectContaining({ type: 'hay.punted', playerId: 'a' }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hay.scored', teamId: 'red', playerId: null,
    }));
    expect(punt.phase).toBe('results');
  });

  it('uses the executed facing to dislodge a carrier before another pickup', () => {
    const match = heist();
    match.step({ ...frame(red(0), blue(-9.1)), intents: { b: { tongue: true } } });
    expect(match.bales.find(b => b.id === 'red-hay-1')!.carrierId).toBe('b');
    const nearby = { ...frame(red(-9.9), blue(-9.1)), intents: { b: { tongue: true } } };
    match.step({ ...nearby, intents: { ...nearby.intents, a: { chargeHeadbutt: true } } });
    expect(match.getEffects('b').carryingBaleId).toBe('red-hay-1');
    match.step({ ...nearby, headbutts: [{ attackerId: 'a', facing: { x: -1, z: 0 } }] });
    expect(match.getEffects('b').carryingBaleId).toBe('red-hay-1');
    const elevated = { ...blue(-9.1), position: { x: -9.1, y: 20, z: 0 }, headY: 21 };
    match.step({ ...nearby, goats: [red(-9.9), elevated],
      headbutts: [{ attackerId: 'a', facing: { x: 1, z: 0 } }] });
    expect(match.getEffects('b').carryingBaleId).toBe('red-hay-1');
    const events = match.step({ ...nearby, headbutts: [{ attackerId: 'a', facing: { x: 1, z: 0 } }] });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hay.dropped', playerId: 'b', reason: 'shoved',
    }));
    expect(match.bales.find(b => b.id === 'red-hay-1')!.carrierId).toBeNull();
  });

  it('charges exact stamina per fixed tick, exhausts the carrier and restores sprint', () => {
    const match = heist({ hayCarryDrainPerSecond: 60 });
    match.step({ ...frame(red(10.9), blue(30)), intents: { a: { tongue: true } } });
    for (let i = 0; i < 99; i++) {
      match.step({ ...frame(red(10.9), blue(30)), intents: { a: { tongue: true } } });
    }
    const exhausted = match.step({ ...frame(red(10.9), blue(30)),
      intents: { a: { tongue: true } } });
    expect(exhausted).toContainEqual(expect.objectContaining({
      type: 'hay.dropped', reason: 'exhausted',
    }));
    expect(match.players.find(p => p.id === 'a')!.stamina).toBe(0);
    expect(match.getEffects('a').carryingBaleId).toBeNull();
    expect(match.getEffects('a').canSprint).toBe(false);
  });

  it('rejects overlapping or mismatched barns and uses team placements with ties', () => {
    const badArena = { ...arena(), barns: [{ teamId: 'red',
      position: { x: 0, y: 0, z: 0 }, radius: 3 }] };
    const broken = new PartyMatch({ mode: 'hay-heist' }, badArena);
    for (const [id, team] of [['a', 'red'], ['b', 'blue']]) {
      broken.join({ id: id!, name: id!, teamId: team! }); broken.setReady(id!, true);
    }
    expect(() => broken.start()).toThrow('barn');

    const match = heist({ durationTicks: 1, overtimeTicks: 2 });
    match.step(frame(red(-50), blue(50)));
    expect(match.phase).toBe('overtime');
    match.step(frame(red(-50), blue(50)));
    match.step(frame(red(-50), blue(50)));
    expect(match.phase).toBe('results');
    expect(match.teamPlacements.map(t => t.rank)).toEqual([1, 1]);
    expect(match.placements.every(p => p.rank === 1)).toBe(true);
  });

  it('ends a tied overtime on the first legal steal-and-score', () => {
    const match = heist({ durationTicks: 1, overtimeTicks: 20 });
    match.step(frame(red(50), blue(-50)));
    expect(match.phase).toBe('overtime');
    match.step({ ...frame(red(10.9), blue(40)), intents: { a: { tongue: true } } });
    const final = match.step({ ...frame(red(-10), blue(40)), intents: { a: { tongue: true } } });
    expect(final.some(e => e.type === 'match.finished')).toBe(true);
    expect(match.teamPlacements[0]).toEqual({ teamId: 'red', score: 1, rank: 1 });
  });
});
