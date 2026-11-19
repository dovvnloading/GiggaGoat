import { expect, it } from 'vitest';
import { BOARD_CYCLE_TICKS } from '../gigs';
import { RAPIER, V } from '../physics';
import { heightAt } from '../world';
import { Game } from './Game';

async function besideMediumTower() {
  const seed = await Game.create();
  const save = seed.exportProgress();
  seed.dispose();
  save.gigs.tick = 178 * BOARD_CYCLE_TICKS;
  const game = await Game.create({ progress: save });
  try {
    const board = game.gigs.boards.find(entry => entry.poiId === 'crane-yard')!;
    game.teleport(board.position, 0);
    for (let tick = 0; tick < 35; tick++) game.step();
    const offer = game.gigs.board(board.poiId).find(entry => entry.gigId === 'demolition-contract')!;
    expect(offer.difficulty).toBe('medium');
    game.gigs.accept(offer.id);

    const config = game.gigs.active!.setup.config;
    if (config.kind !== 'demolition-contract') throw new Error('Expected a Demolition tower');
    const left = config.pieces[0]!;
    const target = game.gigs.props.get(left.id)!.body;
    // The missed live third strike approached this partially displaced base crate from the right.
    target.setTranslation(V(left.start.x - .292, left.start.y, left.start.z + .196), true);
    const x = target.translation().x + .058;
    const z = target.translation().z - 1.003;
    const heading = -1.6364;
    const look = Math.atan2(target.translation().x - x, z - target.translation().z);
    game.teleport(V(x, heightAt(game.island, x, z), z), -heading);
    for (let tick = 0; tick < 38; tick++) game.step({ cameraYaw: look });
    return { game, left, heading, look };
  } catch (error) {
    game.dispose();
    throw error;
  }
}

it.each([8, 30, 85])('physically turns a stationary Demolition charge toward the looked-at crate within %i ticks', async ticks => {
  const { game, left, heading, look } = await besideMediumTower();
  try {
    const { goat } = game;
    expect(goat.locomotion.grounded).toBe(true);
    expect(goat.locomotion.heading).toBeCloseTo(heading);
    const headBefore = goat.head.translation();
    const knockedOwners: Array<string | undefined> = [];
    goat.events.on(event => {
      if (event.type === 'knockedBody') knockedOwners.push(game.physics.bodyData(event.bodyHandle)?.owner);
    });
    for (let tick = 0; tick < ticks; tick++) game.step({ cameraYaw: look, chargeHeadbutt: true });
    expect(goat.locomotion.heading).toBeCloseTo(look);
    expect(goat.head.translation().z).toBeGreaterThan(headBefore.z + .04);
    game.step({ cameraYaw: look, chargeHeadbutt: false });
    for (let tick = 0; tick < 25; tick++) game.step({ cameraYaw: look });
    expect(knockedOwners).toEqual([left.id]);
    expect(game.gigs.active?.metrics.headbutts).toBe(1);
    if (ticks === 85) expect(game.gigs.active?.metrics.displacedMass).toBeGreaterThan(.3);
  } finally {
    game.dispose();
  }
});

it('keeps ordinary facing when a fixed blocker hides a marked crate', async () => {
  const { game, heading, look } = await besideMediumTower();
  try {
    const point = game.goat.torso.translation();
    game.physics.raw.createCollider(RAPIER.ColliderDesc.cuboid(.23, .55, .035)
      .setTranslation(point.x, point.y + .3, point.z + .19));
    game.step({ cameraYaw: look });
    for (let tick = 0; tick < 45; tick++) game.step({ cameraYaw: look, chargeHeadbutt: true });
    expect(game.goat.locomotion.heading).toBeCloseTo(heading);
    game.step({ cameraYaw: look });
    expect(game.gigs.active?.metrics.headbutts).toBe(0);
  } finally {
    game.dispose();
  }
});

it('keeps moving and free-roam charges under the ordinary steering controls', async () => {
  const { game, heading, look } = await besideMediumTower();
  try {
    game.step({ cameraYaw: look, moveX: 1, chargeHeadbutt: true });
    expect(Math.cos(game.goat.locomotion.heading - look)).toBeCloseTo(0);
    game.gigs.abandon();

    const point = game.goat.torso.translation();
    game.teleport(V(point.x, heightAt(game.island, point.x, point.z), point.z), -heading);
    for (let tick = 0; tick < 65; tick++) game.step({ cameraYaw: look });
    for (let tick = 0; tick < 30; tick++) game.step({ cameraYaw: look, chargeHeadbutt: true });
    expect(game.goat.locomotion.heading).toBeCloseTo(heading);
  } finally {
    game.dispose();
  }
});
