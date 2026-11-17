import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
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
      'tree-oak': 'nature-kit/tree_oak.glb',
      'tree-pine': 'nature-kit/tree_pineTallA.glb',
      bush: 'nature-kit/plant_bushDetailed.glb',
      flower: 'nature-kit/flower_purpleA.glb',
      lamp: 'city-kit-roads/light-curved.glb',
      bench: 'retro-urban-kit/detail-bench.glb',
      fence: 'city-kit-suburban/fence.glb',
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
