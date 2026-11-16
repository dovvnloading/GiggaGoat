import { describe, expect, it } from 'vitest';
import { BotBrain } from './bots';
import { PartyMatch } from './match';
import { makeMockIsland, MockIslandRunner } from './mock-island';
import { arenaFromBillyIsle } from './world-adapter';
import { generateIsland, heightAt, landAreaAtTideLevel } from '../world/island';
import { goat } from './test-utils';
import type { Difficulty, MatchEvent, ModeId } from './types';

function botMatch(mode: ModeId, seed = 42): { match: PartyMatch; runner: MockIslandRunner } {
  const island = makeMockIsland();
  const arena = mode === 'hay-heist' ? { ...island, barns: [
    { teamId: 'red', position: { x: -28, y: island.elevationAt(-28, -10), z: -10 }, radius: 10 },
    { teamId: 'blue', position: { x: 28, y: island.elevationAt(28, -10), z: -10 }, radius: 10 },
  ] } : island;
  const match = new PartyMatch({ mode, seed, config: {
    countdownTicks: 3, durationTicks: mode === 'hay-heist' ? 2400 : 950,
    overtimeTicks: 125, tideRiseEveryTicks: 60, tideWarningTicks: 15,
    submergeTicks: 20, peakPointsPerSecond: 4, peakTargetScore: 12,
    peakComebackGap: 4, hayPerTeam: 2, hayTargetScore: 2,
  } }, arena);
  for (let i = 0; i < 4; i++) {
    const id = `bot-${i}`;
    match.join({ id, name: `Captain ${i}`, bot: true,
      teamId: mode === 'hay-heist' ? (i % 2 ? 'blue' : 'red') : null });
    match.setReady(id, true);
  }
  match.start();
  return { match, runner: new MockIslandRunner(match, 'normal', seed) };
}

describe('Seeded bot goats + headless mock matches', () => {
  it.each(['easy', 'normal', 'hard'] as Difficulty[])('%s brain yields legal movement inputs', difficulty => {
    const { match, runner } = botMatch('king-of-the-peak');
    for (let i = 0; i < 3; i++) runner.tick();
    const brain = new BotBrain('bot-0', difficulty, 987);
    for (let i = 0; i < 30; i++) {
      const intent = brain.decide(match.view(), runner.observe());
      expect(Math.hypot(intent.moveX ?? 0, intent.moveZ ?? 0)).toBeLessThanOrEqual(1.000000001);
      expect(typeof intent.sprint).toBe('boolean');
    }
  });

  it('plans a tide escape at the waterline, capture on the summit, and a bale grab', () => {
    const tide = botMatch('rising-tide').match;
    tide.step(); tide.step(); tide.step();
    const escape = new BotBrain('bot-0', 'hard', 11);
    const observation = [goat('bot-0', 175, 0), goat('bot-1', -175),
      goat('bot-2', -150, 20), goat('bot-3', 150, -20)];
    const fleeing = escape.decide(tide.view(), observation);
    expect(escape.goal).toBe('flee');
    expect(fleeing.moveX).toBeLessThan(0);
    const peak = botMatch('king-of-the-peak').match;
    peak.step(); peak.step(); peak.step();
    const climber = new BotBrain('bot-0', 'hard');
    climber.decide(peak.view(), [goat('bot-0', 30), goat('bot-1', -30),
      goat('bot-2', -40, 30), goat('bot-3', 40, -30)]);
    expect(climber.goal).toBe('capture');
    const heist = botMatch('hay-heist').match;
    heist.step(); heist.step(); heist.step();
    const enemyBale = heist.bales.find(b => b.homeTeam === 'blue')!;
    const thief = new BotBrain('bot-0', 'hard');
    const act = thief.decide(heist.view(), [
      goat('bot-0', enemyBale.position.x, enemyBale.position.z),
      goat('bot-1', -200), goat('bot-2', -100), goat('bot-3', 100),
    ]);
    expect(thief.goal).toBe('grab-hay');
    expect(act.tongue).toBe(true);
  });

  it('resumes its private RNG and tactical memory bit-for-bit from JSON', () => {
    const { match, runner } = botMatch('king-of-the-peak');
    for (let i = 0; i < 3; i++) runner.tick();
    const brain = new BotBrain('bot-0', 'hard', 879);
    for (let i = 0; i < 25; i++) brain.decide(match.view(), runner.observe());
    const restored = BotBrain.fromJSON(JSON.parse(JSON.stringify(brain.toJSON())));
    const originals = Array.from({ length: 100 }, () => brain.decide(match.view(), runner.observe()));
    const replays = Array.from({ length: 100 }, () => restored.decide(match.view(), runner.observe()));
    expect(replays).toEqual(originals);
    expect(restored.toJSON()).toEqual(brain.toJSON());
  });

  it.each(['rising-tide', 'king-of-the-peak', 'hay-heist'] as ModeId[])(
    '%s: a four-bot full match terminates with exhaustive valid placements',
    mode => {
      const { match, runner } = botMatch(mode);
      const events: MatchEvent[] = [];
      for (let tick = 0; tick < 3000 && match.phase !== 'results'; tick++) {
        events.push(...runner.tick());
      }
      expect(match.phase).toBe('results');
      expect(match.placements).toHaveLength(4);
      expect(new Set(match.placements.map(p => p.playerId)).size).toBe(4);
      expect(match.placements.every(p => p.rank >= 1 && p.rank <= 4 &&
        p.placementPoints > 0 && Number.isFinite(p.score))).toBe(true);
      expect(events.filter(e => e.type === 'match.finished')).toHaveLength(1);
      if (mode === 'hay-heist') expect(match.teamPlacements).toHaveLength(2);
    },
  );

  it('replays a running mocked match, bots, and events without an RNG divergence', () => {
    const { match, runner } = botMatch('rising-tide', 321);
    for (let i = 0; i < 130; i++) runner.tick();
    const restoredMatch = PartyMatch.fromJSON(match.toJSON(), match.view().arena);
    const restored = new MockIslandRunner(restoredMatch);
    restored.goats.splice(0, restored.goats.length, ...runner.goats.map(g => ({
      ...g, facing: { ...g.facing },
    })));
    restored.bots.clear();
    for (const [id, bot] of runner.bots) restored.bots.set(id, BotBrain.fromJSON(bot.toJSON()));
    for (let i = 0; i < 160; i++) {
      expect(restored.tick()).toEqual(runner.tick());
    }
    expect(restoredMatch.toJSON()).toEqual(match.toJSON());
  });

  it('uses the world lane tide calculation without altering the generated island', () => {
    const world = generateIsland({ seed: 'modes-contract', resolution: 65 });
    const levels = [...world.tideLevels];
    const arena = arenaFromBillyIsle(world, { heightAt, landAreaAtTideLevel });
    expect(arena.tideLevels).toEqual(levels);
    expect(arena.summit).toEqual(world.pois.find(p => p.id === 'mt-gigga')!.center);
    expect(arena.dryAreaAtTideLevel(levels[5]!)).toBe(
      landAreaAtTideLevel(world, levels[5]!));
    expect(arena.elevationAt(arena.summit.x, arena.summit.z)).toBeGreaterThan(0);
    expect(world.tideLevels).toEqual(levels);
    expect(arena.barns).toHaveLength(2);
  });
});
