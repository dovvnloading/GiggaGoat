import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropDescriptor, PropKind } from './types';
import { bakeLibraryCloudGeometry, bakeLibraryPropGeometry, CLOUD_LIBRARY_MODELS,
  loadLibraryPropGeometry, PROP_LIBRARY_MODELS } from './library-props';
import { bakeLibraryGeometry, HOOFINGTON_MODELS } from './visual-hoofington';
import { DOWNTOWN_MODELS } from './visual-downtown';
import { buildPropVisuals, AUTHORED_HERO_DRESSING_KINDS } from './visual-props';
import { publicAssetUrl } from './public-assets';

interface ManifestAsset {
  path: string;
  source: string;
  license: string;
}
const assets = JSON.parse(
  readFileSync(new URL('../../public/assets/library/manifest.json', import.meta.url), 'utf8'),
) as ManifestAsset[];
const byPath = new Map(assets.map(entry => [entry.path, entry]));
const mapped = Object.entries(PROP_LIBRARY_MODELS) as [PropKind, string][];

describe('library prop catalog', () => {
  it('covers every PropKind and every path exists locally with the right licence', () => {
    // The satisfies Record<PropKind, string> declaration enforces exhaustive
    // coverage at typecheck time, including any newly added descriptor kind.
    expect(mapped).toHaveLength(94);
    expect(new Set(mapped.map(([kind]) => kind)).size).toBe(mapped.length);
    for (const [kind, path] of mapped) {
      const entry = byPath.get(path);
      expect(entry, kind + ': missing from the library manifest').toBeDefined();
      const expectedLicense = path.startsWith('assets/library/usdcraft/')
        ? 'Apache-2.0' : 'CC0';
      expect(entry?.license, kind + ': unexpected asset licence').toBe(expectedLicense);
      expect(existsSync(new URL('../../public/' + path, import.meta.url)),
        kind + ': missing file ' + path).toBe(true);
      expect(publicAssetUrl(path, '/GiggaGoat/src/world/viewer/index.html', './'),
        kind + ': bad GitHub Pages URL').toBe('/GiggaGoat/' + path);
    }
  });

  it('registers the visual-only deck support and all three painted cloud GLBs', () => {
    const stilts = 'assets/library/custom/pines/deck-stilts.glb';
    expect(PROP_LIBRARY_MODELS['deck-stilts']).toBe(stilts);
    expect(CLOUD_LIBRARY_MODELS).toEqual([
      'assets/library/custom/sky/cloud-a.glb',
      'assets/library/custom/sky/cloud-b.glb',
      'assets/library/custom/sky/cloud-c.glb',
    ]);
    for (const path of [stilts, ...CLOUD_LIBRARY_MODELS]) {
      expect(byPath.get(path)?.license).toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url))).toBe(true);
      expect(publicAssetUrl(path, '/GiggaGoat/src/world/viewer/index.html', './'))
        .toBe('/GiggaGoat/' + path);
    }
  });

  it('bakes flat-based cloud geometry in native metres with its own colours', () => {
    const root = new THREE.Group();
    const box = new THREE.BoxGeometry(60, 22, 34);
    box.translate(0, 11, 0);
    root.add(new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0xd8d4ec })));
    const geometry = bakeLibraryCloudGeometry(root);
    expect(geometry).not.toBeNull();
    const bounds = geometry!.boundingBox!;
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(22);
    expect(bounds.getSize(new THREE.Vector3()).toArray()).toEqual([60, 22, 34]);
    const paint = geometry!.getAttribute('color') as THREE.BufferAttribute;
    expect(paint).toBeDefined();
    expect(paint.getY(0)).toBeGreaterThan(0);
    geometry!.dispose();
    box.dispose();
  });

  it('registers both authored cascade GLBs with separate inert box fallbacks', () => {
    for (const [kind, file, height] of [
      ['cascade', 'cascade.glb', 10.5],
      ['cascade-tall', 'cascade-tall.glb', 14],
    ] as const) {
      const path = 'assets/library/custom/props/' + file;
      expect(PROP_LIBRARY_MODELS[kind]).toBe(path);
      expect(byPath.get(path)?.license).toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url))).toBe(true);
      expect(AUTHORED_HERO_DRESSING_KINDS.has(kind)).toBe(true);
      const prop: PropDescriptor = {
        id: kind + '-fallback', kind,
        transform: { position: { x: 0, y: height / 2, z: 0 }, rotationY: 1 },
        size: { x: 6.6, y: height, z: kind === 'cascade' ? 9.2 : 4 },
        body: { type: 'static' }, shape: 'cuboid', collidable: false,
        breakable: false, lickable: false, climbable: false,
      };
      const visuals = buildPropVisuals([prop]);
      try {
        const mesh = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
        expect(mesh.count).toBe(1);
        expect(mesh.geometry.userData.sourceKit).toBe(PROP_LIBRARY_MODELS[mesh.name.slice(6) as PropKind]);
        expect(mesh.geometry.getAttribute('color')).toBeDefined();
      } finally {
        visuals.dispose();
      }
    }
  });

  it('registers native-proportioned Pines ferns and lily pads as CC0 assets', () => {
    for (const [kind, file] of [['fern', 'fern.glb'], ['lily-pads', 'lily-pads.glb']] as const) {
      const path = 'assets/library/custom/pines/' + file;
      expect(PROP_LIBRARY_MODELS[kind]).toBe(path);
      expect(byPath.get(path)?.license).toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url))).toBe(true);
    }
    expect(AUTHORED_HERO_DRESSING_KINDS.has('lily-pads')).toBe(true);
    expect(AUTHORED_HERO_DRESSING_KINDS.has('fern')).toBe(false);
  });

  it('renders separate glade box fallbacks, with fern wind sway and no lily-pad sway', () => {
    const props: PropDescriptor[] = (['fern', 'lily-pads'] as const).map((kind, i) => ({
      id: 'pines-fallback-' + kind, kind,
      transform: { position: { x: i * 3, y: 3, z: 0 }, rotationY: 0.3 * i },
      size: { x: 1.4, y: kind === 'fern' ? 0.77 : 0.08, z: 1.4 },
      body: { type: 'static' }, shape: 'cuboid', collidable: false,
      breakable: false, lickable: false, climbable: false,
    }));
    const visuals = buildPropVisuals(props);
    try {
      const fern = visuals.group.getObjectByName('props-fern') as THREE.InstancedMesh;
      const lily = visuals.group.getObjectByName('props-lily-pads') as THREE.InstancedMesh;
      expect(fern).toBeInstanceOf(THREE.InstancedMesh);
      expect(lily).toBeInstanceOf(THREE.InstancedMesh);
      for (const mesh of [fern, lily]) {
        expect(mesh.count).toBe(1);
        expect(mesh.geometry.userData.sourceKit).toBe(PROP_LIBRARY_MODELS[mesh.name.slice(6) as PropKind]);
        expect(mesh.geometry.getAttribute('color')).toBeDefined();
      }
      expect((fern.material as THREE.MeshToonMaterial).onBeforeCompile.toString())
        .toContain('uWorldWind');
      expect((lily.material as THREE.MeshToonMaterial).onBeforeCompile.toString())
        .not.toContain('uWorldWind');
    } finally {
      visuals.dispose();
    }
  });

  it('registers all six authored painting-dressing models as CC0 assets', () => {
    const expected = {
      'palm-tree': 'assets/library/custom/props/palm-tree.glb',
      floodlight: 'assets/library/custom/props/floodlight.glb',
      'life-ring': 'assets/library/custom/props/life-ring.glb',
      'cable-spool': 'assets/library/custom/props/cable-spool.glb',
      'pallet-stack': 'assets/library/custom/props/pallet-stack.glb',
      'log-bridge': 'assets/library/custom/pines/log-bridge.glb',
    } as const;
    for (const [kind, path] of Object.entries(expected)) {
      expect(PROP_LIBRARY_MODELS[kind as PropKind], kind).toBe(path);
      expect(byPath.get(path)?.license, kind).toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url)), kind).toBe(true);
    }
  });

  it('maps all nineteen authored Baa-ardwalk kinds to their Blender GLBs', () => {
    const expected: Partial<Record<PropKind, string>> = {
      pier: 'boardwalk-pier.glb',
      'pier-rail': 'pier-rail.glb',
      scaffold: 'timber-pile.glb',
      booth: 'kiosk.glb',
      'kiosk-icecream': 'kiosk-icecream.glb',
      'kiosk-popcorn': 'kiosk-popcorn.glb',
      'kiosk-games': 'kiosk-games.glb',
      'kiosk-prizes': 'kiosk-prizes.glb',
      'kiosk-candy': 'kiosk-candy.glb',
      awning: 'striped-awning.glb',
      signboard: 'signboard.glb',
      'kiosk-sign-icecream': 'kiosk-sign-icecream.glb',
      'kiosk-sign-popcorn': 'kiosk-sign-popcorn.glb',
      'kiosk-sign-games': 'kiosk-sign-games.glb',
      'kiosk-sign-prizes': 'kiosk-sign-prizes.glb',
      'kiosk-sign-candy': 'kiosk-sign-candy.glb',
      'ferris-wheel': 'ferris-wheel.glb',
      trampoline: 'trampoline.glb',
      bumper: 'beach-ball.glb',
    };
    expect(Object.keys(expected)).toHaveLength(19);
    for (const [kind, file] of Object.entries(expected)) {
      const path = 'assets/library/custom/baaardwalk/' + file;
      expect(PROP_LIBRARY_MODELS[kind as PropKind], kind).toBe(path);
      expect(byPath.get(path)?.license, kind).toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url)), kind).toBe(true);
    }
  });

  it('maps all seven town and farm kinds and the new timber water tower to authored GLBs', () => {
    expect(PROP_LIBRARY_MODELS['water-tower'])
      .toBe('assets/library/custom/town/water-tower-timber.glb');
    expect(PROP_LIBRARY_MODELS['water-tower']).toBe(DOWNTOWN_MODELS.waterTower);
    const expected: Partial<Record<PropKind, string>> = {
      'ac-unit': 'assets/library/custom/town/ac-unit.glb',
      planter: 'assets/library/custom/town/planter.glb',
      bench: 'assets/library/custom/town/park-bench.glb',
      gnome: 'assets/library/custom/town/gnome.glb',
      'hay-bale': 'assets/library/custom/hoofington-props/hay-bale.glb',
      ramp: 'assets/library/custom/hoofington-props/wooden-ramp.glb',
      buoy: 'assets/library/custom/props/buoy.glb',
    };
    expect(Object.keys(expected)).toHaveLength(7);
    for (const [kind, path] of Object.entries(expected)) {
      expect(PROP_LIBRARY_MODELS[kind as PropKind]).toBe(path);
      expect(byPath.get(path)?.license, kind).toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url)), kind).toBe(true);
    }
  });

  it('maps all 15 Crane Yard kinds to their exact authored CC0 assets', () => {
    const expected: Partial<Record<PropKind, string>> = {
      crane: 'assets/library/custom/crane-yard/crane-mast.glb',
      'crane-jib': 'assets/library/custom/crane-yard/crane-jib.glb',
      'crane-cab': 'assets/library/custom/crane-yard/crane-cab.glb',
      'crane-cable': 'assets/library/custom/crane-yard/crane-cable.glb',
      'red-girder': 'assets/library/custom/crane-yard/red-girder.glb',
      'concrete-slab': 'assets/library/custom/crane-yard/concrete-slab.glb',
      'concrete-column': 'assets/library/custom/crane-yard/concrete-column.glb',
      'yard-scaffold': 'assets/library/custom/crane-yard/yard-scaffold.glb',
      'safety-rail': 'assets/library/custom/crane-yard/safety-rail.glb',
      'chain-fence': 'assets/library/custom/crane-yard/chain-fence.glb',
      'pipe-stack': 'assets/library/custom/crane-yard/pipe-stack.glb',
      'site-barrier': 'assets/library/custom/crane-yard/site-barrier.glb',
      bunting: 'assets/library/custom/crane-yard/bunting.glb',
      container: 'assets/library/custom/crane-yard/container.glb',
      'site-banner': 'assets/library/custom/crane-yard/site-banner.glb',
    };
    for (const [kind, path] of Object.entries(expected)) {
      expect(PROP_LIBRARY_MODELS[kind as PropKind]).toBe(path);
      expect(byPath.get(path)?.license, kind).toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url)), kind).toBe(true);
    }
  });

  it('maps all ten Mt Gigga, Pines and shared models to their authored CC0 GLBs', () => {
    const expected: Partial<Record<PropKind, string>> = {
      'satellite-dish': 'assets/library/custom/mt-gigga/satellite-dish.glb',
      ledge: 'assets/library/custom/mt-gigga/ledge.glb',
      'cave-mouth': 'assets/library/custom/mt-gigga/cave-arch.glb',
      flag: 'assets/library/custom/mt-gigga/pennant-pole.glb',
      lookout: 'assets/library/custom/pines/lookout.glb',
      platform: 'assets/library/custom/pines/timber-deck.glb',
      'tree-pine': 'assets/library/custom/pines/pine.glb',
      sign: 'assets/library/custom/props/signpost.glb',
      'rope-rail': 'assets/library/custom/props/rope-post.glb',
      bridge: 'assets/library/custom/props/bridge-deck.glb',
    };
    expect(Object.keys(expected)).toHaveLength(10);
    for (const [kind, path] of Object.entries(expected)) {
      expect(PROP_LIBRARY_MODELS[kind as PropKind], kind).toBe(path);
      expect(byPath.get(path)?.license, kind).toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url)), kind).toBe(true);
    }
  });

  it('prefers coherent, genuinely sourced models for the art-camera details', () => {
    const expected: Partial<Record<PropKind, string>> = {
      'tree-oak': 'custom/hoofington-props/tree-round-a.glb',
      'tree-pine': 'custom/pines/pine.glb',
      bush: 'custom/hoofington-props/bush-round-a.glb',
      flower: 'custom/hoofington-props/flowers-pink.glb',
      'grass-tuft': 'custom/hoofington-props/daisies.glb',
      lamp: 'usdcraft/street-lamp-lantern.glb',
      bench: 'custom/town/park-bench.glb',
      fence: 'custom/hoofington-props/picket-fence.glb',
      mailbox: 'custom/hoofington-props/mailbox.glb',
      silo: 'custom/hoofington-props/climbable-silo.glb',
      windmill: 'custom/hoofington-props/windmill.glb',
      crate: 'platformer-kit/crate.glb',
      barrel: 'survival-kit/barrel.glb',
      shop: 'city-kit-commercial/building-a.glb',
      'ferris-wheel': 'custom/baaardwalk/ferris-wheel.glb',
      crane: 'custom/crane-yard/crane-mast.glb',
      'crane-jib': 'custom/crane-yard/crane-jib.glb',
      'crane-cab': 'custom/crane-yard/crane-cab.glb',
      'crane-cable': 'custom/crane-yard/crane-cable.glb',
      'red-girder': 'custom/crane-yard/red-girder.glb',
      container: 'custom/crane-yard/container.glb',
    };
    for (const [kind, suffix] of Object.entries(expected))
      expect(PROP_LIBRARY_MODELS[kind as PropKind], kind).toContain(suffix);
  });
});

describe('USDCraft lantern model consistency', () => {
  it('maps all three street-lamp tables to the prepared Apache-2.0 asset', () => {
    const path = 'assets/library/usdcraft/street-lamp-lantern.glb';
    expect(HOOFINGTON_MODELS.lamp).toBe(path);
    expect(DOWNTOWN_MODELS.lamp).toBe(path);
    expect(PROP_LIBRARY_MODELS.lamp).toBe(path);
    expect(byPath.get(path)).toMatchObject({
      source: 'NVIDIA USDCraft-10K', license: 'Apache-2.0', pack: 'usdcraft',
    });
  });

  it('ships the authored lamp materials with warm emissive lantern glass', () => {
    const binary = readFileSync(new URL(
      '../../public/assets/library/usdcraft/street-lamp-lantern.glb', import.meta.url));
    expect(binary.toString('utf8', 0, 4)).toBe('glTF');
    const jsonLength = binary.readUInt32LE(12);
    const gltf = JSON.parse(binary.toString('utf8', 20, 20 + jsonLength)) as {
      meshes: Array<{ primitives: Array<{ material: number }> }>;
      materials: Array<{ name: string; emissiveFactor?: number[] }>;
    };
    expect(gltf.meshes.flatMap(mesh => mesh.primitives).length).toBeGreaterThanOrEqual(4);
    for (const name of ['brass_burner', 'lantern_glass', 'opal_globe', 'painted_cast_iron']) {
      expect(gltf.materials.map(m => m.name)).toContain(name);
    }
    expect(gltf.materials.find(m => m.name === 'lantern_glass')?.emissiveFactor)
      .toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(gltf.materials.find(m => m.name === 'lantern_glass')!.emissiveFactor![0])
      .toBeGreaterThan(0.5);
  });
  it('keeps the old lamp draw inert after its source loads', async () => {
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff0000 })));
    const loader = new GLTFLoader();
    const load = vi.spyOn(loader, 'loadAsync')
      .mockResolvedValue({ scene: source } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    const marker = await loadLibraryPropGeometry('lamp', loader);
    try {
      expect(load).toHaveBeenCalledWith(publicAssetUrl(PROP_LIBRARY_MODELS.lamp));
      const vertices = marker.getAttribute('position');
      expect(vertices.count).toBe(3);
      for (let i = 0; i < vertices.count; i++) {
        expect(vertices.getX(i)).toBe(0);
        expect(vertices.getY(i)).toBe(0);
        expect(vertices.getZ(i)).toBe(0);
      }
      expect(marker.getAttribute('color')).toBeDefined();
    } finally {
      marker.dispose();
      load.mockRestore();
    }
  });

});

describe('library geometry batching', () => {
  it.each(['tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft', 'planter',
    'fence', 'mailbox',
    'silo', 'windmill'] as const)(
    'preserves authored material and vertex colours for %s', kind => {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const paint = new Float32Array(geometry.getAttribute('position').count * 3);
      for (let i = 0; i < paint.length; i += 3) {
        paint[i] = 0.75; paint[i + 1] = 0.5; paint[i + 2] = 0.25;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(paint, 3));
      const material = new THREE.MeshStandardMaterial({ color: 0x5ab88d });
      const source = new THREE.Group();
      source.add(new THREE.Mesh(geometry, material));
      const baked = bakeLibraryPropGeometry(kind, source)!;
      const colour = baked.getAttribute('color');
      const authored = new THREE.Color(0x5ab88d);
      for (let i = 0; i < colour.count; i++) {
        expect(colour.getX(i)).toBeCloseTo(authored.r * 0.75, 5);
        expect(colour.getY(i)).toBeCloseTo(authored.g * 0.5, 5);
        expect(colour.getZ(i)).toBeCloseTo(authored.b * 0.25, 5);
      }
      baked.dispose(); geometry.dispose(); material.dispose();
    });

  it('retains the authored planter material rather than legacy height paint', () => {
    const source = new THREE.Group();
    const paint = new THREE.Color(0x509fc5);
    const material = new THREE.MeshStandardMaterial({ color: paint });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    source.add(new THREE.Mesh(geometry, material));
    const baked = bakeLibraryPropGeometry('planter', source)!;
    const colours = baked.getAttribute('color');
    for (let i = 0; i < colours.count; i++) {
      expect(colours.getX(i)).toBeCloseTo(paint.r, 5);
      expect(colours.getY(i)).toBeCloseTo(paint.g, 5);
      expect(colours.getZ(i)).toBeCloseTo(paint.b, 5);
    }
    baked.dispose(); geometry.dispose(); material.dispose();
  });

  it('bakes transformed native model parts centred in X/Z and grounded in Y', () => {
    const source = new THREE.Group();
    const wood = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3, 1),
      new THREE.MeshStandardMaterial({ color: 0xa26738 }),
    );
    wood.position.set(6, 8, 4);
    source.add(wood);
    const roof = new THREE.Mesh(
      new THREE.TetrahedronGeometry(0.5),
      new THREE.MeshStandardMaterial({ color: 0x7caac9 }),
    );
    roof.position.set(6, 10, 4);
    source.add(roof);
    const geometry = bakeLibraryPropGeometry('crate', source);
    expect(geometry).not.toBeNull();
    const positions = geometry!.getAttribute('position');
    const colours = geometry!.getAttribute('color');
    expect(geometry!.index).toBeNull();
    expect(positions.count).toBeGreaterThan(36);
    expect(colours.count).toBe(positions.count);
    // The non-authored GLB retains its native dimensions: X/Z centred,
    // Y grounded at zero for a uniform fit at each rendering instance.
    expect(geometry!.boundingBox!.min.x).toBeCloseTo(-1, 5);
    expect(geometry!.boundingBox!.max.x).toBeCloseTo(1, 5);
    expect(geometry!.boundingBox!.min.z).toBeCloseTo(-0.5, 5);
    expect(geometry!.boundingBox!.max.z).toBeCloseTo(0.5, 5);
    expect(geometry!.boundingBox!.min.y).toBeCloseTo(0, 5);
    expect(geometry!.boundingBox!.max.y).toBeGreaterThan(3);
    expect(colours.getX(0)).not.toBeCloseTo(colours.getX(colours.count - 1));
    geometry!.dispose();
    wood.geometry.dispose(); roof.geometry.dispose();
    (wood.material as THREE.Material).dispose();
    (roof.material as THREE.Material).dispose();
  });

  it('preserves seeded positions, yaw, scale and original instance order', () => {
    const props: PropDescriptor[] = [
      { id: 'oak-a', kind: 'tree-oak',
        transform: { position: { x: 12, y: 9, z: -18 }, rotationY: 0.4 },
        size: { x: 4, y: 7, z: 5 }, body: { type: 'static' },
        shape: 'cuboid', collidable: false, breakable: false, lickable: false, climbable: false },
      { id: 'oak-b', kind: 'tree-oak',
        transform: { position: { x: -7, y: 2, z: 31 }, rotationY: 1.7 },
        size: { x: 3, y: 5, z: 3 }, body: { type: 'static' },
        shape: 'cuboid', collidable: false, breakable: false, lickable: false, climbable: false },
    ];
    const visuals = buildPropVisuals(props);
    const mesh = visuals.group.getObjectByName('props-tree-oak') as THREE.InstancedMesh;
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(props.length);
    const got = new THREE.Matrix4();
    const expected = new THREE.Object3D();
    for (let i = 0; i < props.length; i++) {
      const prop = props[i]!;
      expected.position.set(prop.transform.position.x,
        prop.transform.position.y, prop.transform.position.z);
      expected.rotation.set(0, prop.transform.rotationY, 0);
      expected.scale.set(prop.size.x, prop.size.y, prop.size.z);
      expected.updateMatrix();
      mesh.getMatrixAt(i, got);
      // InstancedMesh stores each matrix in Float32Array; allow GPU precision.
      for (let j = 0; j < 16; j++) {
        expect(got.elements[j]!, prop.id + ' matrix element ' + j)
          .toBeCloseTo(expected.matrix.elements[j]!, 5);
      }
    }
    visuals.dispose();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});

describe('authored daisy grass-tuft instances', () => {
  it('keeps GLB paint and white instance tints through near/far LOD', async () => {
    // Source colours are already final; intentionally conflicting descriptor
    // colours must never multiply the white blooms or green leaves.
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.72, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x56955e })));
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene: source } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    vi.stubGlobal('document', {});
    const props: PropDescriptor[] = Array.from({ length: 2 }, (_, i): PropDescriptor => ({
      id: 'daisy-' + i, kind: 'grass-tuft',
      transform: { position: { x: i ? 2 : -2, y: 0.36, z: 0 }, rotationY: i * 0.5 },
      size: { x: 0.65, y: 0.72, z: 0.65 },
      body: { type: 'static' }, shape: 'cuboid',
      collidable: false, breakable: false, lickable: false, climbable: false,
      color: i ? 0xff0000 : 0x0000ff,
    }));
    const visuals = buildPropVisuals(props);
    try {
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true));
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      expect(load).toHaveBeenCalledOnce();
      expect(load).toHaveBeenCalledWith(publicAssetUrl(
        PROP_LIBRARY_MODELS['grass-tuft']));
      const original = visuals.group.getObjectByName('props-grass-tuft') as THREE.InstancedMesh;
      expect(original.count).toBe(props.length);
      const colours = original.geometry.getAttribute('color');
      const paint = new THREE.Color(0x56955e);
      expect(colours.getX(0)).toBeCloseTo(paint.r, 5);
      expect(colours.getY(0)).toBeCloseTo(paint.g, 5);
      expect(colours.getZ(0)).toBeCloseTo(paint.b, 5);
      const actual = new THREE.Color();
      const expectWhite = (mesh: THREE.InstancedMesh, count: number): void => {
        expect(mesh.count).toBe(count);
        for (let i = 0; i < count; i++) {
          mesh.getColorAt(i, actual);
          expect(actual.getHex()).toBe(0xffffff);
        }
      };
      expectWhite(original, props.length);

      const camera = new THREE.PerspectiveCamera(80, 1, 0.1, 500);
      const frustum = new THREE.Frustum();
      const cullFrom = (distance: number): void => {
        camera.position.set(0, 1, distance);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        frustum.setFromProjectionMatrix(new THREE.Matrix4()
          .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        visuals.updateCulling(camera.position, frustum, 500, () => false);
      };
      const near = visuals.group.getObjectByName('render-near-grass-tuft') as THREE.InstancedMesh;
      const far = visuals.group.getObjectByName('render-far-grass-tuft') as THREE.InstancedMesh;
      cullFrom(20);
      expectWhite(near, props.length);
      cullFrom(90);
      expectWhite(far, props.length);
      cullFrom(160);
      expect(near.count).toBe(0);
      expect(far.count).toBe(0);
    } finally {
      const mesh = visuals.group.getObjectByName('props-grass-tuft') as THREE.InstancedMesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      visuals.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('authored crane-yard instance colours', () => {
  it('keeps all authored Crane Yard paint and full-detail near/far LOD', async () => {
    const kinds = ['crane', 'crane-jib', 'crane-cab', 'crane-cable',
      'red-girder', 'concrete-slab', 'concrete-column', 'yard-scaffold',
      'safety-rail', 'chain-fence', 'pipe-stack', 'site-barrier',
      'site-banner', 'bunting'] as const;
    const painted = new THREE.Color(0x5a96c3);
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16),
        new THREE.MeshStandardMaterial({ color: 0x5a96c3 })));
      return { scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
    });
    vi.stubGlobal('document', {});
    const props: PropDescriptor[] = kinds.map((kind, i): PropDescriptor => ({
      id: 'untinted-' + kind, kind,
      transform: { position: { x: i - 2, y: 0.5, z: 0 }, rotationY: 0 },
      size: { x: 1, y: 1, z: 1 },
      body: { type: 'static' }, shape: 'cuboid',
      collidable: false, breakable: false, lickable: false, climbable: false,
      // Deliberately conflicting descriptor colour must not repaint the GLB.
      color: 0xff0000,
    }));
    const visuals = buildPropVisuals(props);
    const actual = new THREE.Color();
    const expectWhite = (mesh: THREE.InstancedMesh, kind: string): void => {
      expect(mesh, kind).toBeInstanceOf(THREE.InstancedMesh);
      expect(mesh.count, kind).toBe(1);
      mesh.getColorAt(0, actual);
      expect(actual.getHex(), kind).toBe(0xffffff);
    };
    try {
      for (const kind of kinds) {
        expectWhite(visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh,
          kind + ' fallback');
      }
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true),
        { timeout: 15000 });
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      expect(load).toHaveBeenCalledTimes(kinds.length);
      for (const kind of kinds) {
        expect(load).toHaveBeenCalledWith(publicAssetUrl(PROP_LIBRARY_MODELS[kind]));
        const mesh = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        expectWhite(mesh, kind + ' loaded');
        const near = visuals.group.getObjectByName('render-near-' + kind) as THREE.InstancedMesh;
        const far = visuals.group.getObjectByName('render-far-' + kind) as THREE.InstancedMesh;
        expect(near.geometry, kind + ' near source').toBe(mesh.geometry);
        expect(far.geometry, kind + ' far source').toBe(mesh.geometry);
        expect(mesh.geometry.getAttribute('position').count / 3, kind)
          .toBeGreaterThan(48);
        if (kind === 'site-banner') {
          expect((mesh.material as THREE.MeshToonMaterial).side).toBe(THREE.FrontSide);
        }
        const paint = mesh.geometry.getAttribute('color');
        expect(paint.getX(0), kind).toBeCloseTo(painted.r, 5);
        expect(paint.getY(0), kind).toBeCloseTo(painted.g, 5);
        expect(paint.getZ(0), kind).toBeCloseTo(painted.b, 5);
      }
      const camera = new THREE.PerspectiveCamera(80, 1, 0.1, 500);
      const frustum = new THREE.Frustum();
      for (const [distance, level] of [[20, 'near'], [90, 'far']] as const) {
        camera.position.set(0, 1, distance);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        frustum.setFromProjectionMatrix(new THREE.Matrix4()
          .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        visuals.updateCulling(camera.position, frustum, 500, () => false);
        for (const kind of kinds) {
          expectWhite(visuals.group.getObjectByName(
            'render-' + level + '-' + kind) as THREE.InstancedMesh,
          kind + ' ' + level);
        }
      }
    } finally {
      for (const kind of kinds) {
        const mesh = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      visuals.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('authored Mt Gigga, Pines and shared model LOD', () => {
  it('keeps nine painted models intact at distance but simplifies Blender pines', async () => {
    const authored = [
      'satellite-dish', 'ledge', 'cave-mouth', 'flag', 'lookout',
      'platform', 'sign', 'rope-rail', 'bridge',
    ] as const;
    const kinds = [...authored, 'tree-pine'] as const;
    const sourcePaint = new THREE.Color(0x5a96c3);
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 36, 24),
        new THREE.MeshStandardMaterial({ color: sourcePaint })));
      return { scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
    });
    vi.stubGlobal('document', {});
    const props: PropDescriptor[] = kinds.map((kind, i): PropDescriptor => ({
      id: 'authored-' + kind, kind,
      transform: { position: { x: i - 4.5, y: 0.5, z: 0 }, rotationY: 0 },
      size: { x: 1, y: 1, z: 1 },
      body: { type: 'static' }, shape: 'cuboid',
      collidable: false, breakable: false, lickable: false, climbable: false,
      color: 0xff0000, // Authored GLB paint must override this descriptor hint.
    }));
    const visuals = buildPropVisuals(props);
    const colour = new THREE.Color();
    try {
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true),
        { timeout: 15000 });
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      expect(load).toHaveBeenCalledTimes(kinds.length);
      for (const kind of kinds) {
        expect(load).toHaveBeenCalledWith(publicAssetUrl(PROP_LIBRARY_MODELS[kind]));
        const original = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        const near = visuals.group.getObjectByName('render-near-' + kind) as THREE.InstancedMesh;
        const far = visuals.group.getObjectByName('render-far-' + kind) as THREE.InstancedMesh;
        expect(near.geometry, kind + ' near').toBe(original.geometry);
        original.getColorAt(0, colour);
        expect(colour.getHex(), kind + ' source tint').toBe(0xffffff);
        const painted = original.geometry.getAttribute('color');
        expect(painted.getX(0), kind).toBeCloseTo(sourcePaint.r, 5);
        expect(painted.getY(0), kind).toBeCloseTo(sourcePaint.g, 5);
        expect(painted.getZ(0), kind).toBeCloseTo(sourcePaint.b, 5);
        if (kind === 'tree-pine') {
          // Hundreds of pines retain the regular simplified distant LOD.
          expect(far.geometry).not.toBe(original.geometry);
          expect(far.geometry.getAttribute('position').count, kind)
            .toBeLessThan(original.geometry.getAttribute('position').count);
        } else {
          expect(far.geometry, kind + ' full-detail far').toBe(original.geometry);
        }
      }
    } finally {
      for (const kind of kinds) {
        const original = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        const far = visuals.group.getObjectByName('render-far-' + kind) as THREE.InstancedMesh;
        if (far?.geometry !== original.geometry) far?.geometry.dispose();
        original.geometry.dispose();
        (original.material as THREE.Material).dispose();
      }
      visuals.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('Crane Yard container descriptor colours', () => {
  it('tints authored container bodies at full strength and retains full far geometry', async () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xf5f5f5 })));
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    vi.stubGlobal('document', {});
    const colours = [0x4589ba, 0xc95241, undefined] as const;
    const props: PropDescriptor[] = colours.map((color, i) => ({
      id: 'crane-container-' + i, kind: 'container',
      transform: { position: { x: i * 2 - 2, y: 1.6, z: 0 }, rotationY: 0 },
      size: { x: 12.2, y: 3.2, z: 3.0 },
      body: { type: 'static' }, shape: 'cuboid',
      collidable: true, breakable: false, lickable: true, climbable: true,
      ...(color === undefined ? {} : { color }),
    }));
    const visuals = buildPropVisuals(props);
    try {
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true));
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      expect(load).toHaveBeenCalledWith(publicAssetUrl(PROP_LIBRARY_MODELS.container));
      const original = visuals.group.getObjectByName('props-container') as THREE.InstancedMesh;
      const near = visuals.group.getObjectByName('render-near-container') as THREE.InstancedMesh;
      const far = visuals.group.getObjectByName('render-far-container') as THREE.InstancedMesh;
      expect(near.geometry).toBe(original.geometry);
      expect(far.geometry).toBe(original.geometry);
      expect(original.geometry.getAttribute('position').count / 3).toBeGreaterThan(48);

      const visible = { intersectsSphere: () => true } as unknown as THREE.Frustum;
      const actual = new THREE.Color();
      const expectColours = (mesh: THREE.InstancedMesh): void => {
        expect(mesh.count).toBe(colours.length);
        colours.forEach((color, i) => {
          mesh.getColorAt(i, actual);
          expect(actual.getHex(), 'container ' + i).toBe(color ?? 0xffffff);
        });
      };
      expectColours(original);
      visuals.updateCulling(new THREE.Vector3(0, 1, 20), visible, 500, () => false);
      expectColours(near);
      visuals.updateCulling(new THREE.Vector3(0, 1, 100), visible, 500, () => false);
      expectColours(far);
    } finally {
      const mesh = visuals.group.getObjectByName('props-container') as THREE.InstancedMesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      visuals.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('authored Baa-ardwalk model colours and LOD', () => {
  it('gives every new kiosk a unique coloured box fallback with no descriptor tint', () => {
    const painted = [
      ['kiosk-icecream', 0xf0757c],
      ['kiosk-popcorn', 0xffc567],
      ['kiosk-games', 0x65c8cc],
      ['kiosk-prizes', 0xd78abf],
      ['kiosk-candy', 0xff9469],
    ] as const;
    const props: PropDescriptor[] = painted.map(([kind], i) => ({
      id: 'kiosk-fallback-' + i, kind,
      transform: { position: { x: i * 8, y: 2.4, z: 0 },
        rotationY: -Math.PI / 2 },
      size: { x: 5, y: 4.8, z: 4.5 }, body: { type: 'static' },
      shape: 'cuboid', collidable: true, breakable: false,
      lickable: true, climbable: true, color: 0x080808,
    }));
    const visuals = buildPropVisuals(props);
    try {
      for (const [kind] of painted) {
        const mesh = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
        expect(mesh.geometry.userData.sourceKit).toBe(PROP_LIBRARY_MODELS[mesh.name.slice(6) as PropKind]);
        const colour = mesh.geometry.getAttribute('color');
        const actual = new THREE.Color();
        expect(new Set(Array.from(colour.array)).size).toBeGreaterThan(3);
        mesh.getColorAt(0, actual);
        expect(actual.getHex(), kind + ' instance tint').toBe(0xffffff);
      }
    } finally {
      visuals.dispose();
    }
  });


  it('uses five distinct named-sign box fallbacks, without tinting their own colours', () => {
    const signs = [
      ['kiosk-sign-icecream', 0xffd2e5],
      ['kiosk-sign-popcorn', 0xffdc8a],
      ['kiosk-sign-games', 0x82d9df],
      ['kiosk-sign-prizes', 0xcfa2ea],
      ['kiosk-sign-candy', 0xffb19c],
    ] as const;
    const props: PropDescriptor[] = signs.map(([kind], i) => ({
      id: 'fallback-' + kind, kind,
      transform: { position: { x: i * 6, y: 2, z: 0 }, rotationY: -Math.PI / 2 },
      size: { x: 4.6, y: 1.4, z: 0.3 }, body: { type: 'static' },
      shape: 'cuboid', collidable: false, breakable: false,
      lickable: true, climbable: false, color: 0xffe3a7,
    }));
    const visuals = buildPropVisuals(props);
    try {
      for (const [kind] of signs) {
        const mesh = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
        expect(mesh.geometry.userData.sourceKit).toBe(PROP_LIBRARY_MODELS[kind]);
        const painted = mesh.geometry.getAttribute('color');
        expect(new Set(Array.from(painted.array)).size).toBeGreaterThan(3);
        const instance = new THREE.Color();
        mesh.getColorAt(0, instance);
        expect(instance.getHex(), kind).toBe(0xffffff);
      }
    } finally {
      visuals.dispose();
    }
  });

  it('preserves own-colour kiosks at full detail while legacy booth retains descriptor tint', async () => {
    const kinds = ['pier', 'pier-rail', 'scaffold', 'awning', 'signboard',
      'kiosk-icecream', 'kiosk-popcorn', 'kiosk-games',
      'kiosk-prizes', 'kiosk-candy',
      'kiosk-sign-icecream', 'kiosk-sign-popcorn', 'kiosk-sign-games',
      'kiosk-sign-prizes', 'kiosk-sign-candy',
      'ferris-wheel', 'trampoline', 'bumper'] as const;
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0x75a5c9 })));
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    vi.stubGlobal('document', {});
    const props: PropDescriptor[] = [
      ...kinds.map((kind, i): PropDescriptor => ({
        id: 'boardwalk-' + kind, kind,
        transform: { position: { x: i * 3, y: 2, z: 0 }, rotationY: 0 },
        size: { x: 2, y: 2, z: 2 }, body: { type: 'static' },
        shape: 'cuboid', collidable: true, breakable: false,
        lickable: true, climbable: true, color: 0xff0000,
      })),
      ...[0x75b3d4, 0xf4837c, undefined].map((color, i): PropDescriptor => ({
        id: 'boardwalk-booth-' + i, kind: 'booth',
        transform: { position: { x: i * 3, y: 2, z: 8 }, rotationY: 0 },
        size: { x: 2, y: 2, z: 2 }, body: { type: 'static' },
        shape: 'cuboid', collidable: true, breakable: false,
        lickable: true, climbable: true,
        ...(color === undefined ? {} : { color }),
      })),
    ];
    const visuals = buildPropVisuals(props);
    try {
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true),
        { timeout: 15000 });
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      const white = new THREE.Color();
      for (const kind of [...kinds, 'booth'] as const) {
        const original = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        const near = visuals.group.getObjectByName('render-near-' + kind) as THREE.InstancedMesh;
        const far = visuals.group.getObjectByName('render-far-' + kind) as THREE.InstancedMesh;
        expect(near.geometry, kind).toBe(original.geometry);
        expect(far.geometry, kind).toBe(original.geometry);
        expect(original.geometry.getAttribute('position').count / 3).toBeGreaterThan(48);
        expect(load).toHaveBeenCalledWith(publicAssetUrl(PROP_LIBRARY_MODELS[kind]));
        const colours = kind === 'booth' ? [0x75b3d4, 0xf4837c, 0xffffff] : [0xffffff];
        colours.forEach((hex, i) => {
          original.getColorAt(i, white);
          expect(white.getHex(), kind + ' ' + i).toBe(hex);
        });
        const paint = original.geometry.getAttribute('color');
        const sourcePaint = new THREE.Color(0x75a5c9);
        expect(paint.getX(0), kind).toBeCloseTo(sourcePaint.r, 5);
        expect(paint.getY(0), kind).toBeCloseTo(sourcePaint.g, 5);
        expect(paint.getZ(0), kind).toBeCloseTo(sourcePaint.b, 5);
      }
      const visible = { intersectsSphere: () => true } as unknown as THREE.Frustum;
      for (const [distance, level] of [[20, 'near'], [100, 'far']] as const) {
        visuals.updateCulling(new THREE.Vector3(0, 2, distance), visible, 500, () => false);
        for (const kind of [...kinds, 'booth'] as const) {
          const mesh = visuals.group.getObjectByName(
            'render-' + level + '-' + kind) as THREE.InstancedMesh;
          expect(mesh.count, kind + ' ' + level).toBe(kind === 'booth' ? 3 : 1);
          const colours = kind === 'booth' ? [0x75b3d4, 0xf4837c, 0xffffff] : [0xffffff];
          colours.forEach((hex, i) => {
            mesh.getColorAt(i, white);
            expect(white.getHex(), kind + ' ' + level + ' ' + i).toBe(hex);
          });
        }
      }
    } finally {
      visuals.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('authored town and farm prop paint and LOD', () => {
  it('draws service and courier ramp treads uphill at either world heading', async () => {
    const bytes = readFileSync(new URL('../../public/' + PROP_LIBRARY_MODELS.ramp, import.meta.url));
    const asset = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(asset);
    vi.stubGlobal('document', {});
    const descriptors = ([
      ['downtown-bleatsville-ramp-41', -5, 0],
      ['downtown-courier-span-2', 5, Math.PI],
    ] as const).map(([id, x, rotationY]): PropDescriptor => ({
      id, kind: 'ramp',
      transform: { position: { x, y: 2, z: 0 }, rotationY },
      size: { x: 4.5, y: 3, z: 9 }, body: { type: 'static' }, shape: 'convex',
      collidable: true, breakable: false, lickable: true, climbable: true,
    }));
    const visuals = buildPropVisuals(descriptors);
    try {
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true));
      const frustum = { intersectsSphere: () => true } as unknown as THREE.Frustum;
      visuals.updateCulling(new THREE.Vector3(0, 5, 10), frustum, 500, () => false);
      const ramp = visuals.group.getObjectByName('render-near-ramp') as THREE.InstancedMesh;
      expect(ramp.count).toBe(2);
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      const treadHeight = (x: number, t: number): number => {
        ray.ray.origin.set(x, 10, (t - .5) * 9);
        return ray.intersectObject(ramp)[0]!.point.y;
      };
      expect(treadHeight(-5, .25)).toBeCloseTo(1.25, 2);
      expect(treadHeight(-5, .75)).toBeCloseTo(2.75, 2);
      expect(treadHeight(5, .75)).toBeCloseTo(1.25, 2);
      expect(treadHeight(5, .25)).toBeCloseTo(2.75, 2);
    } finally {
      visuals.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('keeps all seven GLB colours untinted and at full near/far detail', async () => {
    const kinds = ['ac-unit', 'planter', 'bench', 'gnome',
      'hay-bale', 'ramp', 'buoy'] as const;
    const authoredPaint = new THREE.Color(0x5299c2);
    const prefab = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16),
      new THREE.MeshStandardMaterial({ color: authoredPaint }));
    prefab.add(mesh);
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene: prefab } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    vi.stubGlobal('document', {});
    const props: PropDescriptor[] = kinds.map((kind, i) => ({
      id: 'authored-town-farm-' + kind, kind,
      transform: { position: { x: i * 3 - 9, y: 1, z: 0 }, rotationY: 0 },
      size: { x: 2, y: 2, z: 2 },
      shape: 'cuboid', body: { type: 'static' },
      collidable: true, breakable: false, lickable: true, climbable: true,
      // Deliberately conflicting colour must not wash out authored paint.
      color: 0xff0000,
    }));
    const visuals = buildPropVisuals(props);
    try {
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true),
        { timeout: 15000 });
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      const actual = new THREE.Color();
      for (const kind of kinds) {
        expect(load).toHaveBeenCalledWith(publicAssetUrl(PROP_LIBRARY_MODELS[kind]));
        const source = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        const near = visuals.group.getObjectByName('render-near-' + kind) as THREE.InstancedMesh;
        const far = visuals.group.getObjectByName('render-far-' + kind) as THREE.InstancedMesh;
        expect(source, kind).toBeInstanceOf(THREE.InstancedMesh);
        expect(near.geometry, kind).toBe(source.geometry);
        expect(far.geometry, kind).toBe(source.geometry);
        expect(source.geometry.getAttribute('position').count / 3, kind)
          .toBeGreaterThan(48);
        const colours = source.geometry.getAttribute('color');
        expect(colours.getX(0), kind).toBeCloseTo(authoredPaint.r, 5);
        expect(colours.getY(0), kind).toBeCloseTo(authoredPaint.g, 5);
        expect(colours.getZ(0), kind).toBeCloseTo(authoredPaint.b, 5);
        source.getColorAt(0, actual);
        expect(actual.getHex(), kind).toBe(0xffffff);
      }
      const visible = { intersectsSphere: () => true } as unknown as THREE.Frustum;
      for (const [distance, level] of [[20, 'near'], [100, 'far']] as const) {
        visuals.updateCulling(new THREE.Vector3(0, 1, distance), visible, 500, () => false);
        for (const kind of kinds) {
          const drawn = visuals.group.getObjectByName(
            'render-' + level + '-' + kind) as THREE.InstancedMesh;
          expect(drawn.count, kind + ' ' + level).toBe(1);
          drawn.getColorAt(0, actual);
          expect(actual.getHex(), kind + ' ' + level).toBe(0xffffff);
        }
      }
    } finally {
      visuals.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('palette atlas baking', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])('samples all four 2x2 texels with flipY=%s', flipY => {
    // Canvas ImageData is top-down: red/green on the first row, blue/yellow
    // on the second. Both GLTFLoader (flipY=false) and regular textures
    // (flipY=true) must bake those colours onto the matching UV corners.
    const imageData = new Uint8ClampedArray([
      255, 0, 0, 255,     0, 255, 0, 255,
      0, 0, 255, 255,     255, 255, 0, 255,
    ]);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({ data: imageData }),
        }),
      }),
    });

    const map = new THREE.Texture();
    map.image = { width: 2, height: 2 };
    map.flipY = flipY;
    const source = new THREE.BufferGeometry();
    // A non-planar quad ensures the Hoofington baker has a 3D bounding box.
    source.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,  1, 0, 0,  0, 1, 1,  1, 0, 1,
    ], 3));
    // Each corner sits at a different texel centre.
    source.setAttribute('uv', new THREE.Float32BufferAttribute([
      0.25, 0.25,  0.75, 0.25,  0.25, 0.75,  0.75, 0.75,
    ], 2));
    const triangleCorners = [0, 1, 2, 1, 3, 2];
    source.setIndex(triangleCorners);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(source, material));

    const geometries = [
      bakeLibraryPropGeometry('crate', root),
      bakeLibraryGeometry([{
        model: 'palette', position: { x: 0, y: 0, z: 0 },
        size: { x: 2, y: 2, z: 2 }, yaw: 0,
      }], new Map([['palette', root]])),
    ];
    const corners = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00];
    for (const geometry of geometries) {
      expect(geometry).not.toBeNull();
      const colours = geometry!.getAttribute('color');
      expect(colours.count).toBe(triangleCorners.length);
      for (let i = 0; i < triangleCorners.length; i++) {
        const expected = new THREE.Color(corners[triangleCorners[i]!]!);
        expect(colours.getX(i), 'vertex ' + i + ' red').toBeCloseTo(expected.r, 5);
        expect(colours.getY(i), 'vertex ' + i + ' green').toBeCloseTo(expected.g, 5);
        expect(colours.getZ(i), 'vertex ' + i + ' blue').toBeCloseTo(expected.b, 5);
      }
      geometry!.dispose();
    }
    source.dispose();
    material.dispose();
    map.dispose();
  });
});
