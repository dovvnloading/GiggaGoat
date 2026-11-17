import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadLibraryPropGeometry, PROP_LIBRARY_MODELS } from './library-props';
import type { PropDescriptor, PropKind } from './types';
import { buildArchitecture, isArchitecturalKind } from './visual-architecture';
import type { IslandData } from './types';
import { WORLD_LOD, completelyOccluded, isSmallWorldModel,
  simplifiedWorldGeometry } from './lod';

export interface PropBatch {
  sphere: THREE.Sphere;
  meshes: THREE.InstancedMesh[];
  nearOnly: boolean;
}
export interface PropVisuals {
  group: THREE.Group;
  batches: PropBatch[];
  update(time: number): void;
  /** Compact real visible instances into cached near/far library geometry. */
  updateCulling(position: THREE.Vector3, frustum: THREE.Frustum, maxDistance: number,
    hidden: (mesh: THREE.InstancedMesh) => boolean): boolean;
  /** Async asset swaps can change the static shadow caster silhouette. */
  consumeShadowChange(): boolean;
  dispose(): void;
}

/** Shared four-step hand-painted lighting ramp. */
export const TOON_RAMP = new THREE.DataTexture(
  new Uint8Array([104,104,104,255, 153,153,153,255, 209,209,209,255, 255,255,255,255]),
  4, 1, THREE.RGBAFormat,
);
TOON_RAMP.magFilter = THREE.NearestFilter;
TOON_RAMP.minFilter = THREE.NearestFilter;
TOON_RAMP.generateMipmaps = false;
TOON_RAMP.needsUpdate = true;

/**
 * Buildings read as solid painted volumes in the concept art: sunlit walls
 * are clearly brighter than walls facing away. The foliage ramp above is too
 * flat for that (shaded faces kept ~60% of the key light), so batched
 * buildings use this two-band ramp instead (~1.5:1 lit vs shaded with fill).
 */
export const BUILDING_RAMP = new THREE.DataTexture(
  new Uint8Array([108,108,108,255, 108,108,108,255, 216,216,216,255, 255,255,255,255]),
  4, 1, THREE.RGBAFormat,
);
BUILDING_RAMP.magFilter = THREE.NearestFilter;
BUILDING_RAMP.minFilter = THREE.NearestFilter;
BUILDING_RAMP.generateMipmaps = false;
BUILDING_RAMP.needsUpdate = true;

const COLORS: Partial<Record<PropKind, number>> = {
  barn: 0xd84f3d, house: 0xf4da9a, shop: 0x9ed4e8, tower: 0xb6bbc7,
  windmill: 0xf3ead6, lighthouse: 0xf9e5cc, 'ferris-wheel': 0xf5a0c1,
  crane: 0xffc94c, scaffold: 0xd4a667, beam: 0xffc44e, pier: 0xaf845b,
  'pier-rail': 0xffffff, deck: 0xb68a66, bumper: 0xdf8bdc, booth: 0xf7a07e,
  'satellite-dish': 0xdce5e8, 'dam-wall': 0xa4b1bc, fence: 0xe5c587,
  'hay-bale': 0xf2c14f, crate: 0xc4915f, barrel: 0xe67d5d,
  rock: 0x8c919e, log: 0x9a6d48, lamp: 0xffe5b7, ramp: 0xe5b974,
  ledge: 0x77b754, bridge: 0xb28f6a, bench: 0x8c714e, sign: 0xf6e3c2,
  flag: 0xf66e95, buoy: 0xf79a4e, platform: 0xc9b08c, silo: 0xe3ddc8,
  mailbox: 0xd84f3d, gnome: 0xf77c4f, trampoline: 0x7960d9,
  bunting: 0xffd833, container: 0x5da4bd, cone: 0xff891e,
  awning: 0xf2777f, planter: 0xb67f5b, fountain: 0x9ac7cd,
  'ac-unit': 0xc5d1d4, 'water-tower': 0xb59c75, mushroom: 0xe67768,
  stump: 0x956a4c, lookout: 0x916d4c, 'control-house': 0xc9d8d0,
  dock: 0xb28b60, cottage: 0xf3c7a5, shipwreck: 0x866144,
  'cave-mouth': 0x4c515b, 'rope-rail': 0x986e4a,
  'stepping-stone': 0x9ca2a8, signboard: 0xf5d793,
};
const authoredCraneYardKinds = new Set<PropKind>([
  'crane', 'crane-jib', 'crane-cab', 'crane-cable', 'red-girder',
]);
const foliage = new Set<PropKind>([
  'tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft', 'mushroom',
  'gnome', 'ferris-wheel', 'lighthouse', 'bunting',
  'crane', 'concrete-slab', 'concrete-column', 'yard-scaffold', 'safety-rail',
  'chain-fence', 'crane-jib', 'crane-cab', 'crane-cable', 'red-girder',
  'pipe-stack', 'site-barrier',
]);

/** Build one reusable, genuinely compound silhouette per prop kind. */
function geometryFor(kind: PropKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  function append(g: THREE.BufferGeometry, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, color = 0xffffff,
    rz = 0, rx = 0): void {
    // Icosahedra are non-indexed, while cylinders and boxes are indexed.
    // Normalize every part before merging so mixed silhouettes stay renderable.
    if (g.index) {
      const unpacked = g.toNonIndexed();
      g.dispose();
      g = unpacked;
    }
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
      new THREE.Vector3(sx, sy, sz),
    ));
    const c = new THREE.Color(color), n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
    c = 0xffffff, rz = 0): void =>
    append(new THREE.BoxGeometry(1, 1, 1), x, y, z, sx, sy, sz, c, rz);
  const cyl = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
    c = 0xffffff, radial = 9, rx = 0): void =>
    append(new THREE.CylinderGeometry(0.5, 0.5, 1, radial), x, y, z, sx, sy, sz, c, 0, rx);
  const cone = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
    c = 0xffffff, radial = 6): void =>
    append(new THREE.ConeGeometry(0.5, 1, radial), x, y, z, sx, sy, sz, c);
  const rock = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
    c = 0xffffff): void =>
    append(new THREE.IcosahedronGeometry(0.65, 0), x, y, z, sx, sy, sz, c);
  const blob = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
    c = 0xffffff): void =>
    append(new THREE.DodecahedronGeometry(0.56, 0), x, y, z, sx, sy, sz, c);
  // Thin diagonal bars for open steel trusses and chain-link panels.
  const brace = (x0: number, y0: number, x1: number, y1: number,
    z: number, thickness: number, color: number): void => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    box((x0 + x1) / 2, (y0 + y1) / 2, z, length, thickness, thickness,
      color, Math.atan2(y1 - y0, x1 - x0));
  };
  if (kind === 'silo') {
    cyl(0, -0.1, 0, 0.85, 0.8, 0.85, 0xdedcd0, 12);
    cone(0, 0.4, 0, 0.96, 0.26, 0.96, 0xb8c5ca, 12);
    for (let i = 0; i < 4; i++) cyl(0, -0.3 + i * 0.19, 0,
      0.89, 0.025, 0.89, 0xb6b2a8, 12);
  } else if (kind === 'lighthouse') {
    // Five actual alternating tapered masonry courses, not pencil-thin red
    // rings on a white cylinder. The gallery and open glass lantern are
    // authored together so the entire beacon remains one instanced draw.
    const bands = [0xbb4037, 0xfff0d8, 0xbd4439, 0xfff1dd, 0xb94237];
    for (let i = 0; i < bands.length; i++) {
      const baseY = -0.49 + i * 0.142;
      const bottom = 0.445 - i * 0.021;
      const top = bottom - 0.022;
      append(new THREE.CylinderGeometry(top, bottom, 0.144, 20),
        0, baseY + 0.071, 0, 1, 1, 1, bands[i]!);
    }
    cyl(0, 0.234, 0, 0.77, 0.058, 0.77, 0x6e4038, 20);
    cyl(0, 0.265, 0, 0.96, 0.06, 0.96, 0x9e4734, 20);
    cyl(0, 0.342, 0, 0.58, 0.152, 0.58, 0xffd179, 12);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const x = Math.cos(a) * 0.40, z = Math.sin(a) * 0.40;
      cyl(x, 0.330, z, 0.023, 0.13, 0.023, 0x753f31, 6);
    }
    cyl(0, 0.400, 0, 0.85, 0.027, 0.85, 0x7a3b32, 20);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      cyl(Math.cos(a) * 0.24, 0.346, Math.sin(a) * 0.24,
        0.027, 0.133, 0.027, 0x69453a, 6);
    }
    cyl(0, 0.43, 0, 0.72, 0.055, 0.72, 0xb54136, 16);
    cone(0, 0.49, 0, 0.86, 0.14, 0.86, 0xb93f32, 16);
    cyl(0, 0.563, 0, 0.024, 0.12, 0.024, 0x633b2f, 6);
    blob(0, 0.63, 0, 0.05, 0.05, 0.05, 0xf6c15a);
    // Small warm windows make the stripes read as inhabitable masonry.
    for (const height of [-0.22, 0.075]) {
      box(0, height, 0.377, 0.13, 0.105, 0.025, 0xffd777);
      box(0.377, height, 0, 0.025, 0.105, 0.13, 0xffdf87);
    }
  } else if (kind === 'windmill') {
    cyl(0, -0.06, 0, 0.68, 0.85, 0.68, 0xf5e5cb, 8);
    cone(0, 0.41, 0, 0.88, 0.26, 0.88, 0xbd8064, 8);
    cyl(0, 0.14, 0.40, 0.18, 0.20, 0.18, 0x775844);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      box(Math.cos(a) * 0.26, 0.14 + Math.sin(a) * 0.26, 0.49,
        0.16, 0.59, 0.04, 0xf1e6c7, -a);
    }
  } else if (kind === 'ferris-wheel') {
    // Candy-coloured open wheel: two rims, illuminated bulbs, radial spokes,
    // individual suspended cabins and an A-frame anchored to the platform.
    for (const z of [-0.09, 0.09]) {
      append(new THREE.TorusGeometry(0.425, 0.023, 5, 40),
        0, 0, z, 1, 1, 1, z < 0 ? 0xffd0e0 : 0xffb2ce);
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6;
        box(0, 0, z, 0.018, 0.82, 0.025, i % 2 ? 0xffe7d0 : 0xf391b6, angle);
        const x = Math.sin(angle) * 0.425, y = -Math.cos(angle) * 0.425;
        blob(x, y, z + (z < 0 ? -0.025 : 0.025),
          0.023, 0.023, 0.024, 0xfff2c6);
      }
    }
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5;
      const x = Math.sin(angle) * 0.425, y = -Math.cos(angle) * 0.425;
      const paint = [0xe95f72, 0xffc85b, 0x63c3c6, 0x8b79d3, 0xf18d56][i % 5]!;
      box(x, y, 0.15, 0.105, 0.092, 0.105, paint);
      box(x, y + 0.056, 0.15, 0.125, 0.025, 0.115, 0xffecce);
      box(x, y + 0.004, 0.211, 0.045, 0.04, 0.014, 0xffefc8);
    }
    append(new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
      0, 0, 0, 0.17, 0.17, 0.19, 0xffd16c, 0, Math.PI / 2);
    for (const side of [-1, 1]) {
      box(side * 0.18, -0.275, 0, 0.046, 0.64, 0.085,
        0xc6d7d8, side * 0.4);
    }
  } else if (kind === 'crane') {
    // Free-standing lattice tower: thick square legs, open cross-bracing,
    // yellow collars and a grounded striped foot. The horizontal jib is an
    // independent collider/visual, not squeezed into this mast's envelope.
    for (const x of [-0.35, 0.35]) for (const z of [-0.35, 0.35]) {
      box(x, 0, z, 0.09, 0.96, 0.09, 0xffbf22);
    }
    for (let i = 0; i <= 10; i++) {
      const y = -0.44 + i * 0.088;
      for (const z of [-0.35, 0.35])
        box(0, y, z, 0.79, 0.022, 0.045, 0xffdd45);
      for (const x of [-0.35, 0.35])
        box(x, y, 0, 0.045, 0.022, 0.79, 0xffd136);
      if (i < 10) {
        const next = y + 0.088;
        for (const z of [-0.35, 0.35])
          brace(i % 2 ? 0.35 : -0.35, y, i % 2 ? -0.35 : 0.35,
            next, z, 0.022, 0xd99b12);
      }
    }
    box(0, -0.48, 0, 0.99, 0.038, 0.99, 0x555b66);
    for (const x of [-0.37, 0.37])
      box(x, -0.479, 0.42, 0.18, 0.035, 0.1, 0xffd344);
    box(0, 0.47, 0, 0.93, 0.055, 0.93, 0xfcc032);
    cyl(0, 0.50, 0, 0.43, 0.07, 0.43, 0x4b5661, 10);
  } else if (kind === 'crane-jib') {
    // 3-D triangular lattice, a much longer and lighter silhouette than a
    // solid yellow cuboid. Wind-bracing is merged into one instanced mesh.
    const yellow = 0xffce2d, highlight = 0xffe063, shade = 0xc8910e;
    for (const z of [-0.32, 0.32]) {
      box(0, -0.25, z, 0.97, 0.065, 0.045, yellow);
      box(0, 0.23, z, 0.97, 0.055, 0.045, highlight);
      for (let i = 0; i < 15; i++) {
        const x0 = -0.48 + i * 0.064;
        const x1 = x0 + 0.064;
        brace(x0, -0.22, x1, 0.20, z, 0.022, i % 2 ? shade : yellow);
        if (i % 3 === 0)
          box(x0, 0, z, 0.02, 0.50, 0.035, yellow);
      }
    }
    for (let i = 0; i <= 15; i++) {
      const x = -0.48 + i * 0.064;
      box(x, 0.22, 0, 0.019, 0.04, 0.71, highlight);
      if (i % 3 === 0) box(x, -0.25, 0, 0.026, 0.045, 0.71, yellow);
    }
    // Trolley and travel wheels at the load end.
    box(0.34, -0.29, 0, 0.065, 0.12, 0.59, 0x677078);
    for (const z of [-0.31, 0.31])
      cyl(0.34, -0.34, z, 0.065, 0.055, 0.065, 0x444d57, 8);
  } else if (kind === 'crane-cab') {
    box(0, 0, 0, 0.94, 0.80, 0.83, 0xffc733);
    box(0, -0.43, 0, 1, 0.12, 0.94, 0x626c72);
    box(0, 0.44, 0, 1, 0.085, 0.93, 0xffde58);
    box(0, 0.045, 0.435, 0.78, 0.64, 0.018, 0x75c6e5);
    box(0.475, 0.045, 0, 0.022, 0.64, 0.69, 0x8fd1eb);
    box(0, 0.04, 0.45, 0.045, 0.65, 0.028, 0xe8df9e);
    box(0, 0.03, 0.46, 0.81, 0.032, 0.028, 0xd7e1e4);
  } else if (kind === 'crane-cable') {
    cyl(0, 0, 0, 0.52, 0.995, 0.52, 0x38424a, 6);
  } else if (kind === 'red-girder') {
    // Long red I-beam carried horizontally below the hoist cable.
    box(0, 0, 0, 0.98, 0.21, 0.24, 0xd93b2c);
    for (const y of [-0.33, 0.33])
      box(0, y, 0, 1, 0.20, 0.89, 0xff593b);
    for (const x of [-0.42, 0.42])
      box(x, 0, 0, 0.045, 0.81, 0.91, 0xba3029);
  } else if (kind === 'concrete-slab') {
    box(0, -0.06, 0, 1, 0.84, 1, 0xc1c4c6);
    box(0, 0.41, 0, 1, 0.075, 1, 0xe2e1db);
    box(0, -0.47, 0.485, 0.99, 0.055, 0.025, 0x969ba0);
    for (const x of [-0.42, 0.42])
      box(x, 0.45, 0, 0.014, 0.012, 0.97, 0xb4b4ac);
  } else if (kind === 'concrete-column') {
    box(0, -0.07, 0, 0.72, 0.86, 0.74, 0xc4c9cd);
    box(0, -0.45, 0, 0.89, 0.09, 0.87, 0x9caaae);
    box(0, 0.36, 0, 0.78, 0.12, 0.78, 0xe1e2df);
    // Exposed dark rebar protrudes above the unfinished top storey.
    for (const x of [-0.23, 0.23]) for (const z of [-0.23, 0.23])
      box(x, 0.445, z, 0.065, 0.10, 0.065, 0x7c6760);
  } else if (kind === 'yard-scaffold') {
    const steel = 0xffcd27, pale = 0xffe66c;
    for (const x of [-0.43, 0.43]) for (const z of [-0.41, 0.41])
      box(x, 0, z, 0.045, 0.98, 0.045, steel);
    for (let level = 0; level <= 5; level++) {
      const y = -0.48 + level * 0.19;
      for (const z of [-0.41, 0.41])
        box(0, y, z, 0.93, 0.028, 0.038, pale);
      for (const x of [-0.43, 0.43])
        box(x, y, 0, 0.04, 0.029, 0.91, pale);
      if (level > 0 && level < 5)
        box(0, y - 0.014, 0, 0.89, 0.024, 0.84, 0x9a8771);
      if (level < 5) {
        const next = y + 0.19;
        for (const z of [-0.41, 0.41])
          brace(level % 2 ? 0.43 : -0.43, y,
            level % 2 ? -0.43 : 0.43, next, z, 0.022, steel);
      }
    }
    for (let i = 0; i < 11; i++)
      box(-0.3, -0.44 + i * 0.08, 0.37, 0.26, 0.022, 0.04, pale);
  } else if (kind === 'safety-rail') {
    for (let i = 0; i <= 8; i++)
      box(-0.47 + i * 0.1175, -0.01, 0, 0.032, 0.97, 0.12, 0xf8cd29);
    for (const y of [-0.08, 0.36])
      box(0, y, 0, 0.99, 0.04, 0.12, 0xffe15d);
  } else if (kind === 'chain-fence') {
    // Perforated steel mesh (not an opaque board or farm picket fence).
    for (const x of [-0.49, 0.49]) {
      cyl(x, 0, 0, 0.042, 1, 0.042, 0x687b88, 7);
      cyl(x, -0.48, 0, 0.10, 0.035, 0.10, 0x88969b, 7);
    }
    for (const y of [-0.45, 0.45])
      box(0, y, 0, 0.99, 0.027, 0.065, 0x8fa1aa);
    for (let i = 0; i < 11; i++) {
      const x = -0.40 + i * 0.08;
      brace(x - 0.07, -0.435, x + 0.07, 0.435, 0,
        0.008, 0xa6b5be);
      brace(x + 0.07, -0.435, x - 0.07, 0.435, 0,
        0.008, 0xa6b5be);
    }
  } else if (kind === 'pipe-stack') {
    // Six open-ended concrete drainage pipes, stacked 3/2/1.
    const pipePositions: Array<[number, number]> = [
      [-0.30, -0.29], [0, -0.29], [0.30, -0.29],
      [-0.15, 0.0], [0.15, 0.0], [0, 0.29],
    ];
    for (const [x, y] of pipePositions) {
      append(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true),
        x, y, 0, 0.27, 0.86, 0.27, 0xc0c5c8, 0, Math.PI / 2);
      for (const z of [-0.44, 0.44])
        append(new THREE.TorusGeometry(0.135, 0.027, 5, 12),
          x, y, z, 1, 1, 1, 0x8b979d);
    }
  } else if (kind === 'site-barrier') {
    box(0, -0.08, 0, 1, 0.75, 0.93, 0xf0eee6);
    box(0, -0.47, 0, 1.02, 0.085, 1, 0x999e9e);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++)
      box(-0.42 + i * 0.27, 0, side * 0.48,
        0.18, 0.48, 0.035, 0xe7674b, -0.44);
  } else if (kind === 'tower' || kind === 'scaffold' || kind === 'lookout') {
    for (const x of [-0.42, 0.42]) for (const z of [-0.42, 0.42]) {
      box(x, 0, z, 0.065, 1, 0.065, kind === 'tower' ? 0xb3bec6 : 0xa47b55);
    }
    for (let i = 0; i <= 4; i++) {
      box(0, -0.48 + i * 0.24, 0, 0.92, 0.06, 0.92, 0xbfa282);
      box(0, -0.36 + i * 0.24, 0.41, 0.06, 0.26, 0.04, 0xb58851,
        i % 2 ? 0.46 : -0.46);
    }
    if (kind === 'lookout') cone(0, 0.56, 0, 1.3, 0.21, 1.3, 0x905b4a, 4);
  } else if (kind === 'tree-pine') {
    cyl(0, -0.23, 0, 0.22, 0.55, 0.22, 0x76523b, 6);
    cone(0, -0.10, 0, 0.94, 0.54, 0.94, 0x326e54, 7);
    cone(0, 0.13, 0, 0.78, 0.59, 0.78, 0x419965, 7);
    cone(0, 0.34, 0, 0.56, 0.50, 0.56, 0x58b175, 7);
  } else if (kind === 'tree-oak') {
    cyl(0, -0.22, 0, 0.22, 0.6, 0.22, 0x80654b, 7);
    blob(-0.19, 0.24, 0, 0.7, 0.6, 0.72, 0x6bab52);
    blob(0.19, 0.18, 0.04, 0.7, 0.65, 0.72, 0x7fbd5d);
    blob(0, 0.38, -0.10, 0.72, 0.58, 0.72, 0x88c369);
  } else if (kind === 'bush') {
    blob(-0.23, -0.13, 0, 0.62, 0.62, 0.75, 0x5e9c50);
    blob(0.18, -0.06, 0.1, 0.64, 0.68, 0.62, 0x79b958);
    blob(0, 0.17, 0, 0.62, 0.64, 0.64, 0x8cc967);
  } else if (kind === 'flower') {
    cyl(0, -0.20, 0, 0.10, 0.6, 0.1, 0x508f4b, 5);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      blob(Math.cos(a) * 0.24, 0.24, Math.sin(a) * 0.24,
        0.35, 0.34, 0.35, i % 2 ? 0xffd46f : 0xf4a8b4);
    }
    blob(0, 0.26, 0, 0.3, 0.3, 0.3, 0xffef8a);
  } else if (kind === 'grass-tuft') {
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      append(new THREE.ConeGeometry(0.20, 0.9, 3),
        Math.cos(a) * 0.21, 0.02, Math.sin(a) * 0.21,
        0.56, 0.9, 0.56, i % 2 ? 0x7cba4e : 0xa4d278,
        Math.cos(a) * 0.2, Math.sin(a) * 0.2);
    }
  } else if (kind === 'mushroom') {
    cyl(0, -0.15, 0, 0.26, 0.72, 0.26, 0xf7e5b6, 6);
    blob(0, 0.24, 0, 1.08, 0.40, 1.08, 0xd96165);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      blob(Math.cos(a) * 0.28, 0.43, Math.sin(a) * 0.28,
        0.18, 0.08, 0.18, 0xffffff);
    }
  } else if (kind === 'gnome') {
    cyl(0, -0.2, 0, 0.63, 0.5, 0.63, 0x556f98, 7);
    blob(0, 0.06, 0, 0.65, 0.38, 0.65, 0xf4c3a6);
    cone(0, 0.35, 0, 0.86, 0.54, 0.86, 0xe24b51, 8);
    blob(0, 0.02, 0.30, 0.22, 0.18, 0.18, 0xf9d5ad);
  } else if (kind === 'fountain') {
    cyl(0, -0.38, 0, 1.0, 0.23, 1, 0xa8afb9, 14);
    cyl(0, -0.24, 0, 0.78, 0.10, 0.78, 0x5daec2, 14);
    cyl(0, -0.01, 0, 0.16, 0.44, 0.16, 0xb8c1c4, 8);
    cyl(0, 0.22, 0, 0.47, 0.12, 0.47, 0x88cadd, 12);
    blob(0, 0.36, 0, 0.21, 0.21, 0.21, 0xb5ecf3);
  } else if (kind === 'water-tower') {
    for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) {
      box(x, -0.25, z, 0.07, 0.53, 0.07, 0x98704e);
    }
    cyl(0, 0.25, 0, 0.88, 0.35, 0.88, 0x9b7455, 10);
    cone(0, 0.46, 0, 0.96, 0.18, 0.96, 0x81644d, 9);
  } else if (kind === 'satellite-dish') {
    cyl(0, -0.20, 0, 0.18, 0.6, 0.18, 0xb5c0c6);
    append(new THREE.SphereGeometry(0.5, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      0, 0.18, 0, 0.95, 0.55, 0.95, 0xe8eef0, 0, -0.65);
    cyl(0, 0.31, 0.13, 0.07, 0.27, 0.07, 0x6f7a8a);
  } else if (kind === 'shipwreck') {
    box(0, -0.31, 0, 0.88, 0.29, 0.56, 0x7e573e);
    for (const x of [-0.37, -0.12, 0.12, 0.37]) {
      box(x, -0.10, 0, 0.07, 0.40, 0.62, 0xaf855c, x * 0.45);
    }
    box(-0.2, 0.24, 0, 0.09, 0.68, 0.08, 0x5d493d, -0.3);
    box(0.2, 0.14, 0, 0.08, 0.50, 0.08, 0x76533e, 0.35);
  } else if (kind === 'cave-mouth') {
    box(0, 0.34, 0, 1, 0.32, 0.55, 0x696e79);
    box(-0.43, -0.13, 0, 0.16, 0.80, 0.56, 0x777b85);
    box(0.43, -0.13, 0, 0.16, 0.80, 0.56, 0x777b85);
    box(0, -0.15, -0.22, 0.74, 0.71, 0.05, 0x1c2e3c);
    for (let i = 0; i < 4; i++) {
      rock(-0.35 + i * 0.23, 0.44, 0.1, 0.35, 0.24, 0.36, 0x9a9aa0);
    }
  } else if (kind === 'ledge') {
    // Rock shelf below a shallow grassy landing: not the dark floating cube
    // produced by a plain box and an oversized inverted-hull outline.
    box(0, -0.09, 0, 0.98, 0.76, 0.98, 0x8c919e);
    box(0, 0.36, 0, 1, 0.12, 1, 0x78b95a);
    rock(-0.30, -0.29, 0.27, 0.32, 0.29, 0.34, 0xa1a4ad);
  } else if (kind === 'bench') {
    box(0, -0.10, 0, 0.94, 0.12, 0.75, 0xa97d59);
    box(0, 0.12, -0.32, 0.94, 0.42, 0.12, 0xb0895d);
    for (const x of [-0.34, 0.34]) box(x, -0.37, 0, 0.12, 0.25, 0.13, 0x6e6b69);
  } else if (kind === 'fence') {
    // A single low-cost compound silhouette per picket-fence segment.
    // Individual posts remain visible at 30 m without separate draw calls.
    for (let i = 0; i < 8; i++) {
      const x = -0.46 + i * (0.92 / 7);
      box(x, 0, 0, 0.084, 0.82, 0.13, 0xf6e9d2);
      cone(x, 0.44, 0, 0.105, 0.16, 0.15, 0xf6e9d2, 4);
    }
    box(0, 0.15, -0.07, 1, 0.07, 0.07, 0xd4ae83);
    box(0, -0.26, -0.07, 1, 0.07, 0.07, 0xd4ae83);
  } else if (kind === 'rope-rail') {
    for (const x of [-0.46, 0.46]) box(x, 0, 0, 0.10, 1, 0.13, 0x98704e);
    box(0, 0.23, 0, 0.96, 0.045, 0.08, 0xe5d0a0);
    box(0, -0.15, 0, 0.96, 0.045, 0.08, 0xe5d0a0);
  } else if (kind === 'mailbox') {
    cyl(0, -0.17, 0, 0.12, 0.65, 0.12, 0x7b7359);
    box(0, 0.28, 0, 0.68, 0.36, 0.54, 0xcf5448);
    box(0.33, 0.31, 0, 0.05, 0.52, 0.11, 0xffe29c);
  } else if (kind === 'lamp') {
    // Town lamp with a curved lantern bracket and hanging orange village
    // pennant. The luminous cream windows remain separate from its iron frame.
    cyl(0, -0.09, 0, 0.11, 0.82, 0.11, 0x475766, 9);
    cyl(0, -0.45, 0, 0.23, 0.10, 0.23, 0x455867, 9);
    cyl(0, 0.30, 0, 0.18, 0.07, 0.18, 0x687988, 9);
    box(0.18, 0.31, 0, 0.40, 0.065, 0.065, 0x455766);
    box(0.36, 0.235, 0, 0.065, 0.17, 0.064, 0x455766);
    box(0.36, 0.11, 0, 0.235, 0.23, 0.22, 0xffe3a3);
    box(0.36, 0.02, 0, 0.25, 0.046, 0.25, 0x435665);
    cone(0.36, 0.26, 0, 0.33, 0.11, 0.33, 0x435665, 6);
    for (const side of [-1, 1]) {
      box(0.36 + side * 0.12, 0.115, 0,
        0.028, 0.24, 0.245, 0x526476);
    }
    box(-0.19, 0.09, 0.055, 0.27, 0.34, 0.035, 0xe8a63e);
    box(-0.19, 0.16, 0.082, 0.095, 0.11, 0.012, 0xf8efcd);
  } else if (kind === 'crate') {
    box(0, 0, 0, 0.94, 0.93, 0.94, 0xe8bb7f);
    for (const side of [-1, 1]) {
      for (const x of [-0.32, 0, 0.32]) {
        box(x, 0, side * 0.485, 0.025, 0.88, 0.028, 0x9b6e48);
      }
      for (const y of [-0.34, 0.34]) {
        box(0, y, side * 0.488, 0.95, 0.052, 0.027, 0xb47c49);
      }
    }
    for (const x of [-0.41, 0.41])
      box(x, 0, 0, 0.055, 0.95, 0.96, 0xc29158);
  } else if (kind === 'container') {
    box(0, 0, 0, 1, 0.91, 0.96);
    for (const z of [-0.49, 0.49]) for (let i = 0; i < 15; i++)
      box(-0.46 + i * 0.065, 0, z, 0.017, 0.86, 0.025, 0xe7ded5);
    for (const x of [-0.485, 0.485]) {
      for (let i = 0; i < 5; i++)
        box(x, 0, -0.4 + i * 0.2, 0.025, 0.86, 0.022, 0xd0d9d9);
      box(x, 0, 0, 0.03, 0.035, 0.94, 0x737e87);
    }
  } else if (kind === 'cone') {
    cyl(0, -0.46, 0, 1, 0.11, 1, 0x494d54, 4);
    cone(0, -0.02, 0, 0.77, 0.88, 0.77, 0xff891e, 6);
    cyl(0, -0.09, 0, 0.47, 0.08, 0.47, 0xffe9c5, 7);
  } else if (['hay-bale', 'barrel', 'buoy', 'bumper'].includes(kind)) {
    cyl(0, 0, 0, 0.95, 0.94, 0.95, 0xffffff, 9);
    for (const y of [-0.34, 0.34]) cyl(0, y, 0, 0.97, 0.08, 0.97,
      kind === 'hay-bale' ? 0xe3a846 : 0xd8d4c8, 9);
  } else if (kind === 'rock' || kind === 'stepping-stone') {
    rock(0, 0, 0, 0.95, kind === 'stepping-stone' ? 0.54 : 0.93, 0.95, 0xa1a4a9);
  } else if (kind === 'log' || kind === 'stump') {
    cyl(0, 0, 0, 0.92, 0.95, 0.92, 0x9e7855, 8, kind === 'log' ? Math.PI / 2 : 0);
  } else if (kind === 'ramp') {
    const wedge = new THREE.BufferGeometry();
    wedge.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, -0.5,-0.5,0.5,
      0.5,-0.5,0.5, -0.5,0.5,0.5, 0.5,0.5,0.5,
    ], 3));
    wedge.setIndex([0,2,1,1,2,3, 2,4,3,3,4,5, 0,1,4,1,5,4, 0,4,2,1,3,5]);
    wedge.computeVertexNormals();
    append(wedge, 0, 0, 0, 1, 1, 1, 0xe3b577);
  } else if (kind === 'bunting') {
    // Real suspended triangular pennants, not a horizontal striped box.
    box(0, 0.42, 0, 1, 0.02, 0.06, 0xffeed4);
    for (let i = 0; i < 9; i++) {
      const x = -0.44 + i * 0.11;
      const triangle = new THREE.BufferGeometry();
      triangle.setAttribute('position', new THREE.Float32BufferAttribute([
        x - 0.05, 0.4, 0, x + 0.05, 0.4, 0,
        x, -0.35 + (i % 3) * 0.04, 0,
      ], 3));
      triangle.setAttribute('uv', new THREE.Float32BufferAttribute([
        0, 1, 1, 1, 0.5, 0,
      ], 2));
      triangle.setIndex([0, 1, 2, 2, 1, 0]);
      triangle.computeVertexNormals();
      append(triangle, 0, 0, 0, 1, 1, 1,
        [0xff7794, 0xffd364, 0x5ed3c7, 0x7f9ee7][i % 4]);
    }
  } else if (kind === 'awning' || kind === 'flag') {
    if (kind === 'flag') cyl(-0.43, 0, 0, 0.1, 1, 0.1, 0xddd6b8);
    box(kind === 'flag' ? 0.08 : 0, 0.10, 0, 0.96, 0.14, 0.96);
    for (let i = 0; i < 5; i++) box(-0.40 + i * 0.20, -0.07, 0.15,
      0.14, 0.23, 0.80, i % 2 ? 0xffd969 : 0xf7e7d1);
  } else if (kind === 'planter') {
    cyl(0, -0.26, 0, 0.88, 0.46, 0.88, 0xb67f5b);
    blob(0, 0.24, 0, 0.92, 0.72, 0.9, 0x65a04b);
    blob(0.18, 0.42, 0, 0.25, 0.3, 0.22, 0xffd883);
  } else if (kind === 'ac-unit') {
    box(0, 0, 0, 0.92, 0.83, 0.94, 0xc8d4d5);
    cyl(0, 0.44, 0, 0.65, 0.09, 0.65, 0x72878c, 10);
  } else if (kind === 'sign' || kind === 'signboard') {
    if (kind === 'sign') box(0, -0.21, 0, 0.08, 0.58, 0.10, 0x98704e);
    box(0, 0.19, 0, 0.97, 0.54, 0.11, 0xf8e8bf);
    for (let i = 0; i < 3; i++) box(-0.28 + i * 0.25, 0.20, 0.069,
      0.12, 0.18, 0.012, i === 1 ? 0xea8d68 : 0x638b97);
  } else if (kind === 'trampoline') {
    box(0, -0.38, 0, 0.95, 0.16, 0.93, 0x46446e);
    box(0, -0.26, 0, 0.80, 0.06, 0.77, 0x68bbd8);
    for (const x of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) {
      cyl(x, 0.09, z, 0.06, 0.79, 0.06, 0xa3a5b2);
    }
  } else if (kind === 'pier' || kind === 'deck') {
    // Transverse planking over a timber beam, readable from the art camera.
    box(0, -0.055, 0, 1, 0.88, 1, 0xb78760);
    for (let i = 0; i < 35; i++) {
      const z = -0.48 + i * (0.96 / 34);
      box(0, 0.40, z, 1, 0.022, 0.012,
        i % 4 === 0 ? 0x805538 : 0x9e704b);
    }
    for (const x of [-0.34, 0.34]) {
      box(x, 0.405, 0, 0.012, 0.024, 1, 0xd7aa7b);
    }
  } else if (kind === 'pier-rail') {
    // Cream-white balustrade with visible gaps between its two horizontal rails.
    for (const x of [-0.48, 0.48]) {
      box(x, -0.02, 0, 0.065, 0.96, 0.63, 0xfff8ed);
      box(x, 0.465, 0, 0.10, 0.055, 0.77, 0xffffff);
    }
    for (const y of [-0.18, 0.24]) {
      box(0, y, 0, 0.99, 0.064, 0.25, 0xfff5df);
    }
  } else {
    box(0, 0, 0, 1, 1, 1);
    if (kind === 'bridge' || kind === 'dock') {
      for (let i = 0; i < 5; i++) box(-0.39 + i * 0.2, 0.53, 0,
        0.025, 0.075, 1, 0x896348);
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  if (!merged) throw new Error('Could not merge prop geometry ' + kind);
  // Flat-faced boulder normals must be retained after the non-indexed merge;
  // otherwise the cape rocks become unlit black silhouettes at golden hour.
  if (kind === 'rock' || kind === 'stepping-stone') merged.computeVertexNormals();
  // Every kind is authored in its unit descriptor envelope. Without this,
  // tall roof trim and sign geometry extends beyond collider/instance bounds.
  merged.computeBoundingBox();
  const bounds = merged.boundingBox!;
  const centre = bounds.getCenter(new THREE.Vector3());
  const span = bounds.getSize(new THREE.Vector3());
  merged.translate(-centre.x, -centre.y, -centre.z);
  merged.scale(
    Math.min(1, 0.98 / Math.max(span.x, 0.001)),
    Math.min(1, 0.98 / Math.max(span.y, 0.001)),
    Math.min(1, 0.98 / Math.max(span.z, 0.001)),
  );
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
const SHADOW_KINDS = new Set<PropKind>([
  'barn', 'house', 'shop', 'cottage', 'windmill', 'lighthouse',
  'tower', 'crane', 'tree-pine', 'tree-oak', 'silo', 'water-tower',
  'satellite-dish', 'ferris-wheel',
  'concrete-slab', 'concrete-column', 'yard-scaffold', 'crane-jib',
]);
const OUTLINE_KINDS = new Set<PropKind>([
  'windmill', 'ferris-wheel', 'crane', 'satellite-dish',
]);
function sways(kind: PropKind): boolean {
  return ['tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft', 'bunting', 'flag'].includes(kind);
}

/** Spatially batched instancing; LOD/culling works without per-object draw calls. */
export function buildPropVisuals(props: readonly PropDescriptor[], chunkSize = 96,
  island?: IslandData): PropVisuals {
  const group = new THREE.Group();
  group.name = 'handcrafted-props';
  const batches: PropBatch[] = [];
  // One instanced draw per kind rather than one draw per kind *per spatial cell*.
  // Chunk-level visibility is still handled by the terrain and ground detail.
  // A few hundred extra low-poly instances are cheaper than hundreds of draw calls.
  void chunkSize;
  const buckets = new Map<PropKind, PropDescriptor[]>();
  for (const prop of props) {
    // The Dam Bomb gig keeps a data-only walkway anchor; the GLB draws
    // the entire structure, so never instanced-render this old platform.
    if (prop.id.startsWith('the-dam-compat-')) continue;
    const entries = buckets.get(prop.kind) ?? [];
    entries.push(prop);
    buckets.set(prop.kind, entries);
  }
  const geometries = new Map<PropKind, THREE.BufferGeometry>();
  const materials = new Map<PropKind, THREE.MeshToonMaterial>();
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x34424b, side: THREE.BackSide });
  const windUniforms: Array<{ value: number }> = [];
  interface Job {
    kind: PropKind;
    entries: PropDescriptor[];
    mesh: THREE.InstancedMesh; // stable original descriptor index for physics
    batch: PropBatch;
    near?: THREE.InstancedMesh;
    far?: THREE.InstancedMesh;
    nearIndices: number[];
    farIndices: number[];
    originalVersion: number;
    occluded: boolean[];
  }
  const jobs: Job[] = [];
  const dummy = new THREE.Object3D();
  for (const [kind, entries] of buckets) {
    const architecture = isArchitecturalKind(kind) ? buildArchitecture(kind) : null;
    let geometry = geometries.get(kind);
    if (!geometry) { geometry = architecture?.shell ?? geometryFor(kind); geometries.set(kind, geometry); }
    let material = materials.get(kind);
    if (!material) {
      material = new THREE.MeshToonMaterial({
        color: 0xffffff, vertexColors: true, gradientMap: TOON_RAMP,
        side: kind === 'rock' || kind === 'stepping-stone'
          ? THREE.DoubleSide : THREE.FrontSide,
        emissive: kind === 'rock' ? 0x626773 : 0x000000,
        emissiveIntensity: kind === 'rock' ? 0.42 : 0,
        fog: true,
      });
      if (sways(kind)) {
        material.onBeforeCompile = shader => {
          const wind = { value: 0 };
          windUniforms.push(wind);
          shader.uniforms['uWorldWind'] = wind;
          shader.vertexShader = shader.vertexShader.replace('#include <common>',
            '#include <common>\nuniform float uWorldWind;');
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\n#ifdef USE_INSTANCING\n' +
            'float sway = sin(uWorldWind * 1.7 + instanceMatrix[3][0] * 0.113 + ' +
            'instanceMatrix[3][2] * 0.087);\n' +
            'transformed.x += sway * max(0.0, position.y + 0.25) * 0.025;\n' +
            'transformed.z += cos(uWorldWind * 1.26 + instanceMatrix[3][0] * 0.07) * ' +
            'max(0.0, position.y + 0.25) * 0.015;\n#endif');
        };
      }
      materials.set(kind, material);
    }
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    mesh.name = 'props-' + kind;
    mesh.castShadow = SHADOW_KINDS.has(kind);
    mesh.receiveShadow = SHADOW_KINDS.has(kind);
    mesh.frustumCulled = true;
    for (let i = 0; i < entries.length; i++) {
      const prop = entries[i]!;
      const p = prop.transform.position;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, prop.transform.rotationY, 0);
      dummy.scale.set(prop.size.x, prop.size.y, prop.size.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color(foliage.has(kind)
        ? 0xffffff : (prop.color ?? COLORS[kind] ?? 0xc6c0a5)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    const drawn: THREE.InstancedMesh[] = [mesh];
    if (architecture) {
      // A second instanced draw keeps paint colours on only the plaster shell:
      // architectural window glass, flower boxes and tiles stay their own hues.
      // These are all static scenery; the core's dynamic-prop binding still
      // sees exactly one props-<kind> mesh in descriptor order.
      const details = new THREE.InstancedMesh(architecture.details, material, entries.length);
      details.name = 'architecture-details-' + kind;
      details.receiveShadow = true;
      details.castShadow = false;
      const transform = new THREE.Matrix4();
      for (let i = 0; i < entries.length; i++) {
        mesh.getMatrixAt(i, transform);
        details.setMatrixAt(i, transform);
      }
      details.instanceMatrix.needsUpdate = true;
      details.computeBoundingSphere();
      group.add(details);
      drawn.push(details);
    }
    if (OUTLINE_KINDS.has(kind)) {
      const hull = new THREE.InstancedMesh(geometry, outlineMat, entries.length);
      hull.name = 'outline-' + kind;
      hull.frustumCulled = true;
      hull.castShadow = false;
      for (let i = 0; i < entries.length; i++) {
        const prop = entries[i]!;
        const p = prop.transform.position;
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, prop.transform.rotationY, 0);
        const expansion = 1.015;
        dummy.scale.set(prop.size.x * expansion, prop.size.y * expansion,
          prop.size.z * expansion);
        dummy.updateMatrix();
        hull.setMatrixAt(i, dummy.matrix);
      }
      hull.instanceMatrix.needsUpdate = true;
      hull.computeBoundingSphere();
      group.add(hull);
      drawn.push(hull);
    }
    const batch: PropBatch = {
      meshes: drawn, sphere: mesh.boundingSphere?.clone() ?? new THREE.Sphere(),
      // Global instance batches must not vanish when their centre is distant.
      nearOnly: false,
    };
    batches.push(batch);
    jobs.push({ kind, entries, mesh, batch, nearIndices: [], farIndices: [],
      originalVersion: -1,
      occluded: entries.map(entry => Boolean(island && entry.body.type !== 'dynamic' &&
        completelyOccluded(island, entry.transform.position, entry.size, entry))),
    });
  }

  // The procedural silhouettes are synchronous placeholders and genuine
  // failure fallbacks. Once loaded, swap their *geometry*, not the mesh:
  // physics bindings, descriptor order, seeded transforms and draw budget
  // remain exactly as before (one InstancedMesh per kind).
  let disposed = false, shadowChanged = false;
  group.userData['libraryLoaded'] = 0;
  group.userData['libraryFailed'] = 0;
  group.userData['libraryPending'] = jobs.length;
  group.userData['libraryReady'] = typeof document === 'undefined' || !jobs.length;
  if (typeof document !== 'undefined') {
    const loader = new GLTFLoader();
    const cache = new Map<string, Promise<THREE.BufferGeometry>>();
    const priorityKinds: readonly PropKind[] = [
      'tree-oak', 'tree-pine', 'planter', 'bush', 'flower', 'grass-tuft',
      'lamp', 'bench', 'fence', 'shop', 'house', 'cottage', 'crate', 'barrel',
      'sign', 'container', 'crane', 'ferris-wheel',
    ];
    // Populate the art camera first while other district models stream in.
    jobs.sort((a, b) => {
      const left = priorityKinds.indexOf(a.kind), right = priorityKinds.indexOf(b.kind);
      return (left < 0 ? priorityKinds.length : left) -
        (right < 0 ? priorityKinds.length : right);
    });
    let next = 0;
    const white = new THREE.Color(0xffffff), tint = new THREE.Color();
    async function worker(): Promise<void> {
      while (!disposed && next < jobs.length) {
        const job = jobs[next++]!;
        const path = PROP_LIBRARY_MODELS[job.kind];
        let pending = cache.get(path);
        if (!pending) {
          pending = loadLibraryPropGeometry(job.kind, loader);
          cache.set(path, pending);
        }
        try {
          const libraryGeometry = await pending;
          const distantGeometry = await simplifiedWorldGeometry(libraryGeometry);
          if (disposed) {
            if (distantGeometry !== libraryGeometry) distantGeometry.dispose();
            libraryGeometry.dispose();
            return;
          }
          const original = job.mesh.geometry;
          job.mesh.geometry = libraryGeometry;
          // Daisies and crane-yard models keep their authored paint exactly;
          // other props retain mild per-descriptor colour variation.
          for (let i = 0; i < job.entries.length; i++) {
            const color = job.entries[i]!.color;
            job.mesh.setColorAt(i,
              job.kind === 'grass-tuft' || authoredCraneYardKinds.has(job.kind) ||
                color === undefined ? white : tint.setHex(color).lerp(white, 0.82));
          }
          if (job.mesh.instanceColor) job.mesh.instanceColor.needsUpdate = true;
          if (sways(job.kind)) {
            const material = job.mesh.material as THREE.MeshToonMaterial;
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
          }
          job.mesh.computeBoundingSphere();
          job.batch.sphere.copy(job.mesh.boundingSphere ?? new THREE.Sphere());
          // Remove legacy roof/detail and outline draws only on success.
          // On errors they remain as part of the complete fallback.
          for (const extra of job.batch.meshes.slice(1)) {
            group.remove(extra);
            if (extra.geometry !== original) extra.geometry.dispose();
          }
          job.batch.meshes.splice(1);
          // Keep props-<kind> and all descriptor indices intact for the game's
          // physics binding. Camera-visible copies are tightly packed instead:
          // no zero-scale or out-of-frustum instance reaches the GPU.
          const near = new THREE.InstancedMesh(libraryGeometry, job.mesh.material,
            job.entries.length);
          const far = new THREE.InstancedMesh(distantGeometry, job.mesh.material,
            job.entries.length);
          for (const [copy, name] of [[near, 'near'], [far, 'far']] as const) {
            copy.name = 'render-' + name + '-' + job.kind;
            copy.count = 0;
            copy.castShadow = job.mesh.castShadow;
            copy.receiveShadow = job.mesh.receiveShadow;
            copy.frustumCulled = false; // each instance is clipped below
            copy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            group.add(copy);
          }
          job.near = near;
          job.far = far;
          job.batch.meshes.splice(0, job.batch.meshes.length, near, far);
          job.mesh.visible = false;
          original.dispose();
          group.userData['libraryLoaded'] = (group.userData['libraryLoaded'] as number) + 1;
          if (job.mesh.castShadow) shadowChanged = true;
        } catch (error) {
          if (!disposed) {
            group.userData['libraryFailed'] = (group.userData['libraryFailed'] as number) + 1;
            console.warn('Using procedural fallback for ' + job.kind, error);
          }
        } finally {
          if (!disposed) {
            group.userData['libraryPending'] = (group.userData['libraryPending'] as number) - 1;
          }
        }
      }
    }
    // Bounded concurrent loads avoid swamping the main-thread renderer or
    // starving the landmark model loaders of network/decoding capacity.
    void Promise.all(Array.from({ length: Math.min(4, jobs.length) }, () => worker()))
      .then(() => {
        if (!disposed) group.userData['libraryReady'] = true;
      });
  }
  return {
    group, batches,
    update(time: number): void { for (const u of windUniforms) u.value = time; },
    updateCulling(position, frustum, maxDistance, hidden): boolean {
      let changes = false;
      const matrix = new THREE.Matrix4();
      const centre = new THREE.Vector3();
      const test = new THREE.Sphere();
      const colour = new THREE.Color();
      const same = (a: readonly number[], b: readonly number[]): boolean =>
        a.length === b.length && a.every((value, i) => value === b[i]);
      for (const job of jobs) {
        const suppressed = hidden(job.mesh);
        if (!job.near || !job.far) {
          const distance = job.batch.sphere.center.distanceTo(position);
          const visible = !suppressed && distance < maxDistance +
            job.batch.sphere.radius && frustum.intersectsSphere(job.batch.sphere);
          for (const mesh of job.batch.meshes) {
            if (mesh.castShadow && mesh.visible !== visible) changes = true;
            mesh.visible = visible;
          }
          continue;
        }

        const nearIndices: number[] = [], farIndices: number[] = [];
        if (!suppressed) for (let i = 0; i < job.entries.length; i++) {
          if (job.occluded[i]) continue;
          job.mesh.getMatrixAt(i, matrix);
          const el = matrix.elements;
          // The authored districts suppress old overlapping art with a
          // zero-scale transform, not by deleting its physics descriptor.
          if (el[0] === 0 && el[5] === 0 && el[10] === 0) continue;
          centre.set(el[12]!, el[13]!, el[14]!);
          const size = job.entries[i]!.size;
          const radius = Math.hypot(size.x, size.y, size.z) * 0.52;
          const distance = position.distanceTo(centre);
          if (distance - radius > (isSmallWorldModel(job.kind)
            ? WORLD_LOD.smallPropDistance : maxDistance)) continue;
          test.center.copy(centre);
          test.radius = radius;
          if (!frustum.intersectsSphere(test)) continue;
          (distance - radius <= WORLD_LOD.detailedDistance ?
            nearIndices : farIndices).push(i);
        }
        const version = job.mesh.instanceMatrix.version;
        const changed = version !== job.originalVersion ||
          !same(job.nearIndices, nearIndices) || !same(job.farIndices, farIndices);
        if (changed) {
          const compact = (mesh: THREE.InstancedMesh, indices: readonly number[]): void => {
            for (let at = 0; at < indices.length; at++) {
              const index = indices[at]!;
              job.mesh.getMatrixAt(index, matrix);
              mesh.setMatrixAt(at, matrix);
              if (job.mesh.instanceColor) {
                job.mesh.getColorAt(index, colour);
                mesh.setColorAt(at, colour);
              }
            }
            mesh.count = indices.length;
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          };
          compact(job.near, nearIndices);
          compact(job.far, farIndices);
          job.nearIndices = nearIndices;
          job.farIndices = farIndices;
          job.originalVersion = version;
          if (job.near.castShadow || job.far.castShadow) changes = true;
        }
        job.near.visible = job.near.count > 0 && !suppressed;
        job.far.visible = job.far.count > 0 && !suppressed;
      }
      return changes;
    },
    consumeShadowChange(): boolean {
      const changed = shadowChanged;
      shadowChanged = false;
      return changed;
    },
    dispose(): void { disposed = true; outlineMat.dispose(); },
  };
}
