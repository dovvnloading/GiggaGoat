import { describe, expect, it, vi } from 'vitest';
import { V } from '../physics';
import { heightAt } from '../world';
import { FIXED_DT, Game, type GameVfxCue, type GoatVisualCue } from './Game';
import { MARKET_CRATE_ID } from './MarketScene';

const create = () => Game.create({ seed: 'billy-isle', resolution: 65 });

describe('living world in the real fixed-tick game', () => {
  it('forwards accepted bleat edges once and suppresses crowd reactions during an unacknowledged gig result', async () => {
    const game = await create();
    try {
      game.teleport(game.life.residents[0]!.position, 0);
      const react = vi.spyOn(game.life, 'react');
      const happening = vi.spyOn(game.happenings, 'bleat');
      let acceptedBleats = 0;
      game.rules.events.on('ability:used', event => { if (event.name === 'bleat') acceptedBleats++; });
      const crowdBleats = () => react.mock.calls.filter(([kind]) => kind === 'bleat');

      for (let tick = 0; tick < 65; tick++) game.step({ bleat: true });
      expect(acceptedBleats).toBe(1);
      expect(crowdBleats()).toHaveLength(1);
      expect(game.life.stats.reactions).toBeGreaterThan(0);
      // Both input edges arrive between solves; only the accepted new press
      // reaches the director, even while later frames keep the button held.
      game.advance(FIXED_DT / 2, { bleat: false });
      game.advance(FIXED_DT / 2, { bleat: true });
      game.step({ bleat: true });
      game.step({ bleat: true });
      expect(acceptedBleats).toBe(2);
      expect(crowdBleats()).toHaveLength(2);
      expect(happening).toHaveBeenCalledTimes(2);

      for (let tick = 0; tick < 60; tick++) game.step();
      const board = game.gigs.boards.find(entry => entry.poiId === 'downtown-bleatsville')!;
      game.teleport(board.position, 0);
      const offer = game.gigs.board(board.poiId).find(entry => entry.gigId === 'rooftop-express')!;
      game.gigs.accept(offer.id);
      const config = game.gigs.active!.setup.config;
      if (config.kind !== 'rooftop-express') throw new Error('Expected rooftop delivery');
      const position = game.goat.torso.translation();
      game.gigs.director.step({ goat: { position, size: game.goat.size },
        props: [{ id: config.parcelId, position, broken: true }] });
      expect(game.pendingGigResult?.status).toBe('failed');
      expect(game.ambientLifeEnabled).toBe(false);
      game.step({ bleat: true });
      expect(acceptedBleats).toBe(3);
      expect(crowdBleats()).toHaveLength(2);
      // The existing discovery/reward condition stays independent of the
      // stricter ambient policy for the result overlay.
      expect(happening).toHaveBeenCalledTimes(3);
    } finally { vi.restoreAllMocks(); game.dispose(); }
  });

  it('accepts a released air headbutt without inventing a crowd impact or contact effect', async () => {
    const game = await create();
    try {
      const at = game.goat.torso.translation();
      game.teleport(V(at.x, heightAt(game.island, at.x, at.z) + 35, at.z), 0);
      const react = vi.spyOn(game.life, 'react');
      const visual: GoatVisualCue[] = [], contacts: GameVfxCue[] = [];
      game.onVisualCue(cue => visual.push(cue));
      game.onVfxCue(cue => contacts.push(cue));
      let acceptedHeadbutts = 0;
      game.rules.events.on('ability:used', event => { if (event.name === 'headbutt') acceptedHeadbutts++; });
      for (let tick = 0; tick < 12; tick++) game.step({ chargeHeadbutt: true });
      game.step({ chargeHeadbutt: false });
      expect(acceptedHeadbutts).toBe(1);
      expect(visual.filter(cue => cue.action === 'headbutt')).toHaveLength(1);
      expect(contacts.filter(cue => cue.type === 'headbutt-hit')).toHaveLength(0);
      expect(react.mock.calls.filter(([kind]) => kind === 'headbutt')).toHaveLength(0);
    } finally { vi.restoreAllMocks(); game.dispose(); }
  });

  it('suspends live fruit before the first build or party physics solve and gates accepted reactions', async () => {
    const game = await create();
    try {
      expect(game.market.disrupt(MARKET_CRATE_ID, V(1, 0, .3), 1, game.physics.time)).toBe(true);
      const positions = () => game.market.items.map(item => ({ ...item.body!.translation() }));
      const suspendedBeforeSolve: boolean[] = [];
      // Registered after Game's own pre-step hook. The actual Rapier solver
      // still runs, so equal transforms also catch disabling one tick late.
      game.physics.onBeforeStep(() => suspendedBeforeSolve.push(
        game.market.items.every(item => !item.body!.isEnabled())));
      const react = vi.spyOn(game.life, 'react');
      let acceptedBleats = 0;
      game.rules.events.on('ability:used', event => { if (event.name === 'bleat') acceptedBleats++; });

      const beforeBuild = positions();
      game.step({ toggleBuild: true, bleat: true });
      expect(game.buildMode).toBe(true);
      expect(suspendedBeforeSolve.at(-1)).toBe(true);
      expect(positions()).toEqual(beforeBuild);
      expect(acceptedBleats).toBe(1);
      expect(react).not.toHaveBeenCalled();

      game.advance(0, { toggleBuild: true, bleat: false });
      for (let tick = 0; tick < 60; tick++) game.step();
      expect(suspendedBeforeSolve.at(-1)).toBe(false);
      expect(game.market.activeBodies).toBe(6);
      react.mockClear();
      const beforeParty = positions();
      const residentsBeforeParty = game.life.residents.map(actor => ({ position: { ...actor.position },
        seat: actor.seat?.progress }));
      game.party.start('rising-tide', 3, 'easy', { countdownTicks: 0 });
      expect(game.market.items.every(item => item.body!.isEnabled())).toBe(true);
      game.step({ bleat: true });
      expect(suspendedBeforeSolve.at(-1)).toBe(true);
      expect(positions()).toEqual(beforeParty);
      expect(acceptedBleats).toBe(2);
      expect(react).not.toHaveBeenCalled();
      expect(game.life.residents.map(actor => ({ position: actor.position, seat: actor.seat?.progress })))
        .toEqual(residentsBeforeParty);
      expect(game.life.residents.every(actor => actor.activity === (actor.seat ? 'sit' : 'idle') && actor.speed === 0)).toBe(true);
      expect(game.market.activeBodies).toBe(6);

      game.party.returnToFreeRoam();
      expect(positions()).toEqual(beforeParty);
      game.step();
      expect(suspendedBeforeSolve.at(-1)).toBe(false);
      expect(game.market.activeBodies).toBe(6);
    } finally { vi.restoreAllMocks(); game.dispose(); }
  });
});
