import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropDescriptor, PropKind } from './types';
import { bakeLibraryPropGeometry, PROP_LIBRARY_MODELS } from './library-props';
import { bakeLibraryGeometry } from './visual-hoofington';
import { buildPropVisuals } from './visual-props';
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

describe('CC0 library prop catalog', () => {
  it('covers every PropKind and every path exists locally with a CC0 licence', () => {
    // The satisfies Record<PropKind, string> declaration enforces exhaustive
    // coverage at typecheck time, including any newly added descriptor kind.
    expect(mapped).toHaveLength(72);
    expect(new Set(mapped.map(([kind]) => kind)).size).toBe(mapped.length);
    for (const [kind, path] of mapped) {
      const entry = byPath.get(path);
      expect(entry, kind + ': missing from the library manifest').toBeDefined();
      expect(entry?.license, kind + ': only CC0 assets are allowed').toBe('CC0');
      expect(existsSync(new URL('../../public/' + path, import.meta.url)),
        kind + ': missing file ' + path).toBe(true);
      expect(publicAssetUrl(path, '/GiggaGoat/src/world/viewer/index.html', './'),
        kind + ': bad GitHub Pages URL').toBe('/GiggaGoat/' + path);
    }
  });

  it('prefers coherent, genuinely sourced models for the art-camera details', () => {
    const expected: Partial<Record<PropKind, string>> = {
      'tree-oak': 'custom/hoofington-props/tree-round-a.glb',
      'tree-pine': 'nature-kit/tree_pineTallA.glb',
      bush: 'custom/hoofington-props/bush-round-a.glb',
      flower: 'custom/hoofington-props/flowers-pink.glb',
      'grass-tuft': 'custom/hoofington-props/daisies.glb',
      lamp: 'city-kit-roads/light-curved.glb',
      bench: 'retro-urban-kit/detail-bench.glb',
      fence: 'custom/hoofington-props/picket-fence.glb',
      mailbox: 'custom/hoofington-props/mailbox.glb',
      silo: 'custom/hoofington-props/silo.glb',
      windmill: 'custom/hoofington-props/windmill.glb',
      crate: 'platformer-kit/crate.glb',
      barrel: 'survival-kit/barrel.glb',
      shop: 'city-kit-commercial/building-a.glb',
      'ferris-wheel': 'ferris-wheel_6CepsZjXBw.glb',
      crane: 'factory-kit/crane.glb',
      container: 'city-kit-industrial/shipping-container-a.glb',
    };
    for (const [kind, suffix] of Object.entries(expected))
      expect(PROP_LIBRARY_MODELS[kind as PropKind], kind).toContain(suffix);
  });
});

describe('library geometry batching', () => {
  it.each(['tree-oak', 'bush', 'flower', 'grass-tuft', 'fence', 'mailbox',
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

  it.each([
    ['tree-pine', 0x478f62],
    ['planter', 0x77b65f],
  ] as const)('keeps the existing %s foliage paint', (kind, hex) => {
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const source = new THREE.Group();
    source.add(new THREE.Mesh(geometry, material));
    const baked = bakeLibraryPropGeometry(kind, source)!;
    const colours = baked.getAttribute('color');
    const expected = new THREE.Color(hex);
    // The upper vertices use each legacy foliage override.
    for (let i = 0; i < colours.count; i++) {
      const y = baked.getAttribute('position').getY(i);
      if (y <= 0) continue;
      expect(colours.getX(i)).toBeCloseTo(expected.r, 5);
      expect(colours.getY(i)).toBeCloseTo(expected.g, 5);
      expect(colours.getZ(i)).toBeCloseTo(expected.b, 5);
    }
    baked.dispose(); geometry.dispose(); material.dispose();
  });

  it('bakes multiple transformed model parts and their material paint into one unit envelope', () => {
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
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(geometry!.boundingBox!.min[axis]).toBeGreaterThanOrEqual(-0.5);
      expect(geometry!.boundingBox!.max[axis]).toBeLessThanOrEqual(0.5);
    }
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
