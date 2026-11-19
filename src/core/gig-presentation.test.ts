import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GigDirector } from '../gigs';
import { V } from '../physics';
import { Game } from './Game';
import { GameView } from './GameView';
import { frame, goat, readyMatch } from '../modes/test-utils';
import {
  createSummitTrailMarker, hayHaulGuidance, hayHeistGuidance, gigMapPoint, separateMapObjective,
} from './GigPresentation';

describe('Summit Sprint wayfinding', () => {
  it('keeps the painted ring within the trail and follows the grade at every vertex', () => {
    const ground = (x: number, z: number): number => 24 + .42 * x - .17 * z;
    const marker = createSummitTrailMarker({ x: 25, y: 30, z: -3 }, 1.1, 1, false, ground);
    const paint = marker.getObjectByName('summit-trail-paint') as THREE.Mesh;
    const flag = marker.getObjectByName('summit-trail-flag') as THREE.Mesh;
    const vertices = paint.geometry.getAttribute('position');
    marker.updateMatrixWorld(true);
    expect(marker.children).toEqual([paint, flag]);
    expect(marker.position.y).toBeCloseTo(ground(25, -3));
    expect(flag.rotation.y).toBeCloseTo(1.1);
    for (let i = 0; i < vertices.count; i++) {
      const local = new THREE.Vector3().fromBufferAttribute(vertices, i);
      expect(Math.hypot(local.x, local.z)).toBeLessThan(1.15);
      const world = paint.localToWorld(local);
      expect(world.y - ground(world.x, world.z)).toBeCloseTo(.065, 5);
    }
  });
});

describe('Splash contract wayfinding', () => {
  it.each(['splash-dive', 'dam-bomb'] as const)(
    'switches %s from the approach label to the water target and resets on a retry', async id => {
      const game = await Game.create({ resolution: 97 });
      const markers = new THREE.Group();
      const view = Object.assign(Object.create(GameView.prototype) as {
        updateGigVisuals(alpha: number): void;
      }, {
        game, displayedGig: -1, gigMarkers: markers, gigProps: new Map(), textTextures: new Set(),
        input: { device: 'keyboard-mouse' },
        textSprite: (caption: string) => {
          const sprite = new THREE.Sprite();
          sprite.userData['caption'] = caption;
          return sprite;
        },
      });
      const update = (): void => view.updateGigVisuals(0);
      const visible = (): string[] => {
        const names: string[] = [];
        markers.traverseVisible(object => {
          if (object instanceof THREE.Sprite || object instanceof THREE.Mesh) names.push(object.name);
        });
        return names;
      };
      const boardId = game.gigs.catalog.info(id).poiId;
      const board = game.gigs.boards.find(entry => entry.poiId === boardId)!;
      try {
        game.teleport(board.position);
        game.step();
        game.gigs.accept(game.gigs.board(boardId).find(offer => offer.gigId === id)!.id);
        const run = game.gigs.active!;
        const config = run.setup.config;
        if (config.kind !== 'splash-dive') throw new Error('Expected a dive contract');
        update();
        expect(visible()).toEqual(['splash-dive-launch']);
        expect(markers.getObjectByName('splash-dive-launch')?.userData['caption'])
          .toBe(id === 'dam-bomb' ? 'FLOP FROM HERE' : 'LEAP SEAWARD');

        const tick = (position = config.jumpPoint): void => {
          game.gigs.director.step({ goat: { position, size: 1, grounded: true }, props: [] });
        };
        tick();
        update();
        expect(game.gigs.active?.objective).toMatchObject({ kind: 'splash', launchReached: true });
        expect(visible()).toEqual(['splash-dive-water-direction', 'splash-dive-water-target']);

        const water = markers.getObjectByName('splash-dive-water-target') as
          THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
        expect(water.position.toArray()).toEqual([config.landing.x, config.waterY + .31, config.landing.z]);
        expect(water.renderOrder).toBeGreaterThan(2);
        expect(water.material).toMatchObject({ depthTest: true, depthWrite: false, forceSinglePass: true });
        water.geometry.computeBoundingSphere();
        expect(water.geometry.boundingSphere?.radius).toBeCloseTo(3.6);
        const direction = markers.getObjectByName('splash-dive-water-direction')!;
        direction.updateWorldMatrix(true, false);
        const tip = direction.localToWorld(new THREE.Vector3(0, 0, -.44));
        const from = config.jumpPoint;
        const to = config.landing;
        expect((tip.x - from.x) * (to.x - from.x) + (tip.z - from.z) * (to.z - from.z))
          .toBeCloseTo(.44 * Math.hypot(to.x - from.x, to.z - from.z));

        const oldSave = game.gigs.director.toJSON();
        if (oldSave.run?.objective.kind === 'splash') delete oldSave.run.objective.launchReached;
        const restore = GigDirector.fromJSON(oldSave, game.gigs.catalog);
        const savedGame = {
          ...view, game: { ...game, gigs: { ...game.gigs, active: restore.active } },
          gigMarkers: new THREE.Group(), displayedGig: -1, gigProps: new Map(),
        };
        const restored = Object.assign(Object.create(GameView.prototype) as typeof view, savedGame);
        restored.updateGigVisuals(0);
        expect(restored.gigMarkers.getObjectByName('splash-dive-launch')?.visible).toBe(false);
        expect(restored.gigMarkers.getObjectByName('splash-dive-landing')?.visible).toBe(true);

        for (let tickIndex = 0; tickIndex < run.setup.maxTicks; tickIndex++) tick();
        update();
        expect(game.gigs.active?.status).toBe('failed');
        expect(visible()).toEqual([]);
        game.gigs.retryFailed();
        update();
        expect(visible()).toEqual(['splash-dive-launch']);
        expect(game.gigs.active?.objective).toMatchObject({ launchReached: false });
      } finally {
        game.dispose();
      }
    },
  );
});

describe('Hay Heist wayfinding', () => {
  it('points to the nearest available rival bale, then the team goal during a real delivery', () => {
    const match = readyMatch({ mode: 'hay-heist', config: { hayPerTeam: 2, hayTargetScore: 1 } },
      ['player', 'rival', 'teammate']);
    const [closest, other] = match.bales.filter(bale => bale.homeTeam === 'blue');
    const ownGoal = match.view().arena.barns.find(barn => barn.teamId === 'red')!.position;
    const position = closest!.position;
    const waypoint = () => hayHeistGuidance(match, position, 'player');
    const at = (id: string, point: typeof position) => goat(id, point.x, point.z, point.y + 1);
    const teammate = at('teammate', position);
    const rival = goat('rival');

    expect(waypoint()).toEqual({ kind: 'pickup', position, teamId: 'blue' });
    match.step({ ...frame(at('player', position), rival, teammate),
      intents: { teammate: { tongue: true } } });
    expect(waypoint()).toEqual({ kind: 'pickup', position: other!.position, teamId: 'blue' });

    const intents = { player: { tongue: true }, teammate: { tongue: true } };
    match.step({ ...frame(at('player', other!.position), rival, teammate), intents });
    expect(waypoint()).toEqual({ kind: 'delivery', position: ownGoal, teamId: 'red' });

    match.step({ ...frame(at('player', ownGoal), rival, teammate), intents });
    expect(match.phase).toBe('results');
    expect(waypoint()).toBeNull();
  });
});

describe('Hay Haul wayfinding', () => {
  it('tracks moved bales, gives the pickup input, and switches to the barn only for a tagged bale', async () => {
    const game = await Game.create({ resolution: 97 });
    try {
      expect(hayHaulGuidance(game, null)).toBeNull();
      const { config } = game.gigs.director.startPractice('hay-haul', 'easy');
      if (config.kind !== 'hay-haul') throw new Error('Expected Hay Haul');
      const run = game.gigs.active!;
      const position = game.goat.torso.translation();
      const bodies = config.bales.map(bale => game.colliders.bodies.get(bale.id)!);
      expect(hayHaulGuidance(game, run)?.task).toBe('Find a bale on the map');
      const head = game.goat.head.translation();
      const target = V(head.x, head.y, head.z - 3);
      bodies[0]!.setTranslation(target, true);
      game.physics.raw.propagateModifiedBodyPositionsToColliders();
      game.physics.raw.step();
      const physicsPosition = bodies[0]!.translation();
      expect(hayHaulGuidance(game, run)).toEqual({
        kind: 'pickup',
        position: physicsPosition,
        task: 'Hold RMB to lick',
      });
      expect(hayHaulGuidance(game, run, 'gamepad')?.task).toBe('Hold LB or LT to lick');
      expect(game.goat.interactions.attachTongue(V(
        target.x - game.goat.head.translation().x,
        target.y - game.goat.head.translation().y,
        target.z - game.goat.head.translation().z,
      ))).toBe(true);
      expect(game.goat.interactions.tongueBody?.handle).toBe(bodies[0]!.handle);
      expect(hayHaulGuidance(game, run)?.task).toBe('Release and re-lick');

      run.seenIds.push(config.bales[0]!.id);
      expect(hayHaulGuidance(game, run)).toEqual({
        kind: 'delivery',
        position: config.barn,
        task: 'Drag bale to barn drop',
      });

      run.finishedIds.push(config.bales[0]!.id);
      expect(hayHaulGuidance(game, run)?.kind).toBe('pickup');
      run.status = 'completed';
      expect(hayHaulGuidance(game, run)).toBeNull();
      expect(Math.hypot(physicsPosition.x - position.x, physicsPosition.z - position.z)).toBeLessThan(6);
    } finally {
      game.dispose();
    }
  });

  it('keeps positions within the map or at its rim along the correct bearing', () => {
    const origin = { x: 0, z: 0 };
    expect(gigMapPoint(V(0, 0, 0), origin)).toEqual({ x: 140, y: 140 });
    expect(gigMapPoint(V(10, 0, 0), origin)).toEqual({ x: 150.5, y: 140 });
    const rim = gigMapPoint(V(0, 0, -400), origin);
    expect(rim.x).toBe(140);
    expect(rim.y).toBeCloseTo(32);
  });

  it('keeps nearby pickup and drop badges clear of the player and within the rim', () => {
    const center = { x: 140, y: 140 };
    const far = { x: 140, y: 82 };
    expect(separateMapObjective(far, center)).toBe(far);
    expect(separateMapObjective({ x: 145, y: 140 }, center)).toEqual({ x: 180, y: 140 });
    expect(separateMapObjective(center, center)).toEqual({ x: 180, y: 140 });
    const player = { x: 240.8, y: 140 };
    const rim = { x: 248, y: 140 };
    const badge = separateMapObjective(rim, player);
    expect(Math.hypot(badge.x - player.x, badge.y - player.y)).toBeCloseTo(40);
    expect(Math.hypot(badge.x - center.x, badge.y - center.y)).toBeCloseTo(108);
    expect(separateMapObjective(rim, player)).toEqual(badge);
    expect(rim).toEqual({ x: 248, y: 140 });
  });
});
