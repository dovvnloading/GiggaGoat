import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TUNING } from '../gameplay';
import { V } from '../physics';
import { heightAt } from '../world';
import { BuildPlacementGhost } from './BuildPlacementGhost';
import { Game } from './Game';

describe('Hay-Build placement preview', () => {
  it('shows exactly what the build input places and uses the same blocked reasons', async () => {
    const game = await Game.create({ resolution: 97 });
    try {
      expect(game.buildPreview()).toBeNull();
      const inventory = game.rules.inventory.all;
      const cameraYaw = 0;
      game.advance(0, { toggleBuild: true, buildPiece: 'ramp', cameraYaw });
      const preview = game.buildPreview()!;
      expect(preview.validation.valid).toBe(true);
      expect(preview.placement.type).toBe('ramp');
      expect(game.buildPreview()).toEqual(preview);
      expect(game.rules.inventory.all).toEqual(inventory);
      expect(game.rules.build.size).toBe(0);

      game.advance(0, { placeBuild: true, cameraYaw });
      const [piece] = game.rules.build.pieces;
      expect(piece).toMatchObject(preview.placement);
      expect(game.buildPosition(piece!)).toEqual(preview.position);
      const body = game.buildBodies.get(piece!.id)!;
      expect(body.translation()).toMatchObject({
        x: expect.closeTo(preview.position.x, 4),
        y: expect.closeTo(preview.position.y, 4),
        z: expect.closeTo(preview.position.z, 4),
      });
      expect(game.rules.inventory.all).toEqual({
        hay: inventory.hay - TUNING.build.cost.ramp.hay,
        wood: inventory.wood - TUNING.build.cost.ramp.wood,
        scrap: inventory.scrap,
      });

      const occupied = game.buildPreview()!;
      expect(occupied.position).toEqual(preview.position);
      expect(occupied.validation).toEqual({ valid: false, reason: 'overlap' });
      const after = game.rules.inventory.all;
      game.advance(0, { placeBuild: true, cameraYaw });
      expect(game.rules.build.size).toBe(1);
      expect(game.rules.inventory.all).toEqual(after);

      const reverse = game.buildPreview(Math.PI)!;
      expect(reverse.placement.cell).not.toEqual(preview.placement.cell);
      expect(reverse.validation.valid).toBe(true);
      game.rules.inventory.spend(game.rules.inventory.all);
      expect(game.buildPreview(Math.PI)?.validation).toEqual({ valid: false, reason: 'cost' });

      game.advance(0, { toggleBuild: true });
      expect(game.buildPreview()).toBeNull();
    } finally {
      game.dispose();
    }
  });

  it('blocks a wall around a party goat in the preview and on placement', async () => {
    const game = await Game.create();
    try {
      game.party.start('hay-heist', 3, 'normal');
      const bot = game.party.bots.get('bot-1')!.goat;
      const { x, y, z } = bot.torso.translation();
      const cameraYaw = Math.PI / 2;
      // This quarter-turn puts the thin dimension of the wall on world Z.
      // Aim from the side so the snapped wall crosses the bot's torso.
      const grid = TUNING.build.gridSize;
      const targetX = Math.round(x / grid) * grid, targetZ = Math.round(z / grid) * grid;
      const dz = targetZ - z;
      for (const body of bot.bodies) {
        const p = body.translation();
        body.setTranslation(V(p.x, p.y, p.z + dz), true);
      }
      game.teleport(V(targetX - 4.5, y - .92 * bot.size, targetZ), -cameraYaw);
      game.advance(0, { toggleBuild: true, buildPiece: 'wall', cameraYaw });
      const preview = game.buildPreview()!;
      expect(preview.position.x).toBe(targetX);
      expect(preview.position.z).toBe(targetZ);
      expect(preview.validation).toEqual({ valid: false, reason: 'overlap' });
      const stock = game.rules.inventory.all;
      game.advance(0, { placeBuild: true, cameraYaw });
      expect(game.rules.inventory.all).toEqual(stock);
      expect(game.buildBodies.size).toBe(0);
    } finally { game.dispose(); }
  });

  it('checks the live player pose and the solid side of a ramp before an edit spends materials', async () => {
    const game = await Game.create();
    try {
      const cell = { x: 20, y: 0, z: 20 };
      const ramp = { type: 'ramp', cell, rotation: 0 } as const;
      const centre = game.buildPosition(ramp);
      const floor = game.rules.build.place({ ...ramp, type: 'floor' }).piece!;
      // Between ticks the goat can warp into the ramp's bounding box, above
      // its low end. Turning the same ramp around puts its high end here.
      game.teleport(V(centre.x, centre.y + .12, centre.z - .64), 0);
      expect(game.rules.build.validatePlacement(ramp, floor.id).valid).toBe(true);
      const stock = game.rules.inventory.all;
      expect(game.rules.build.edit(floor.id, { type: 'ramp', rotation: 2 }).validation)
        .toEqual({ valid: false, reason: 'overlap' });
      expect(game.rules.inventory.all).toEqual(stock);
      expect(game.rules.build.getPiece(floor.id)).toEqual(floor);
      expect(game.rules.build.edit(floor.id, ramp).validation.valid).toBe(true);
    } finally { game.dispose(); }
  });

  it('plants a remote floor against local terrain and saves its height alongside an older build', async () => {
    const game = await Game.create();
    try {
      const legacy = game.rules.build.place({ type: 'floor', cell: { x: -85, y: 0, z: 56 }, rotation: 0 }).piece!;
      const oldPose = game.buildBodies.get(legacy.id)!.translation();
      const x = 210, z = -91.5;
      game.teleport(V(x, heightAt(game.island, x, z), z), 0);
      for (let tick = 0; tick < 45; tick++) game.step({ cameraYaw: 0 });
      game.advance(0, { toggleBuild: true, buildPiece: 'floor', cameraYaw: 0 });

      const preview = game.buildPreview()!;
      expect(preview.placement.cell).toEqual({ x: 105, y: 0, z: -48 });
      expect(preview.validation.valid).toBe(true);
      const surface = game.physics.raycast(V(210, 20, -96), V(0, -1, 0), 22);
      expect(surface!.point.y).toBeGreaterThan(3);
      expect(preview.position.y - .23 - surface!.point.y).toBeGreaterThanOrEqual(-.01);
      expect(preview.position.y - .23 - surface!.point.y).toBeLessThan(.4);

      game.advance(0, { placeBuild: true, cameraYaw: 0 });
      const placed = game.rules.build.pieces.at(-1)!;
      expect(placed).toMatchObject(preview.placement);
      const restored = await Game.create({ progress: game.exportProgress() });
      try {
        expect(restored.buildBodies.get(legacy.id)!.translation()).toEqual(oldPose);
        expect(restored.buildBodies.get(placed.id)!.translation()).toEqual(game.buildBodies.get(placed.id)!.translation());
        expect(restored.rules.inventory.all).toEqual(game.rules.inventory.all);
      } finally {
        restored.dispose();
      }
    } finally {
      game.dispose();
    }
  });

  it('uses the built launch pad as the only solid surface and launches the goat on contact', async () => {
    const game = await Game.create();
    try {
      const x = 210, z = -91.5;
      game.teleport(V(x, heightAt(game.island, x, z), z), 0);
      for (let tick = 0; tick < 40; tick++) game.step({ cameraYaw: 0 });
      game.advance(0, { toggleBuild: true, buildPiece: 'launch-pad', cameraYaw: 0 });
      const preview = game.buildPreview()!;
      expect(preview.validation.valid).toBe(true);
      game.step({ placeBuild: true, cameraYaw: 0 });

      const pad = game.rules.build.pieces.at(-1)!;
      const point = preview.position;
      const hit = game.physics.raycast(V(point.x, point.y + 4, point.z), V(0, -1, 0), 6);
      expect(hit?.body?.handle).toBe(game.buildBodies.get(pad.id)?.handle);
      expect(hit?.point.y).toBeCloseTo(point.y + .23, 5);
      const launches: string[] = [];
      game.surfaces.events.on(event => {
        if (event.type === 'launch' && event.bodyHandle === game.goat.torso.handle) {
          launches.push(event.surfaceId);
        }
      });

      const approachZ = point.z + 2.15;
      game.teleport(V(point.x, heightAt(game.island, point.x, approachZ), approachZ), 0);
      let highest = game.goat.torso.translation().y;
      for (let tick = 0; tick < 110; tick++) {
        const advance = game.goat.torso.translation().z > point.z + .15;
        game.step({ cameraYaw: 0, moveZ: advance ? .65 : 0, jump: tick === 23 });
        highest = Math.max(highest, game.goat.torso.translation().y);
      }
      expect(launches).toEqual(['hay-' + pad.id]);
      expect(highest).toBeGreaterThan(point.y + 5);
      expect(game.goat.isRagdoll).toBe(false);
    } finally {
      game.dispose();
    }
  });

  it.each([0, 1, 2, 3] as const)('launches along the built arrow at quarter turn %i', async rotation => {
    const game = await Game.create();
    try {
      const cameraYaw = -rotation * Math.PI / 2;
      // Aim at the same unobstructed cell from each side.
      const x = 210 - Math.sin(cameraYaw) * 4.5, z = -96 + Math.cos(cameraYaw) * 4.5;
      game.teleport(V(x, heightAt(game.island, x, z), z), -cameraYaw);
      for (let i = 0; i < 40; i++) game.step({ cameraYaw });
      game.advance(0, { toggleBuild: true, buildPiece: 'launch-pad', cameraYaw });
      const preview = game.buildPreview(cameraYaw)!;
      expect(preview.placement.rotation).toBe(rotation);
      expect(preview.validation.valid).toBe(true);
      game.advance(0, { placeBuild: true, cameraYaw });
      const piece = game.rules.build.pieces.at(-1)!;
      expect(piece).toMatchObject(preview.placement);
      const p = game.buildPosition(piece);
      game.teleport(V(p.x, p.y + 1.2, p.z), 0);
      let velocity: { x: number; z: number } | undefined;
      game.surfaces.events.on(e => {
        if (e.type === 'launch' && e.surfaceId === 'hay-' + piece.id) velocity = game.goat.torso.linvel();
      });
      for (let tick = 0; tick < 90 && !velocity; tick++) game.step();
      expect(velocity).toBeDefined();
      const yaw = rotation * Math.PI / 2;
      expect(-velocity!.x * Math.sin(yaw) - velocity!.z * Math.cos(yaw)).toBeGreaterThan(4);
      expect(Math.abs(velocity!.x * Math.cos(yaw) - velocity!.z * Math.sin(yaw))).toBeLessThan(.7);
    } finally { game.dispose(); }
  });

  it('tracks quarter-turn orientation and changes color and visibility for a blocked shape', () => {
    const ghost = new BuildPlacementGhost();
    try {
      expect(ghost.root.visible).toBe(false);
      const placement = { type: 'ramp', cell: { x: 1, y: 0, z: 2 }, rotation: 3 } as const;
      const position = { x: 2, y: 1, z: 4 };
      ghost.update({ placement, position, validation: { valid: true, snapped: placement } });
      const body = ghost.root.getObjectByName('build-preview-body') as THREE.Mesh;
      const material = body.material as THREE.MeshBasicMaterial;
      expect(ghost.root.visible).toBe(true);
      expect(ghost.root.position).toMatchObject(position);
      expect(ghost.root.rotation.y).toBeCloseTo(3 * Math.PI / 2);
      expect(ghost.root.getObjectByName('build-preview-orientation')?.rotation.y).toBe(Math.PI);
      expect(body.geometry.getAttribute('position').count).toBe(6);
      const ready = material.color.getHex();

      ghost.update({ placement, position, validation: { valid: false, reason: 'overlap' } });
      expect(material.color.getHex()).not.toBe(ready);
      const wire = ghost.root.children.find(child => child instanceof THREE.LineSegments)!;
      expect((wire.material as THREE.LineBasicMaterial).depthTest).toBe(false);
      ghost.update(null);
      expect(ghost.root.visible).toBe(false);
    } finally {
      ghost.dispose();
    }
  });
});
