import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import { gridSample } from './terrain';
import {
  GNOME_STATUE_HEIGHT, HOOFINGTON_MODELS, bakeHoofingtonGeometry,
  createTexturedGnomeInstances, createLanternLampInstances, makeHoofingtonPlacements,
  type HoofModel, type HoofPlacement,
} from './visual-hoofington';

describe('Hoofington sourced village model integration', () => {
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
        expect(manifest.find(entry => entry.path === path)?.license, model)
          .toBe(model === 'lamp' ? 'Apache-2.0' : 'CC0');
      }
    }
    // One building family: painting-palette Kenney suburban houses.
    for (const home of ['pinkHome', 'creamHome', 'yellowHome', 'farmhouse', 'cottage'] as const) {
      expect(HOOFINGTON_MODELS[home], home).toContain('custom/hoofington-houses/');
    }
    expect(HOOFINGTON_MODELS.lamp).toBe('assets/library/usdcraft/street-lamp-lantern.glb');
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

  it('instances the authored lantern parts without tint, paint or height stretch', async () => {
    const source = new THREE.Group();
    const names = ['painted_cast_iron', 'lantern_glass', 'opal_globe', 'brass_burner'];
    for (const name of names) {
      const geometry = new THREE.BoxGeometry(0.45, 3.5, 0.45);
      geometry.translate(0, 1.75, 0);
      const material = new THREE.MeshStandardMaterial({
        color: name === 'painted_cast_iron' ? 0x121315 : 0xffcc66,
        emissive: name === 'lantern_glass' ? 0xffa944 : 0x000000,
      });
      material.name = name;
      source.add(new THREE.Mesh(geometry, material));
    }
    const placements: HoofPlacement[] = [
      { model: 'lamp', position: { x: 10, y: 12, z: 2 },
        size: { x: 0.6, y: 8, z: 0.6 }, yaw: 0, wall: 0xff0000, roof: 0x00ff00 },
      { model: 'lamp', position: { x: 12, y: 14, z: 4 },
        size: { x: 0.6, y: 8, z: 0.6 }, yaw: 0.5 },
    ];
    const batch = (await createLanternLampInstances(placements, source, 600))!;
    batch.updateCulling(new THREE.Vector3(10, 12, 3),
      { intersectsSphere: () => true } as THREE.Frustum);
    const instances = batch.group.children.filter(mesh =>
      mesh.name === 'usdcraft-lantern-near') as THREE.InstancedMesh[];
    expect(instances).toHaveLength(4);
    expect(batch.group.children).toHaveLength(8);
    for (const mesh of instances) {
      expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(mesh.count).toBe(2);
      expect(mesh.geometry.getAttribute('color')).toBeUndefined();
      expect(mesh.instanceColor).toBeNull();
      const material = mesh.material as THREE.MeshStandardMaterial;
      const originalPart = source.children.find(part =>
        ((part as THREE.Mesh).material as THREE.Material).name === material.name);
      expect(originalPart).toBeDefined();
      const original = (originalPart as THREE.Mesh).material as THREE.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(original.color.getHex());
      expect(material.emissive.getHex()).toBe(original.emissive.getHex());
      expect(material).not.toBe(original);
      const transform = new THREE.Matrix4();
      mesh.getMatrixAt(0, transform);
      expect(new THREE.Vector3().setFromMatrixPosition(transform).y).toBe(8);
      expect(new THREE.Vector3().setFromMatrixScale(transform))
        .toEqual(new THREE.Vector3(1, 1, 1));
    }
    batch.dispose();
    expect(batch.group.children).toHaveLength(0);
    source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    });
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
    for (const lamp of linked.filter(p => p.model === 'lamp')) {
      expect(lamp.wall).toBeUndefined();
      expect(lamp.roof).toBeUndefined();
    }
    const homes = linked.filter(p => p.source!.kind === 'house');
    expect(homes.length).toBeGreaterThanOrEqual(5);
    expect(homes.some(p => p.model === 'pinkHome')).toBe(true);
    expect(homes.some(p => p.model === 'creamHome')).toBe(true);
    expect(homes.some(p => p.model === 'yellowHome')).toBe(true);
    // Houses carry their per-part painting colours in the GLB; the baker must
    // not repaint walls/roofs (that flattened roofs and trim to one colour).
    for (const home of linked.filter(p => p.source!.kind === 'house' || p.source!.kind === 'cottage')) {
      expect(home.wall, home.model).toBeUndefined();
      expect(home.roof, home.model).toBeUndefined();
    }
    expect(linked.filter(p => p.source!.kind === 'barn')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'silo')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'windmill')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'mailbox')
      .every(p => p.wall === 0xce493d)).toBe(true);
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
