import { describe, expect, it } from 'vitest';
import { Game, FIXED_DT } from './Game';
import { V, forward, RAPIER, collisionGroups } from '../physics';
import { heightAt } from '../world';

const create = (): Promise<Game> => Game.create({ seed: 'first-playable-test', resolution: 97 });
const ticks = (game: Game, count: number, input: Parameters<Game['step']>[0] = {}): void => {
  for (let i = 0; i < count; i++) game.step(input);
};

describe('First playable — real Billy Isle with Rapier, gameplay and chaos', () => {
  it('simulates ten real seconds on land without a fallen or submerged goat', async () => {
    const game = await create();
    try {
      expect(game.island.pois).toHaveLength(8);
      expect(game.island.props.length).toBeGreaterThan(100);
      expect(game.colliders.terrain.isValid()).toBe(true);
      expect(game.goat.bodies).toHaveLength(7);
      ticks(game, 600);
      const torso = game.goat.torso, p = torso.translation(), q = torso.rotation();
      const up = 1 - 2 * (q.x ** 2 + q.z ** 2);
      expect(game.physics.stepCount).toBe(600);
      expect(game.physics.time).toBeCloseTo(600 * FIXED_DT, 6);
      expect(p.y).toBeGreaterThan(game.water.seaLevel + .5);
      expect(p.y - heightAt(game.island, p.x, p.z)).toBeGreaterThan(.12);
      expect(up).toBeGreaterThan(.6);
      expect(game.goat.isRagdoll).toBe(false);
      expect(game.respawns).toBe(0);
    } finally { game.dispose(); }
  });

  it('turns the gameplay jump edge into a real launch off the ground', async () => {
    const game = await create();
    try {
      ticks(game, 120);
      expect(game.goat.locomotion.grounded).toBe(true);
      const y = game.goat.torso.translation().y;
      game.step({ jump: true });
      ticks(game, 13, { jump: false });
      expect(game.goat.torso.translation().y - y).toBeGreaterThan(.22);
      expect(game.goat.locomotion.grounded).toBe(false);
      expect(game.goat.locomotion.airborneSeconds).toBeGreaterThan(0);
    } finally { game.dispose(); }
  });

  it('charges a headbutt through GoatAbilities and moves a real dynamic prop with physical momentum', async () => {
    const game = await create();
    try {
      ticks(game, 125);
      // The island's own breakable crates can already have shattered after
      // settling onto terrain. A controlled *real dynamic collider* ensures
      // this test isolates the charged interaction rather than prop lifetime.
      const body = game.physics.createBox(V(0, 100, 0), V(.25, .25, .25), 10);
      ticks(game, 35, { chargeHeadbutt: true });
      expect(game.rules.abilities.headbuttCharge).toBeGreaterThan(.45);
      const head = game.goat.head.translation(), dir = forward(game.goat.locomotion.heading);
      body.setTranslation(V(head.x + dir.x * .9, head.y - .06, head.z + dir.z * .9), true);
      body.setLinvel(V(), true);
      body.setAngvel(V(), true);
      // A manually teleported Rapier body enters the query acceleration
      // structure on the next physics step. Keep charging for that tick.
      game.step({ chargeHeadbutt: true });
      const before = { ...body.translation() };
      game.step({ chargeHeadbutt: false });
      const immediateVelocity = body.linvel();
      expect(Math.hypot(immediateVelocity.x, immediateVelocity.z)).toBeGreaterThan(.1);
      ticks(game, 10);
      const after = body.translation();
      expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(.045);
      expect(game.rules.style.score).toBeGreaterThan(0);
    } finally { game.dispose(); }
  });

  it('rescues a goat submerged off the coast and restores the real Hoofington spawn', async () => {
    const game = await create();
    try {
      ticks(game, 30);
      const offshore = game.island.size * .49;
      expect(heightAt(game.island, offshore, offshore)).toBeLessThan(game.water.seaLevel);
      game.teleport(V(offshore, game.water.seaLevel - 3, offshore));
      ticks(game, 330);
      const now = game.goat.torso.translation();
      const spawn = game.island.spawns[0]!.position;
      expect(game.respawns).toBeGreaterThan(0);
      expect(Math.hypot(now.x - spawn.x, now.z - spawn.z)).toBeLessThan(2);
      expect(now.y).toBeGreaterThan(game.water.seaLevel);
    } finally { game.dispose(); }
  });

  it('varied tricks trigger a style tier and really resize the seven-body ragdoll', async () => {
    const game = await create();
    try {
      const originalMass = game.goat.torso.mass();
      expect(game.rules.style.tier).toBe('Kid');
      expect(game.goat.size).toBe(.6);
      for (const type of ['flip', 'knockback', 'topple', 'tongue-swing'] as const) {
        game.rules.awardStyle({ type, quality: 1 });
      }
      expect(game.rules.style.meter).toBeGreaterThanOrEqual(16);
      expect(game.rules.style.tier).toBe('Billy');
      game.step();
      expect(game.goat.size).toBe(1);
      expect(game.goat.torso.mass()).toBeGreaterThan(originalMass * 2.5);
      expect(game.goat.bodies).toHaveLength(7);
      expect(game.water.sample(game.goat.torso).fraction).toBeGreaterThanOrEqual(0);
    } finally { game.dispose(); }
  });

  it('scores measured vertical climbing after releasing a real steep wall', async () => {
    const game = await create();
    try {
      ticks(game, 90);
      const startingY = game.goat.torso.translation().y;
      const p = game.goat.torso.translation();
      const facing = forward(game.goat.locomotion.heading);
      const wall = game.physics.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed()
        .setTranslation(p.x + facing.x * 1.65, p.y + 2,
          p.z + facing.z * 1.65));
      game.physics.raw.createCollider(RAPIER.ColliderDesc.cuboid(3, 3, .35)
        .setRotation({x:0,y:Math.sin(game.goat.locomotion.heading/2),
          z:0,w:Math.cos(game.goat.locomotion.heading/2)})
        .setCollisionGroups(collisionGroups('terrain')), wall);
      const awarded: string[] = [];
      const off = game.rules.events.on('style:scored', event => awarded.push(event.trick));
      let highest = startingY;
      for (let i = 0; i < 240; i++) {
        game.step({ moveZ: 1, cameraYaw: game.goat.locomotion.heading, climb: true });
        highest = Math.max(highest, game.goat.torso.translation().y);
      }
      ticks(game, 10, {moveZ: 0, climb: false});
      off();
      expect(highest - startingY).toBeGreaterThan(.8);
      expect(awarded).toContain('wall-climb');
    } finally { game.dispose(); }
  });

  it('installs water volumes, breakable props, trampoline and launch pads as real colliders', async () => {
    const game = await create();
    try {
      expect(game.water.seaLevel).toBe(game.island.seaLevel);
      expect(game.water.listVolumes().map(v => v.id)).toContain('reservoir');
      expect(game.water.listVolumes().length).toBe(game.island.river.length);
      expect(game.breakables.breakableCount).toBeGreaterThan(80);
      expect(game.surfaces.count).toBeGreaterThanOrEqual(3);
      const trampoline = game.surfaceMarkers.find(s => s.kind === 'trampoline')!;
      game.teleport(V(trampoline.position.x, trampoline.position.y + .6, trampoline.position.z));
      ticks(game, 75);
      expect(game.goat.torso.translation().y).toBeGreaterThan(trampoline.position.y + .5);
    } finally { game.dispose(); }
  });
});
