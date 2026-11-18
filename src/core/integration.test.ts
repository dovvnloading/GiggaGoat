import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { Game, FIXED_DT } from './Game';
import { renderHudMinimap } from './HudArtwork';
import { V, forward, RAPIER, collisionGroups } from '../physics';
import { createWorldScene, heightAt } from '../world';
import { DAM_DECK_HEIGHT, getDamPlacement } from '../world/the-dam';

const create = (): Promise<Game> => Game.create({ seed: 'first-playable-test', resolution: 97 });
const ticks = (game: Game, count: number, input: Parameters<Game['step']>[0] = {}): void => {
  for (let i = 0; i < count; i++) game.step(input);
};

function standAt(game: Game, x: number, z: number): void {
  game.step();
  const floor = game.physics.raycast(V(x, 120, z), V(0, -1, 0), 160, {
    predicate: collider => !game.goat.ownsBody(collider.parent()),
  });
  expect(floor, `floor at (${x}, ${z})`).not.toBeNull();
  game.teleport(V(x, floor!.point.y, z), 0);
  ticks(game, 30);
}

function walkTo(game: Game, target: { x: number; z: number }): void {
  for (let i = 0; i < 360; i++) {
    const p = game.goat.torso.translation();
    const dx = target.x - p.x, dz = target.z - p.z;
    if (Math.hypot(dx, dz) < .65) return;
    game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
  }
  const { x, y, z } = game.goat.torso.translation();
  throw new Error(`Walk to (${target.x.toFixed(2)}, ${target.z.toFixed(2)}) stopped at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
}

describe('Walkable roads and coastal routes', () => {
  it('lets both Downtown approaches reach the board from a clear street lane', async () => {
    const game = await Game.create();
    try {
      const city = game.island.pois.find(poi => poi.id === 'downtown-bleatsville')!;
      const board = game.gigs.boards.find(entry => entry.poiId === city.id)!;
      expect(board.position.x - city.center.x).toBeGreaterThan(7);
      for (const direction of [-1, 1]) {
        const x = city.center.x + 2.5;
        standAt(game, x, board.position.z + direction * 15);
        expect(game.gigs.nearBoard()).toBeNull();
        walkTo(game, { x, z: board.position.z + direction * 4 });
        expect(game.gigs.nearBoard()).toBe(city.id);
        expect(game.gigs.board(city.id).length).toBeGreaterThan(0);
      }
      expect(game.respawns).toBe(0);
    } finally { game.dispose(); }
  });

  it('supports the goat on the visible Hoofington road immediately and after a rescue', async () => {
    const game = await Game.create();
    const scene = createWorldScene(game.island);
    try {
      const { x, z } = game.island.spawns[0]!.position;
      const road = scene.group.getObjectByName('paths-road')!;
      const ray = new Raycaster(new Vector3(x, 120, z), new Vector3(0, -1, 0));
      const asphalt = ray.intersectObject(road)[0]!.point.y;
      expect(asphalt - heightAt(game.island, x, z)).toBeGreaterThan(.15);
      const board = game.gigs.boards.find(entry => entry.poiId === 'hoofington')!;
      ray.set(new Vector3(board.position.x, 120, board.position.z), new Vector3(0, -1, 0));
      expect(ray.intersectObject(road)).toHaveLength(0);
      expect(game.gigs.nearBoard()).toBe('hoofington');
      const expectedTorsoY = asphalt + .92 * game.goat.size;
      expect(game.goat.torso.translation().y).toBeCloseTo(expectedTorsoY, 4);

      game.step();
      const ground = game.physics.raycast(V(x, 120, z), V(0, -1, 0), 160, {
        predicate: collider => !game.goat.ownsBody(collider.parent()),
      });
      expect(ground?.point.y).toBeCloseTo(asphalt, 4);
      expect(game.colliders.paths.some(path => path.handle === ground?.collider.handle)).toBe(true);

      game.respawn();
      expect(game.goat.torso.translation().y).toBeCloseTo(expectedTorsoY, 4);
    } finally {
      scene.dispose();
      game.dispose();
    }
  });

  it('walks onto and off an asphalt edge without jumping', async () => {
    const game = await Game.create();
    try {
      const centre = game.island.pois.find(poi => poi.id === 'hoofington')!.center;
      const z = centre.z + 3;
      const roadside = { x: centre.x + 6.4, z };
      const lane = { x: centre.x + 1.4, z };
      standAt(game, roadside.x, z);
      const onPath = ({ x, z }: { x: number; z: number }): boolean => {
        const floor = game.physics.raycast(V(x, 120, z), V(0, -1, 0), 160, {
          predicate: collider => !game.goat.ownsBody(collider.parent()),
        });
        return game.colliders.paths.some(path => path.handle === floor?.collider.handle);
      };
      expect(onPath(roadside)).toBe(false);
      expect(onPath(lane)).toBe(true);
      walkTo(game, lane);
      walkTo(game, roadside);
      expect(game.respawns).toBe(0);
    } finally {
      game.dispose();
    }
  });

  it('blocks a straight walk into the Dam rail and keeps all Dam Bomb launches clear', async () => {
    const game = await Game.create();
    try {
      const { position: dam, scale } = getDamPlacement(game.island);
      const deckTop = dam.y + DAM_DECK_HEIGHT * scale;
      const movement = { moveZ: 1, cameraYaw: Math.PI };
      const standOnDeck = (x: number) => {
        game.teleport(V(x, deckTop, dam.z - .5 * scale), Math.PI);
        ticks(game, 35);
      };

      standOnDeck(dam.x + 10 * scale);
      for (let i = 0; i < 240; i++) {
        game.step(movement);
        expect(game.goat.torso.translation().z).toBeLessThan(dam.z + 3.7 * scale);
        expect(game.goat.locomotion.isClinging).toBe(false);
      }
      expect(game.goat.torso.translation().y).toBeGreaterThan(deckTop);

      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        const { config } = game.gigs.director.startPractice('dam-bomb', difficulty);
        if (config.kind !== 'splash-dive') throw new Error('Expected a Dam Bomb splash dive');
        standOnDeck(config.jumpPoint.x);
        const takeoffZ = dam.z + 3.88 * scale;
        for (let i = 0; i < 130 && game.goat.torso.translation().z <= takeoffZ; i++) {
          game.step(movement);
        }
        expect(game.goat.torso.translation().z, difficulty).toBeGreaterThan(takeoffZ);
        game.step({ ...movement, flop: true });
        for (let i = 0; i < 120 && game.gigs.active?.status === 'running'; i++) game.step();
        expect(game.gigs.active?.status, difficulty).toBe('completed');
        expect(game.gigs.active?.metrics.splashDrop).toBeGreaterThanOrEqual(config.minDrop);
      }
      expect(game.respawns).toBe(0);
    } finally { game.dispose(); }
  });

  it('walks from dry sand to the far end of the Baa-ardwalk without a rescue', async () => {
    const game = await Game.create();
    try {
      const decks = game.island.props.filter(p => p.poiId === 'baa-ardwalk' && p.kind === 'pier');
      const [entrance, wheel] = decks;
      expect(decks).toHaveLength(2);
      const x = entrance!.transform.position.x - 4;
      const start = entrance!.transform.position.z - entrance!.size.z / 2 - 3;
      const finish = wheel!.transform.position.z + wheel!.size.z / 2 - 2;
      expect(finish).toBeGreaterThan(game.island.size * .57);
      standAt(game, x, start);
      for (let z = start + 6; z < finish; z += 6) {
        walkTo(game, { x, z });
        expect(game.location).toBe('Baa-ardwalk');
      }
      walkTo(game, { x, z: finish });
      expect(game.respawns).toBe(0);
      expect(game.goat.torso.translation().z).toBeGreaterThan(finish - .65);
      expect(game.location).toBe('Baa-ardwalk');
      const mapSvg = renderHudMinimap(game.island, { x, z: finish });
      expect(mapSvg.match(/data-pier-deck/g)).toHaveLength(decks.length);

      // The exception must stay on the pier, even at the same offshore Z.
      game.teleport(V(x + wheel!.size.x, game.goat.torso.translation().y, finish), 0);
      expect(game.location).toBe('Billy Isle');
      game.step();
      expect(game.respawns).toBe(1);

      const bounce = game.surfaceMarkers.find(surface =>
        surface.kind === 'trampoline' && surface.hasWorldArt)!;
      expect(bounce.id).toMatch(/^baa-ardwalk-art-trampoline-/);
      const { position, halfExtents } = bounce;
      game.teleport(V(position.x, position.y + halfExtents.y + 1.1, position.z));
      let playerBounce = false;
      const offBounce = game.surfaces.events.on(event => {
        if (event.type === 'bounce' && event.surfaceId === bounce.id &&
            game.goat.ownsBody(event.bodyHandle)) playerBounce = true;
      });
      let peak = 0;
      for (let tick = 0; tick < 80; tick++) {
        game.step();
        peak = Math.max(peak, game.goat.torso.linvel().y);
      }
      offBounce();
      expect(playerBounce).toBe(true);
      expect(peak).toBeGreaterThan(3);
    } finally { game.dispose(); }
  });

  it('keeps the lighthouse bridge above the cliff along the uphill lane', async () => {
    const game = await Game.create();
    try {
      const start = { x: -235.77, z: -13.68 };
      const finish = { x: -238.81, z: -14.74 };
      standAt(game, start.x, start.z);

      const terrainHandle = game.colliders.terrain.handle;
      const bridgeHandles = new Set([...game.colliders.props]
        .filter(([id]) => id.startsWith('bridge-whispering-pines--old-lighthouse-'))
        .map(([, collider]) => collider.handle));
      const dx = finish.x - start.x, dz = finish.z - start.z;
      const length = Math.hypot(dx, dz);
      for (const t of [.14, .35, .6, .85, 1]) {
        for (const offset of [0, -1.7, 1.7]) {
          const x = start.x + t * dx - offset * dz / length;
          const z = start.z + t * dz + offset * dx / length;
          const origin = V(x, 30, z), down = V(0, -1, 0);
          const terrain = game.physics.raycast(origin, down, 60, {
            predicate: collider => collider.handle === terrainHandle,
          });
          const deck = game.physics.raycast(origin, down, 60, {
            predicate: collider => bridgeHandles.has(collider.handle),
          });
          expect(deck, `bridge at (${x.toFixed(2)}, ${z.toFixed(2)})`).not.toBeNull();
          expect(terrain, `terrain at (${x.toFixed(2)}, ${z.toFixed(2)})`).not.toBeNull();
          expect(terrain!.point.y, `cliff at (${x.toFixed(2)}, ${z.toFixed(2)})`)
            .toBeLessThan(deck!.point.y);
        }
      }

      walkTo(game, finish);
      expect(game.respawns).toBe(0);
    } finally { game.dispose(); }
  });

  it('walks the Old Lighthouse bridge in both directions without jumping', async () => {
    const game = await Game.create();
    try {
      const road = game.island.roads.find(r => r.to === 'old-lighthouse')!;
      const first = road.points.findIndex(p => p.bridge);
      const last = road.points.reduce((index, p, i) => p.bridge ? i : index, -1);
      expect(first).toBeGreaterThan(0);
      expect(last).toBeGreaterThan(first);
      const route = road.points.slice(Math.max(0, first - 2), last + 3);
      standAt(game, route[0]!.x, route[0]!.z);
      for (const point of route.slice(1)) walkTo(game, point);
      for (const point of route.slice(0, -1).reverse()) walkTo(game, point);
      expect(game.respawns).toBe(0);
    } finally { game.dispose(); }
  });
});

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
