import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import { gridSample } from './terrain';
import {
  GNOME_STATUE_HEIGHT, HOOFINGTON_MODELS, HOOFINGTON_PALETTE, bakeHoofingtonGeometry,
  createTexturedGnomeInstances, makeHoofingtonPlacements,
  type HoofModel, type HoofPlacement,
} from './visual-hoofington';

describe('Hoofington sourced village model integration', () => {
  it('contains the exact painting-sampled sRGB building palette', () => {
    expect(HOOFINGTON_PALETTE).toEqual({
      pink: { wall: 0xd99ea0, roof: 0x4b4960 },
      red: { wall: 0xaa3f39, roof: 0x6d6b88 },
      cream: { wall: 0xfcdfba, roof: 0xce5c55 },
      yellow: { wall: 0xf2c84b, roof: 0x635f75 },
      shutters: 0x83a9ce,
      mailbox: 0xf54036,
    });
  });

  it('references only existing CC0 GLBs without editing the library or credits', () => {
    const manifest = JSON.parse(readFileSync(
      'public/assets/library/manifest.json', 'utf8',
    )) as Array<{ path: string; license: string }>;
    for (const [model, path] of Object.entries(HOOFINGTON_MODELS)) {
      expect(path.endsWith('.glb'), model).toBe(true);
      if (model === 'gnome') {
        // The new CC0 Meshy asset is present but not yet in the library manifest.
        expect(readFileSync('public/assets/library/meshy/garden-gnome/README.md', 'utf8'))
          .toContain('CC0');
      } else {
        expect(manifest.find(entry => entry.path === path)?.license, model).toBe('CC0');
      }
    }
    expect(HOOFINGTON_MODELS.pinkHome).toContain('city-kit-suburban');
    expect(HOOFINGTON_MODELS.farmhouse).toContain('medieval-village-pack');
    expect(HOOFINGTON_MODELS.windmill).toContain('farm-buildings-bundle');
    expect(HOOFINGTON_MODELS.bush).toContain('stylized-nature-megakit');
  });

  it('selects the CC0 Meshy GLB with a WebP baseColor texture', () => {
    expect(HOOFINGTON_MODELS.gnome)
      .toBe('assets/library/meshy/garden-gnome/garden-gnome.glb');
    const glb = readFileSync('public/' + HOOFINGTON_MODELS.gnome);
    expect(glb.toString('utf8', 0, 4)).toBe('glTF');
    const chunkLength = glb.readUInt32LE(12);
    expect(glb.toString('utf8', 16, 20)).toBe('JSON');
    const asset = JSON.parse(glb.toString('utf8', 20, 20 + chunkLength)) as {
      meshes: Array<{ primitives: Array<{ material: number }> }>;
      materials: Array<{ pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }>;
      textures: Array<{ extensions?: { EXT_texture_webp?: { source: number } } }>;
      images: Array<{ mimeType: string }>;
    };
    expect(asset.meshes).toHaveLength(1);
    expect(asset.meshes[0]?.primitives).toHaveLength(1);
    const materialIndex = asset.meshes[0]!.primitives[0]!.material;
    const textureIndex = asset.materials[materialIndex]?.pbrMetallicRoughness
      ?.baseColorTexture?.index;
    expect(textureIndex).toBeDefined();
    expect(asset.textures[textureIndex!]?.extensions?.EXT_texture_webp?.source)
      .toBe(0);
    expect(asset.images[0]?.mimeType).toBe('image/webp');
  });

  it('instances all gnomes in one textured half-metre draw, on the lawn facing the street', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const placements = makeHoofingtonPlacements(island).filter(p => p.model === 'gnome');
    expect(placements.length).toBeGreaterThan(1);
    expect(placements).toHaveLength(island.props.filter(p =>
      p.kind === 'gnome' && p.poiId === 'hoofington').length);
    const farmX = island.pois.find(p => p.id === 'hoofington')!.center.x;
    const originalMap = new THREE.Texture();
    const originalMaterial = new THREE.MeshStandardMaterial({ map: originalMap });
    const originalGeometry = new THREE.BoxGeometry(0.2, 0.5, 0.2);
    originalGeometry.translate(0, 0.25, 0);
    const model = new THREE.Group();
    model.add(new THREE.Mesh(originalGeometry, originalMaterial));

    const batch = createTexturedGnomeInstances(placements, model, farmX,
      (x, z) => gridSample(island, x, z));
    expect(batch).toBeInstanceOf(THREE.InstancedMesh);
    expect(batch!.count).toBe(placements.length);
    expect(batch!.geometry.getAttribute('uv')).toBeDefined();
    expect(batch!.geometry.getAttribute('color')).toBeUndefined();
    const material = batch!.material as THREE.MeshStandardMaterial;
    expect(material.map).toBeInstanceOf(THREE.Texture);
    expect(material.map).not.toBe(originalMap);
    expect(material.map!.source).toBe(originalMap.source);
    expect(material.vertexColors).toBe(false);
    const matrix = new THREE.Matrix4();
    const bounds = new THREE.Box3();
    const forward = new THREE.Vector3();
    for (let i = 0; i < batch!.count; i++) {
      const placement = placements[i]!;
      batch!.getMatrixAt(i, matrix);
      bounds.setFromBufferAttribute(batch!.geometry.getAttribute('position') as
        THREE.BufferAttribute).applyMatrix4(matrix);
      expect(bounds.max.y - bounds.min.y).toBeCloseTo(GNOME_STATUE_HEIGHT, 5);
      expect(bounds.min.y)
        .toBeCloseTo(gridSample(island, placement.position.x, placement.position.z), 5);
      forward.set(0, 0, 1).transformDirection(matrix);
      expect(forward.x).toBeCloseTo(placement.position.x < farmX ? 1 : -1, 5);
      expect(forward.z).toBeCloseTo(0, 5);
    }
    // An untextured source must keep the procedural fallback, not become a blank statue.
    originalMaterial.map = null;
    expect(createTexturedGnomeInstances(placements, model, farmX, () => 0)).toBeNull();
    batch!.geometry.dispose();
    material.map!.dispose();
    material.dispose();
    originalGeometry.dispose();
    originalMap.dispose();
    originalMaterial.dispose();
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
    expect(homes.some(p => p.model === 'pinkHome' &&
      p.wall === 0xd99ea0 && p.roof === 0x4b4960)).toBe(true);
    expect(homes.some(p => p.model === 'farmhouse' &&
      p.wall === 0xaa3f39 && p.roof === 0x6d6b88)).toBe(true);
    expect(homes.some(p => p.model === 'creamHome' &&
      p.wall === 0xfcdfba && p.roof === 0xce5c55)).toBe(true);
    expect(homes.some(p => p.model === 'yellowHome' &&
      p.wall === 0xf2c84b && p.roof === 0x635f75)).toBe(true);
    const farm = island.pois.find(p => p.id === 'hoofington')!.center;
    for (const home of homes) {
      const left = home.position.x < farm.x;
      const front = home.position.z > farm.z;
      expect(home.model).toBe(left ? (front ? 'pinkHome' : 'farmhouse') :
        (front ? 'creamHome' : 'yellowHome'));
    }
    const barns = linked.filter(p => p.source!.kind === 'barn');
    expect(barns).toHaveLength(1);
    expect(barns[0]?.wall).toBe(0xaa3f39);
    expect(barns[0]?.roof).toBe(0x6d6b88);
    expect(linked.filter(p => p.source!.kind === 'cottage')
      .every(p => p.wall === 0xf2c84b && p.roof === 0x635f75)).toBe(true);
    expect(linked.filter(p => p.source!.kind === 'silo')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'windmill')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'mailbox')
      .every(p => p.wall === 0xf54036 && p.roof === 0xf54036)).toBe(true);
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
      wall: 0xd99ea0, roof: 0x4b4960,
    }, {
      model: 'pinkHome', position: { x: 15, y: 12, z: 30 },
      size: { x: 10, y: 9, z: 9 }, yaw: -Math.PI / 2,
      wall: 0xfcdfba, roof: 0xce5c55,
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

  it('bakes painting hues once to linear vertex colours without grey model tint', () => {
    const part = (name: string, y: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 1),
        new THREE.MeshStandardMaterial({ color: 0x666666 }));
      mesh.name = name;
      mesh.position.y = y;
      return mesh;
    };
    const plaster = part('plaster', -0.7);
    const tiles = part('roof-tiles', 0.7);
    const shutters = part('window-shutters', -0.3);
    const model = new THREE.Group();
    model.add(plaster, tiles, shutters);
    const geometry = bakeHoofingtonGeometry([{
      model: 'pinkHome', position: { x: 0, y: 0, z: 0 },
      size: { x: 8, y: 8, z: 8 }, yaw: 0,
      ...HOOFINGTON_PALETTE.pink,
    }], new Map<HoofModel, THREE.Group>([['pinkHome', model]]))!;
    const colours = geometry.getAttribute('color');
    let offset = 0;
    for (const [mesh, swatch] of [
      [plaster, '#d99ea0'], [tiles, '#4b4960'], [shutters, '#83a9ce'],
    ] as const) {
      const linear = new THREE.Color().setStyle(swatch);
      const count = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count;
      for (let i = offset; i < offset + count; i++) {
        expect(colours.getX(i)).toBeCloseTo(linear.r, 6);
        expect(colours.getY(i)).toBeCloseTo(linear.g, 6);
        expect(colours.getZ(i)).toBeCloseTo(linear.b, 6);
      }
      offset += count;
    }
    expect(colours.count).toBe(offset);
    geometry.dispose();
    for (const mesh of [plaster, tiles, shutters]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }

    const mailbox = part('metal-mailbox', 0);
    const boxModel = new THREE.Group();
    boxModel.add(mailbox);
    const red = bakeHoofingtonGeometry([{
      model: 'mailbox', position: { x: 0, y: 0, z: 0 },
      size: { x: 1, y: 2, z: 1 }, yaw: 0,
      wall: HOOFINGTON_PALETTE.mailbox, roof: HOOFINGTON_PALETTE.mailbox,
    }], new Map<HoofModel, THREE.Group>([['mailbox', boxModel]]))!;
    const redVertices = red.getAttribute('color');
    const redLinear = new THREE.Color().setStyle('#f54036');
    for (let i = 0; i < redVertices.count; i++) {
      expect(redVertices.getX(i)).toBeCloseTo(redLinear.r, 6);
      expect(redVertices.getY(i)).toBeCloseTo(redLinear.g, 6);
      expect(redVertices.getZ(i)).toBeCloseTo(redLinear.b, 6);
    }
    red.dispose();
    mailbox.geometry.dispose();
    (mailbox.material as THREE.Material).dispose();
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
