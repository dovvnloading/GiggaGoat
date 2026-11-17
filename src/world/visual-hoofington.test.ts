import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import {
  HOOFINGTON_MODELS, bakeHoofingtonGeometry, makeHoofingtonPlacements,
  type HoofModel, type HoofPlacement,
} from './visual-hoofington';

describe('Hoofington sourced village model integration', () => {
  it('references only existing CC0 GLBs without editing the library or credits', () => {
    const manifest = JSON.parse(readFileSync(
      'public/assets/library/manifest.json', 'utf8',
    )) as Array<{ path: string; license: string }>;
    for (const [model, path] of Object.entries(HOOFINGTON_MODELS)) {
      expect(path.endsWith('.glb'), model).toBe(true);
      expect(manifest.find(entry => entry.path === path)?.license, model).toBe('CC0');
    }
    expect(HOOFINGTON_MODELS.pinkHome).toContain('city-kit-suburban');
    expect(HOOFINGTON_MODELS.farmhouse).toContain('medieval-village-pack');
    expect(HOOFINGTON_MODELS.windmill).toContain('farm-buildings-bundle');
    expect(HOOFINGTON_MODELS.bush).toContain('stylized-nature-megakit');
  });

  it('maps the painting\'s foreground colours and rear landmarks to the same colliders', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const plan = makeHoofingtonPlacements(island);
    const linked = plan.filter(p => p.source);
    const kinds = new Set(linked.map(p => p.source!.kind));
    for (const kind of ['house', 'cottage', 'barn', 'silo', 'windmill',
      'fence', 'mailbox', 'gnome', 'trampoline', 'bench', 'lamp']) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
    const homes = linked.filter(p => p.source!.kind === 'house');
    expect(homes.length).toBeGreaterThanOrEqual(5);
    expect(homes.some(p => p.model === 'pinkHome' && p.wall === 0xf28fb5)).toBe(true);
    expect(homes.some(p => p.model === 'creamHome' && p.roof === 0xc85842)).toBe(true);
    expect(homes.some(p => p.model === 'yellowHome')).toBe(true);
    expect(linked.filter(p => p.source!.kind === 'barn')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'silo')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'windmill')).toHaveLength(1);
    expect(plan.filter(p => p.model === 'cow' || p.model === 'sheep' ||
      p.model === 'pig' || p.model === 'horse').length).toBeGreaterThanOrEqual(5);
    expect(plan.filter(p => p.model === 'planter').length).toBeGreaterThan(5);
    for (const placement of linked) {
      // The model uses the original world transform and exactly the existing
      // collider descriptor's dimensions. No extra island props are invented.
      expect(placement.position).toBe(placement.source!.transform.position);
      expect(placement.size).toBe(placement.source!.size);
      expect(placement.yaw).toBe(placement.source!.transform.rotationY);
    }
    const repeat = makeHoofingtonPlacements(island);
    expect(plan.map(p => [p.model, p.position, p.yaw, p.wall, p.roof]))
      .toEqual(repeat.map(p => [p.model, p.position, p.yaw, p.wall, p.roof]));
  });

  it('bakes multiple source materials into one rooftop-aligned, vertex-coloured draw', () => {
    const template = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff }));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.5, 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff }));
    roof.position.y = 1.1;
    template.add(wall, roof);
    const models = new Map<HoofModel, THREE.Group>([['pinkHome', template]]);
    const plan: HoofPlacement[] = [{
      model: 'pinkHome', position: { x: -12, y: 11, z: 30 },
      size: { x: 10, y: 8, z: 9 }, yaw: Math.PI / 2,
      wall: 0xf28fb5, roof: 0x53667f,
    }, {
      model: 'pinkHome', position: { x: 15, y: 12, z: 30 },
      size: { x: 10, y: 9, z: 9 }, yaw: -Math.PI / 2,
      wall: 0xffecdb, roof: 0xc85842,
    }];
    const geometry = bakeHoofingtonGeometry(plan, models)!;
    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(50);
    expect(geometry.getAttribute('color').count)
      .toBe(geometry.getAttribute('position').count);
    expect(geometry.getAttribute('normal').count)
      .toBe(geometry.getAttribute('position').count);
    const bounds = new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute('position') as THREE.BufferAttribute);
    // Even the GLB's pitched roof never pokes through the existing collider's
    // top plane (the old flat Rapier roof stays playable).
    expect(bounds.max.y).toBeLessThan(12 + 9 / 2 + 0.001);
    expect(bounds.min.y).toBeGreaterThan(11 - 8 / 2 - 0.001);
    expect(bounds.min.x).toBeGreaterThan(-12 - 10 / 2 - 0.001);
    expect(bounds.max.x).toBeLessThan(15 + 10 / 2 + 0.001);
    const colors = geometry.getAttribute('color');
    expect(new Set(Array.from({ length: colors.count }, (_, i) =>
      colors.getX(i).toFixed(3) + ',' + colors.getY(i).toFixed(3))).size)
      .toBeGreaterThan(2);
    geometry.dispose();
    wall.geometry.dispose(); roof.geometry.dispose();
    (wall.material as THREE.Material).dispose();
    (roof.material as THREE.Material).dispose();
  });

  it('bakes leafy vegetation as coloured canopy rather than transparent-atlas black', () => {
    const model = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x000000 }));
    leaf.position.y = 0.6;
    model.add(leaf);
    const geometry = bakeHoofingtonGeometry([{
      model: 'bush', position: { x: 0, y: 1, z: 0 },
      size: { x: 2, y: 2, z: 2 }, yaw: 0,
    }], new Map<HoofModel, THREE.Group>([['bush', model]]))!;
    const colors = geometry.getAttribute('color');
    for (let i = 0; i < colors.count; i++) {
      // The source material may be all black while the foliage is intended
      // to be bright green, as with alpha-cutout models from nature atlases.
      expect(colors.getY(i)).toBeGreaterThan(0.2);
    }
    geometry.dispose(); leaf.geometry.dispose();
    (leaf.material as THREE.Material).dispose();
  });

  it('retains one original instance per collider and creates no browser loads in node', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const before = island.props.length;
    const view = createWorldScene(island);
    const group = view.group.getObjectByName('hoofington-library-models');
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group!.children.length).toBe(0);
    for (const kind of ['house', 'cottage', 'barn', 'fence', 'mailbox', 'hay-bale']) {
      const mesh = view.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
      expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(mesh.count).toBe(island.props.filter(p => p.kind === kind).length);
    }
    expect(island.props.length).toBe(before);
    view.dispose();
  });
});
