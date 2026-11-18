import * as THREE from 'three';
import { expect, it } from 'vitest';
import { MODE_DEFAULTS } from '../modes';
import type { Collider } from '@dimforge/rapier3d-compat';
import { InstancedPropRenderer, PropFactory } from '../props';
import { Game } from './Game';
import { GameView } from './GameView';

interface BoardMarkerView {
  createBoardMarkers(): void;
  updateBoardMarkers(): void;
  clearGroup(group: THREE.Group): void;
}

it('keeps the summit board clear of capture and restores the free-roam boards after party results', async () => {
  const game = await Game.create();
  const scene = new THREE.Scene();
  const boardRoots: THREE.Group[] = [];
  const boardMarkers = new THREE.Group();
  const instancedProps = new InstancedPropRenderer(scene);
  const propFactory = new PropFactory({ loadModel: async () => {
    const asset = new THREE.Group();
    asset.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    return asset;
  } });
  // The actual marker methods and instanced batches run without the WebGL constructor.
  const view: BoardMarkerView = Object.assign(Object.create(GameView.prototype), {
    game, scene, boardRoots, boardMarkers, instancedProps, propFactory,
    textSprite(label: string, width: number, height: number, y: number): THREE.Sprite {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
      sprite.userData['label'] = label;
      sprite.scale.set(width, height, 1);
      sprite.position.y = y;
      return sprite;
    },
  });
  const boardStage = (visible: boolean): number => {
    view.updateBoardMarkers();
    instancedProps.update();
    expect(boardMarkers.visible).toBe(visible);
    expect(boardRoots.every(root => root.visible === visible)).toBe(true);
    return (instancedProps.group.children as THREE.InstancedMesh[])
      .reduce((sum, batch) => sum + batch.count, 0);
  };
  try {
    view.createBoardMarkers();
    expect(boardRoots).toHaveLength(game.gigs.boards.length);
    const freeRoamCount = boardStage(true);
    expect(freeRoamCount).toBeGreaterThan(boardRoots.length);
    const board = game.gigs.boards.find(entry => entry.poiId === 'mt-gigga')!.position;
    const root = boardRoots.find(entry => entry.position.x === board.x && entry.position.z === board.z)!;
    const cue = boardMarkers.children.find(entry => entry.position.equals(root.position))!.children[0]!;
    expect(cue.userData['label']).toBe('E · GIGS');
    expect(cue.position.y).toBeGreaterThan(2.5);
    const summit = game.island.pois.find(entry => entry.id === 'mt-gigga')!.center;
    const boardBox = new THREE.Box3().setFromObject(root);
    expect(boardBox.getSize(new THREE.Vector3()).y).toBeLessThan(2.6);
    const nearestCorner = boardBox.clampPoint(new THREE.Vector3().copy(summit), new THREE.Vector3());
    expect(Math.hypot(nearestCorner.x - summit.x, nearestCorner.z - summit.z))
      .toBeGreaterThan(MODE_DEFAULTS.peakRadius + 3);

    const trail = game.island.roads.find(road => road.id === 'mt-gigga--hoofington')!;
    const distance = (p: { x: number; z: number }): number => Math.hypot(p.x - board.x, p.z - board.z);
    const shoulder = trail.points.reduce((best, point) => distance(point) < distance(best) ? point : best);
    const onTrail = trail.points.indexOf(shoulder);
    expect(distance(shoulder) - trail.width / 2).toBeGreaterThan(3);
    const start = trail.points[onTrail + 18]!;
    const target = { x: board.x + 1.2, z: board.z - 1.65 };
    const filter = { predicate: (collider: Collider) =>
      !game.goat.ownsBody(collider.parent()) };
    const floorAt = (point: { x: number; z: number }): number => {
      const hit = game.physics.raycast({ x: point.x, y: 160, z: point.z }, { x: 0, y: -1, z: 0 }, 180, filter);
      expect(hit).not.toBeNull();
      return hit!.point.y;
    };
    game.step();
    expect(Math.abs(floorAt(board) - boardBox.min.y)).toBeLessThan(.08);

    const eye = new THREE.Vector3(shoulder.x, floorAt(shoulder) + 1, shoulder.z);
    const notice = new THREE.Vector3(board.x, board.y + 1.9, board.z);
    const direction = notice.clone().sub(eye).normalize();
    expect(new THREE.Vector3(0, 0, 1).applyEuler(root.rotation).dot(direction) * -1).toBeGreaterThan(.9);
    expect(game.physics.raycast(eye, direction, eye.distanceTo(notice) - .1, filter)).toBeNull();
    expect(new THREE.Raycaster(eye, direction).intersectObject(root)).not.toHaveLength(0);

    game.teleport({ x: start.x, y: floorAt(start), z: start.z },
      -Math.atan2(target.x - shoulder.x, shoulder.z - target.z));
    for (let tick = 0; tick < 40; tick++) game.step();
    expect(game.gigs.nearBoard()).toBeNull();
    const route = trail.points.slice(onTrail, onTrail + 18).reverse().filter((_, index) => index % 3 === 0);
    for (const waypoint of [...route, shoulder, target]) {
      let tick = 0;
      for (; tick < 140; tick++) {
        const p = game.goat.torso.translation();
        if (Math.hypot(waypoint.x - p.x, waypoint.z - p.z) < .8) break;
        game.step({ moveZ: 1, cameraYaw: Math.atan2(waypoint.x - p.x, p.z - waypoint.z) });
      }
      expect(tick).toBeLessThan(140);
    }
    expect(game.respawns).toBe(0);
    expect(game.gigs.nearBoard(8.75)).toBe('mt-gigga');
    expect(game.gigs.board('mt-gigga').some(offer => offer.gigId === 'summit-sprint')).toBe(true);

    const match = game.party.start('king-of-the-peak', 3, 'easy', {
      countdownTicks: 2, durationTicks: 80, overtimeTicks: 2, peakRadius: MODE_DEFAULTS.peakRadius,
    });
    expect(match.view().arena.summit).toEqual(summit);
    expect(match.view().config.peakRadius).toBe(MODE_DEFAULTS.peakRadius);
    expect(match.phase).toBe('countdown');
    expect(boardStage(false)).toBe(0);
    game.step();
    game.step();
    expect(match.phase).toBe('playing');
    expect(boardStage(false)).toBe(0);
    expect(game.gigs.nearBoard()).toBeNull();
    for (let tick = 0; tick < 90 && match.phase !== 'results'; tick++) game.step();
    expect(match.phase).toBe('results');
    expect(boardStage(false)).toBe(0);
    expect(game.gigs.nearBoard()).toBeNull();

    game.party.returnToFreeRoam();
    expect(boardStage(true)).toBe(freeRoamCount);
    expect(game.gigs.nearBoard()).toBe('mt-gigga');
  } finally {
    view.clearGroup(boardMarkers);
    instancedProps.dispose();
    propFactory.dispose();
    game.dispose();
  }
});
