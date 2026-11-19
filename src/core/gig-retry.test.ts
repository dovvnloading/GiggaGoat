import { describe, expect, it } from 'vitest';
import { heightAt } from '../world';
import { Game } from './Game';
import { boardwalkPierDecks } from '../world/boardwalk';

const create = () => Game.create({ resolution: 97 });

describe('retrying a failed gig', () => {
  it('starts Rooftop Express above the street on acceptance, retry, and reload', async () => {
    const game = await create();
    try {
      const board = game.gigs.boards.find(entry => entry.poiId === 'downtown-bleatsville')!;
      game.teleport(board.position);
      const offer = game.gigs.board(board.poiId).find(entry => entry.gigId === 'rooftop-express')!;
      game.gigs.accept(offer.id);
      const run = game.gigs.active!;
      expect(run.setup.config.kind).toBe('rooftop-express');
      for (let tick = 0; tick < 45; tick++) game.step();
      const roof = game.goat.torso.translation();
      expect(roof.y).toBeGreaterThan(board.position.y + 4);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.gigs.active?.status).toBe('running');

      const restored = await Game.create({ resolution: 97, progress: game.exportProgress() });
      try {
        expect(restored.goat.torso.translation()).toEqual(roof);
        restored.step();
        expect(restored.gigs.active?.attemptId).toBe(run.attemptId);
        expect(restored.gigs.active?.status).toBe('running');
      } finally { restored.dispose(); }

      game.teleport(board.position);
      game.step();
      expect(game.gigs.active?.status).toBe('failed');
      game.gigs.retryFailed();
      expect(game.gigs.active?.attemptId).toBeGreaterThan(run.attemptId);
      game.step();
      expect(game.gigs.active?.status).toBe('running');
      expect(game.goat.torso.translation().y).toBeGreaterThan(board.position.y + 4);
    } finally { game.dispose(); }
  });

  it('restarts the exact posted Hay Haul offer from the field and saves only the new attempt', async () => {
    const game = await create();
    try {
      const offer = game.gigs.board('hoofington').find(entry => entry.gigId === 'hay-haul')!;
      game.gigs.accept(offer.id);
      const run = game.gigs.active!;
      const config = run.setup.config;
      if (config.kind !== 'hay-haul') throw new Error('Expected Hay Haul');
      const bale = config.bales[0]!;
      const director = game.gigs.director;
      const field = { x: -190, z: game.goat.torso.translation().z };
      const ground = heightAt(game.island, field.x, field.z);
      game.teleport({ ...field, y: ground }, 0);
      const position = game.goat.torso.translation();
      director.step({ goat: { position: bale.start, size: game.goat.size },
        abilities: [{ type: 'tongue', targetId: bale.id }], props: [{ id: bale.id, position: bale.start }] });
      director.step({ goat: { position, size: game.goat.size }, props: [{ id: bale.id, position: config.barn }] });
      for (let tick = 2; tick < run.setup.maxTicks; tick++) {
        director.step({ goat: { position, size: game.goat.size }, props: [] });
      }
      const failure = game.pendingGigResult!;
      expect(failure.status).toBe('failed');
      expect(failure.objective).toMatchObject({ done: 1, required: config.required });
      expect(game.gigs.retryableOffer?.id).toBe(offer.id);
      expect(game.gigs.nearBoard()).toBeNull();
      expect(() => game.gigs.accept(offer.id)).toThrow('Offer unavailable at this board');

      game.gigs.retryFailed();
      const retry = game.gigs.active!;
      expect(retry.attemptId).toBeGreaterThan(failure.attemptId);
      expect(retry.setup.offer).toEqual(failure.setup.offer);
      expect(retry.status).toBe('running');
      expect(retry.elapsedTicks).toBe(0);
      expect(retry.objective).toMatchObject({ done: 0, required: config.required });
      expect(game.goat.torso.translation()).toMatchObject(position);
      expect(game.pendingGigResult).toBeNull();
      expect(game.gigs.retryableOffer).toBeNull();

      const loaded = await Game.create({ resolution: 97, progress: game.exportProgress() });
      try {
        expect(loaded.pendingGigResult).toBeNull();
        expect(loaded.gigs.active?.attemptId).toBe(retry.attemptId);
        expect(loaded.gigs.active?.status).toBe('running');
      } finally { loaded.dispose(); }
    } finally { game.dispose(); }
  });

  it('restores a timed gig and the player beyond the offshore boundary on the pier', async () => {
    const game = await create();
    try {
      const board = game.gigs.boards.find(entry => entry.poiId === 'baa-ardwalk')!;
      game.teleport(board.position);
      game.gigs.accept(game.gigs.board(board.poiId)[0]!.id);

      const deck = boardwalkPierDecks(game.island).sort((a, b) =>
        b.transform.position.z - a.transform.position.z)[0]!;
      const p = deck.transform.position;
      game.teleport({ x: p.x, y: p.y + deck.size.y / 2, z: p.z + deck.size.z / 2 - 2 }, .7);
      for (let tick = 0; tick < 32; tick++) game.step({ cameraYaw: -.7 });
      const before = game.goat.torso.translation();
      const run = game.gigs.active!;
      expect(run.status).toBe('running');
      expect(before.z).toBeGreaterThan(game.island.size * .57);
      const progress = game.exportProgress();
      expect(progress.gigPlayerPose?.attemptId).toBe(run.attemptId);

      const restored = await Game.create({ resolution: 97, progress });
      try {
        expect(restored.goat.torso.translation()).toEqual(before);
        expect(restored.gigs.active).toMatchObject({ elapsedTicks: run.elapsedTicks, status: 'running' });
        restored.step();
        expect(restored.location).toBe('Baa-ardwalk');
        expect(restored.respawns).toBe(0);
        expect(restored.gigs.active?.elapsedTicks).toBe(run.elapsedTicks + 1);
      } finally { restored.dispose(); }

      delete progress.gigPlayerPose;
      const legacy = await Game.create({ resolution: 97, progress });
      try {
        expect(legacy.location).toBe('Baa-ardwalk');
        expect(legacy.gigs.active).toMatchObject({ attemptId: run.attemptId,
          elapsedTicks: run.elapsedTicks, status: 'running' });
      } finally { legacy.dispose(); }
    } finally { game.dispose(); }
  });

  it('retains a failed result after its exact offer expires', async () => {
    const game = await create();
    try {
      const offer = game.gigs.board('hoofington').find(entry => entry.gigId === 'hay-haul')!;
      game.gigs.accept(offer.id);
      const director = game.gigs.director;
      const frame = { goat: { position: game.goat.torso.translation(), size: game.goat.size } };
      while (director.tick < offer.expiresTick) director.step(frame);
      const failure = game.pendingGigResult;
      expect(failure?.status).toBe('failed');
      expect(game.gigs.retryableOffer).toBeNull();
      expect(() => game.gigs.retryFailed()).toThrow('no longer available');
      expect(game.pendingGigResult).toEqual(failure);
    } finally { game.dispose(); }
  });
});
