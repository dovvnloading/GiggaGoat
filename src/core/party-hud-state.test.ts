import { describe, expect, it } from 'vitest';
import { makeMockIsland } from '../modes/mock-island';
import { frame, goat, readyMatch } from '../modes/test-utils';
import type { PartyMatch } from '../modes';
import { derivePartyHudState } from './PartyHudState';

const arena = makeMockIsland();
const hud = (match: PartyMatch) => derivePartyHudState(match.toJSON(), arena.tideLevels, 'player');

describe('party scoreboard state', () => {
  it('shows the launch, round, and overtime clocks from their own phase timers', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', config: {
      countdownTicks: 120, durationTicks: 61, overtimeTicks: 62,
    } }, ['player', 'rival']);
    const emptySummit = frame(goat('player', 40), goat('rival', -40));

    expect(hud(match)).toMatchObject({ clockLabel: 'START', clock: '0:02', status: '' });
    for (let tick = 0; tick < 120; tick++) match.step(emptySummit);
    expect(hud(match)).toMatchObject({ clockLabel: 'ROUND', clock: '0:02', status: 'SUMMIT OPEN' });
    match.step(emptySummit);
    expect(hud(match).clock).toBe('0:01');
    for (let tick = 0; tick < 60; tick++) match.step(emptySummit);
    expect(hud(match)).toMatchObject({ clockLabel: 'OT', clock: '0:02', goal: 'Break the lead tie' });
    for (let tick = 0; tick < 62; tick++) match.step(emptySummit);
    expect(hud(match).clock).toBe('0:00');
  });

  it('promotes the actual Rising Tide warning then reports the new waterline and survivors', () => {
    const match = readyMatch({ mode: 'rising-tide', config: {
      durationTicks: 1200, tideRiseEveryTicks: 360, tideWarningTicks: 120, submergeTicks: 1,
    } }, ['player', 'rival', 'third']);
    const highGround = frame(goat('player'), goat('rival'), goat('third'));
    expect(hud(match)).toMatchObject({ goal: 'Last goat standing', status: 'NEXT RISE 6s', urgent: false });

    for (let tick = 0; tick < 240; tick++) match.step(highGround);
    expect(hud(match)).toMatchObject({ status: 'TIDE RISES IN 2s', urgent: true });
    for (let tick = 0; tick < 119; tick++) match.step(highGround);
    match.step(frame(goat('player'), goat('rival'), goat('third', 0, 0, 2)));

    expect(hud(match)).toMatchObject({ status: 'TIDE ROSE · CLIMB!', urgent: true });
    expect(hud(match).metrics).toEqual([
      { label: 'GOATS LEFT', value: '2' }, { label: 'SEA LEVEL', value: '3.0 m' },
    ]);
  });

  it('uses the summit capture score and win target and reports a real contest', () => {
    const match = readyMatch({ mode: 'king-of-the-peak', config: {
      peakPointsPerSecond: 3, peakTargetScore: 40,
    } }, ['player', 'rival']);
    for (let tick = 0; tick < 60; tick++) match.step(frame(goat('player'), goat('rival', 45)));
    expect(hud(match)).toMatchObject({ goal: 'Hold the summit to score', status: 'YOU HOLD THE SUMMIT' });
    expect(hud(match).metrics).toEqual([
      { label: 'YOUR POINTS', value: '3' }, { label: 'WIN TARGET', value: '40' },
    ]);
    match.step(frame(goat('player'), goat('rival', 0, 1)));
    expect(hud(match).status).toBe('SUMMIT CONTESTED');
  });

  it('identifies the player team and switches from pickup to delivery using the real cargo', () => {
    const match = readyMatch({ mode: 'hay-heist', config: { hayTargetScore: 3, hayPerTeam: 1 } },
      ['player', 'rival']);
    const enemyBale = match.bales.find(bale => bale.homeTeam === 'blue')!.position;
    const barn = arena.barns.find(site => site.teamId === 'red')!.position;
    expect(hud(match)).toMatchObject({ goal: 'First to 3 deliveries', status: 'HOLD LICK BY ENEMY HAY' });
    expect(hud(match).metrics[0]).toEqual({ label: 'RED · YOU', value: '0', ownTeam: true });

    match.step({ ...frame(goat('player', enemyBale.x, enemyBale.z, enemyBale.y + 1), goat('rival')),
      intents: { player: { tongue: true } } });
    expect(hud(match).status).toBe('DELIVER TO YOUR BARN');
    match.step({ ...frame(goat('player', barn.x, barn.z, barn.y + 1), goat('rival')),
      intents: { player: { tongue: true } } });
    expect(hud(match).metrics).toEqual([
      { label: 'RED · YOU', value: '1', ownTeam: true },
      { label: 'BLUE', value: '0', ownTeam: false },
    ]);
  });
});
