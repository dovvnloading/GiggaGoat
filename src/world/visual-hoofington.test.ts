import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { addRapierPropCollider } from './colliders';
import { createWorldScene, generateIsland } from './index';
import { gridSample } from './terrain';
import { createDistrictLod, type BakedPlacement } from './district-lod';
import {
  HOOFINGTON_MODELS, bakeHoofingtonGeometry,
  createLanternLampInstances, makeHoofingtonPlacements,
  type HoofModel, type HoofPlacement,
} from './visual-hoofington';

describe('Hoofington sourced village model integration', () => {

  it('puts physical footholds on the rendered silo wall, ladder, pipe and roof', async () => {
    const island = generateIsland();
    const placement = makeHoofingtonPlacements(island).find(entry => entry.model === 'silo')!;
    const descriptor = island.colliders.find(c => c.shape !== 'heightfield' && c.id === placement.source!.id)!;
    if (descriptor.shape !== 'trimesh') throw Error('Expected the authored silo collider');
    const bytes = readFileSync('public/' + HOOFINGTON_MODELS.silo);
    const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
    const geometry = bakeHoofingtonGeometry([placement], new Map([['silo', scene]]))!;
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const shell = new THREE.Mesh(geometry, material);
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      const props = new Map<string, RAPIER.Collider>();
      addRapierPropCollider(world, { props, bodies: new Map() }, descriptor);
      const collider = props.get(descriptor.id)!;
      const centre = new THREE.Vector3().copy(placement.position);
      for (const height of [-.4, -.25, .09, .27, .42]) {
        for (let i = 0; i < 24; i++) {
          const angle = 2 * Math.PI * i / 24;
          const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
          const origin = centre.clone().addScaledVector(direction, -12);
          origin.y += height * placement.size.y;
          const art = new THREE.Raycaster(origin, direction).intersectObject(shell)[0];
          expect(art).toBeDefined();
          const distance = collider.castRay(new RAPIER.Ray(origin, direction), 24, false);
          expect(Math.abs(distance - art!.distance)).toBeLessThan(.003);
        }
      }
    } finally {
      world.free();
      geometry.dispose();
      material.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    }
  });

  it('keeps the shipped cream cottage silhouette and upper paint while shading its base course', async () => {
    const island = generateIsland();
    const placement = makeHoofingtonPlacements(island).find(entry => entry.model === 'creamHome')!;
    const rootAndBakes: THREE.BufferGeometry[] = [];
    let root: THREE.Group | undefined;
    try {
      vi.stubGlobal('self', globalThis);
      vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
      const bytes = readFileSync('public/' + HOOFINGTON_MODELS.creamHome);
      root = (await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')).scene;
      const models = new Map([[placement.model, root]]);
      const surfaced = bakeHoofingtonGeometry([placement], models)!;
      // The control selects the same authored fit and bypasses the house-only paint.
      const baseline = bakeHoofingtonGeometry([placement], models, undefined,
        { [placement.model]: 'assets/library/custom/' })!;
      rootAndBakes.push(surfaced, baseline);
      const positions = surfaced.getAttribute('position');
      expect(positions.array).toEqual(baseline.getAttribute('position').array);
      const paint = surfaced.getAttribute('color'), original = baseline.getAttribute('color');
      let plinth = 0, upper = 0;
      for (let i = 0; i < positions.count; i++) {
        const y = (positions.getY(i) - placement.position.y) / (.98 * placement.size.y) + .5;
        if (y < .015 && original.getY(i) > .4 && paint.getY(i) < original.getY(i) * .82) plinth++;
        if (y > .1) {
          expect(paint.getX(i)).toBe(original.getX(i));
          expect(paint.getY(i)).toBe(original.getY(i));
          expect(paint.getZ(i)).toBe(original.getZ(i));
          upper++;
        }
      }
      expect(plinth).toBeGreaterThan(20);
      expect(upper).toBeGreaterThan(500);
    } finally {
      vi.unstubAllGlobals();
      for (const bake of rootAndBakes) bake.dispose();
      root?.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const material = object.material as THREE.MeshStandardMaterial;
        material.map?.dispose();
        material.dispose();
      });
    }
  });
  it('carries the original village wall paint through the real merged district draw', async () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const source = makeHoofingtonPlacements(island);
    const models: HoofModel[] = ['creamHome', 'barn', 'windmill', 'silo'];
    const placements = models.map(id => source.find(entry => entry.model === id)!);
    const roots = new Map<HoofModel, THREE.Group>();
    const ranges: BakedPlacement<HoofModel>[] = [];
    const group = new THREE.Group();
    const control = new THREE.Group();
    try {
      vi.stubGlobal('self', globalThis);
      vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
      const loader = new GLTFLoader();
      for (const id of models) {
        const bytes = readFileSync('public/' + HOOFINGTON_MODELS[id]);
        roots.set(id, (await loader.parseAsync(Uint8Array.from(bytes).buffer, '')).scene);
      }
      const geometry = bakeHoofingtonGeometry(placements, roots, (placement, start, count) =>
        ranges.push({ placement, start, count }))!;
      const baseline = bakeHoofingtonGeometry(placements, roots, undefined, {
        creamHome: 'assets/library/custom/', barn: 'assets/library/polypizza/',
        windmill: 'assets/library/custom/', silo: 'assets/library/custom/',
      })!;
      expect(geometry.getAttribute('position').array).toEqual(baseline.getAttribute('position').array);
      expect(geometry.getAttribute('normal').array).toEqual(baseline.getAttribute('normal').array);
      expect(baseline.hasAttribute('hoofingtonFacade')).toBe(false);
      const surface = geometry.getAttribute('hoofingtonFacade');
      const normal = geometry.getAttribute('normal');
      expect(surface.count).toBe(geometry.getAttribute('position').count);
      for (const { placement, start, count } of ranges) {
        const style = placement.model === 'creamHome' ? 1 : placement.model === 'barn' ? 2 : 3;
        let wall = 0, protectedDetail = 0;
        for (let i = start; i < start + count; i += 3) {
          const paint = surface.getW(i);
          expect(paint).toBe(surface.getW(i + 1));
          expect(paint).toBe(surface.getW(i + 2));
          expect([0, style]).toContain(paint);
          if (paint === 0) protectedDetail++;
          if (paint > 0 && Math.abs(normal.getY(i)) < .12 && surface.getY(i) > 0.8) wall++;
        }
        expect(wall, placement.model).toBeGreaterThan(40);
        if (placement.model !== 'barn') expect(protectedDetail, placement.model).toBeGreaterThan(20);
      }
      const painted = await createDistrictLod(island, geometry, ranges, group, 'painted-district');
      const plain = await createDistrictLod(island, baseline, ranges, control, 'plain-district');
      try {
        expect(group.children.length).toBe(control.children.length);
        expect(group.children.length).toBeGreaterThan(0);
        for (const [index, object] of group.children.entries()) {
          const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;
          const original = control.children[index] as THREE.Mesh;
          expect(mesh.geometry.getAttribute('position').array)
            .toEqual(original.geometry.getAttribute('position').array);
          expect(mesh.castShadow).toBe(original.castShadow);
          expect(mesh.geometry.hasAttribute('hoofingtonFacade')).toBe(true);
          const shader = {
            vertexShader: THREE.ShaderLib.toon!.vertexShader,
            fragmentShader: THREE.ShaderLib.toon!.fragmentShader,
            uniforms: {} as Record<string, { value: unknown }>,
          };
          mesh.material.onBeforeCompile(
            shader as unknown as Parameters<typeof mesh.material.onBeforeCompile>[0],
            null as unknown as THREE.WebGLRenderer);
          expect(shader.vertexShader).toContain('vHoofingtonFacade = hoofingtonFacade');
          expect(shader.fragmentShader).toContain('paintedJoint(along / 0.54, 0.032)');
          expect(shader.fragmentShader).toContain('paintedJoint(metres.y / 0.64, 0.024)');
          expect(shader.fragmentShader).toContain('footingTint');
          expect(shader.fragmentShader).toContain('fwidth(position)');
          expect(shader.uniforms['uFacadeScale']?.value).toBe(1);
        }
      } finally {
        painted.dispose();
        plain.dispose();
      }
    } finally {
      vi.unstubAllGlobals();
      for (const root of roots.values()) root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const material = object.material as THREE.MeshStandardMaterial;
        material.map?.dispose();
        material.dispose();
      });
    }
  });

  it('references only existing CC0 GLBs without editing the library or credits', () => {
    const manifest = JSON.parse(readFileSync(
      'public/assets/library/manifest.json', 'utf8',
    )) as Array<{ path: string; license: string }>;
    for (const [model, path] of Object.entries(HOOFINGTON_MODELS)) {
      expect(path.endsWith('.glb'), model).toBe(true);
      expect(manifest.find(entry => entry.path === path)?.license, model)
        .toBe(model === 'lamp' ? 'Apache-2.0' : 'CC0');
    }
    // One building family: painting-palette Kenney suburban houses.
    for (const home of ['pinkHome', 'creamHome', 'yellowHome', 'farmhouse', 'cottage'] as const) {
      expect(HOOFINGTON_MODELS[home], home).toContain('custom/hoofington-houses/');
    }
    expect(HOOFINGTON_MODELS.lamp).toBe('assets/library/usdcraft/street-lamp-lantern.glb');
    const authored: Partial<Record<HoofModel, string>> = {
      fence: 'picket-fence.glb',
      mailbox: 'mailbox.glb',
      silo: 'silo.glb',
      windmill: 'windmill.glb',
      flowerPink: 'flowers-pink.glb',
      flowerPurple: 'flowers-purple.glb',
      flowerSunny: 'flowers-sunny.glb',
      bushA: 'bush-round-a.glb',
      bushB: 'bush-round-b.glb',
      oakA: 'tree-round-a.glb',
      oakB: 'tree-round-b.glb',
      oakC: 'tree-round-c.glb',
    };
    for (const [name, filename] of Object.entries(authored)) {
      expect(HOOFINGTON_MODELS[name as HoofModel], name)
        .toBe('assets/library/custom/hoofington-props/' + filename);
    }
    for (const retired of ['banner', 'flower', 'bush', 'oak'])
      expect(HOOFINGTON_MODELS).not.toHaveProperty(retired);
  });

  it('routes benches, gnomes, planters, play pads and hay to their painted CC0 GLBs', () => {
    const expected = {
      bench: 'assets/library/custom/town/park-bench.glb',
      gnome: 'assets/library/custom/town/gnome.glb',
      planter: 'assets/library/custom/town/planter.glb',
      playPad: 'assets/library/custom/baaardwalk/trampoline.glb',
      hay: 'assets/library/custom/hoofington-props/hay-bale.glb',
    } as const;
    for (const [model, path] of Object.entries(expected))
      expect(HOOFINGTON_MODELS[model as keyof typeof expected]).toBe(path);
  });

  it('bakes flat-colour gnomes at 0.5 x 0.9 x 0.5 without the textured draw', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const scale = island.size / 600;
    const placements = makeHoofingtonPlacements(island).filter(p => p.model === 'gnome');
    const sources = island.props.filter(p => p.poiId === 'hoofington' && p.kind === 'gnome');
    expect(placements).toHaveLength(sources.length);
    expect(placements.length).toBeGreaterThan(1);
    const paint = new THREE.Color(0x5286ca);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: paint }));
    const model = new THREE.Group();
    model.add(mesh);
    const ranges: Array<{ start: number; count: number }> = [];
    const baked = bakeHoofingtonGeometry(placements,
      new Map<HoofModel, THREE.Group>([['gnome', model]]),
      (_, start, count) => ranges.push({ start, count }))!;
    try {
      expect(ranges).toHaveLength(placements.length);
      const vertices = baked.getAttribute('position');
      const colors = baked.getAttribute('color');
      expect(colors.count).toBe(vertices.count);
      for (const [i, placement] of placements.entries()) {
        expect(placement.source).toBe(sources[i]);
        expect(placement.size).toEqual({
          x: 0.5 * scale, y: 0.9 * scale, z: 0.5 * scale,
        });
        const segment = ranges[i]!;
        const bounds = new THREE.Box3();
        for (let j = segment.start; j < segment.start + segment.count; j++) {
          bounds.expandByPoint(new THREE.Vector3(
            vertices.getX(j), vertices.getY(j), vertices.getZ(j)));
          expect(colors.getX(j)).toBeCloseTo(paint.r, 5);
          expect(colors.getY(j)).toBeCloseTo(paint.g, 5);
          expect(colors.getZ(j)).toBeCloseTo(paint.b, 5);
        }
        const ground = placement.position.y - placement.size.y / 2;
        expect(bounds.min.y).toBeGreaterThan(ground);
        expect(bounds.min.y - ground).toBeLessThan(0.02 * scale);
        expect(bounds.max.y - bounds.min.y).toBeCloseTo(0.9 * scale * 0.98, 4);
        expect(bounds.max.x - bounds.min.x).toBeLessThan(0.72 * scale);
        expect(bounds.max.z - bounds.min.z).toBeLessThan(0.72 * scale);
      }
    } finally {
      baked.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
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
    const allVisible = { intersectsSphere: () => true } as unknown as THREE.Frustum;
    expect(batch.updateCulling(new THREE.Vector3(10, 12, 3), allVisible)).toBe(true);
    // Six authored materials only cost six active draws, not twelve,
    // including when some visible lamps lie beyond the detailed distance.
    expect(batch.group.children.filter(mesh => mesh.visible)).toHaveLength(4);
    expect(batch.updateCulling(new THREE.Vector3(71, 12, 3), allVisible)).toBe(false);
    expect(batch.group.children.filter(mesh => mesh.visible)).toHaveLength(4);
    // Switching the same lamps from high to low LOD must not repaint shadows.
    expect(batch.updateCulling(new THREE.Vector3(90, 12, 3), allVisible)).toBe(false);
    expect(batch.group.children.filter(mesh => mesh.visible)).toHaveLength(4);
    expect(batch.updateCulling(new THREE.Vector3(10, 12, 3), allVisible)).toBe(false);
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

  it('places each farm animal lengthwise on Z without moving its ground anchor', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const farm = island.pois.find(p => p.id === 'hoofington')!.center;
    const scale = island.size / 600;
    const expected = [
      { model: 'cow', dx: -43, dz: 12, size: [2, 2.8, 4], yaw: -0.8 },
      { model: 'sheep', dx: -40, dz: 26, size: [1.65, 1.9, 2.5], yaw: 0.9 },
      { model: 'sheep', dx: 43, dz: -20, size: [1.6, 1.9, 2.4], yaw: -1.2 },
      { model: 'pig', dx: -43, dz: 31, size: [1.5, 1.6, 2], yaw: -0.2 },
      { model: 'horse', dx: 45, dz: -35, size: [1.85, 3.5, 4], yaw: -0.3 },
    ] as const;
    const livestock = makeHoofingtonPlacements(island).filter(p =>
      ['cow', 'sheep', 'pig', 'horse'].includes(p.model));
    expect(livestock).toHaveLength(expected.length);
    for (const [index, target] of expected.entries()) {
      const animal = livestock[index]!;
      expect(animal.model).toBe(target.model);
      expect(animal.source).toBeUndefined();
      expect(animal.position.x).toBeCloseTo(farm.x + target.dx * scale, 6);
      expect(animal.position.z).toBeCloseTo(farm.z + target.dz * scale, 6);
      expect(animal.size.x).toBeCloseTo(target.size[0] * scale, 6);
      expect(animal.size.y).toBeCloseTo(target.size[1] * scale, 6);
      expect(animal.size.z).toBeCloseTo(target.size[2] * scale, 6);
      expect(animal.yaw).toBeCloseTo(target.yaw, 6);
      expect(animal.position.y - animal.size.y / 2).toBeCloseTo(
        gridSample(island, animal.position.x, animal.position.z), 6);
    }
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
    // Painted meshes ship with their own colours, including barn and props.
    const authoredKinds = new Set(['house', 'cottage', 'barn', 'silo', 'windmill',
      'fence', 'mailbox', 'flower', 'bush', 'tree-oak']);
    for (const placement of linked.filter(p => authoredKinds.has(p.source!.kind))) {
      expect(placement.wall, placement.model).toBeUndefined();
      expect(placement.roof, placement.model).toBeUndefined();
    }
    expect(linked.filter(p => p.source!.kind === 'barn')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'silo')).toHaveLength(1);
    expect(linked.filter(p => p.source!.kind === 'windmill')).toHaveLength(1);
    // Variants cycle in descriptor order and continue through extra scenery
    // without consuming gameplay RNG or inventing physics descriptors.
    for (const [kind, choices] of [
      ['flower', ['flowerPink', 'flowerPurple', 'flowerSunny']],
      ['bush', ['bushA', 'bushB']],
      ['tree-oak', ['oakA', 'oakB', 'oakC']],
    ] as const) {
      const assigned = linked.filter(p => p.source!.kind === kind).map(p => p.model);
      expect(assigned).toEqual(assigned.map((_, i) => choices[i % choices.length]));
      for (const choice of choices)
        expect(plan.some(p => p.model === choice), choice).toBe(true);
    }
    expect(plan.map(p => p.model)).not.toContain('banner');
    expect(plan.filter(p => p.model === 'cow' || p.model === 'sheep' ||
      p.model === 'pig' || p.model === 'horse').length).toBeGreaterThanOrEqual(5);
    expect(plan.filter(p => p.model === 'planter').length).toBeGreaterThan(5);
    for (const placement of linked) {
      // The model uses the original world transform and exactly the existing
      // collider descriptor's dimensions. No extra island props are invented.
      expect(placement.position).toBe(placement.source!.transform.position);
      expect(placement.size).toBe(placement.source!.size);
      expect(placement.yaw).toBe(placement.source!.transform.rotationY +
        (placement.source!.kind === 'bench' ? Math.PI : 0));
    }
    const repeat = makeHoofingtonPlacements(island);
    expect(plan.map(p => [p.model, p.position, p.yaw, p.wall, p.roof]))
      .toEqual(repeat.map(p => [p.model, p.position, p.yaw, p.wall, p.roof]));
  });

  it('uses collider-scale cuboid windmill and park benches with flipped visual yaw', () => {
    for (const size of [400, 600, 850]) {
      const island = generateIsland({ seed: 'billy-isle', resolution: 97, size });
      const scale = size / 600;
      const windmill = island.props.find(p => p.poiId === 'hoofington' &&
        p.kind === 'windmill')!;
      expect(windmill).toBeDefined();
      expect(windmill.size).toEqual({
        x: 12.5 * scale, y: 18 * scale, z: 7.9 * scale,
      });
      expect(windmill.shape).toBe('cuboid');
      const windmillCollider = island.colliders.find(c =>
        c.shape !== 'heightfield' && c.id === windmill.id);
      expect(windmillCollider?.shape).toBe('cuboid');
      const benches = island.props.filter(p => p.poiId === 'hoofington' &&
        p.kind === 'bench');
      expect(benches.length).toBeGreaterThan(0);
      const plan = makeHoofingtonPlacements(island);
      for (const bench of benches) {
        expect(bench.size).toEqual({
          x: 2 * scale, y: 0.95 * scale, z: 0.75 * scale,
        });
        const appearance = plan.find(p => p.source?.id === bench.id)!;
        expect(appearance.model).toBe('bench');
        expect(appearance.size).toBe(bench.size);
        expect(appearance.yaw).toBeCloseTo(bench.transform.rotationY + Math.PI, 6);
      }
      for (const gnome of island.props.filter(p =>
        p.poiId === 'hoofington' && p.kind === 'gnome')) {
        expect(gnome.size).toEqual({
          x: 0.5 * scale, y: 0.9 * scale, z: 0.5 * scale,
        });
      }
    }
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

  it.each(['barn', 'silo', 'windmill', 'fence', 'mailbox',
    'bench', 'gnome', 'planter', 'playPad', 'hay',
    'flowerPink', 'flowerPurple', 'flowerSunny', 'bushA', 'bushB',
    'oakA', 'oakB', 'oakC'] as const)(
    'preserves the GLB material paint for %s even with legacy wall/roof hints', model => {
      const source = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x5ab88d }));
      source.add(mesh);
      const geometry = bakeHoofingtonGeometry([{
        model, position: { x: 0, y: 1, z: 0 },
        size: { x: 2, y: 2, z: 2 }, yaw: 0,
        wall: 0xff0000, roof: 0x0000ff,
      }], new Map<HoofModel, THREE.Group>([[model, source]]))!;
      const colours = geometry.getAttribute('color');
      const authored = new THREE.Color(0x5ab88d);
      for (let i = 0; i < colours.count; i++) {
        expect(colours.getX(i)).toBeCloseTo(authored.r, 5);
        expect(colours.getY(i)).toBeCloseTo(authored.g, 5);
        expect(colours.getZ(i)).toBeCloseTo(authored.b, 5);
      }
      geometry.dispose(); mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
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
