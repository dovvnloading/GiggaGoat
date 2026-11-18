import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BUILD_RAMP_VERTICES, BUILD_RAMP_TRIANGLES } from '../gameplay';
import { PROP_LIBRARY_MODELS, bakeLibraryPropGeometry } from '../world/library-props';
import { fitLibraryModel, isAuthoredLibraryAsset } from '../world/library-fit';
import { buildProceduralPropGeometry, TOON_RAMP } from '../world/visual-props';

/**
 * Visuals only: callers still own their Rapier bodies and update these roots'
 * position/quaternion. Sizes match the established gameplay collision envelopes.
 * In particular, Hay-Build roots are centred on the physics body, whereas a
 * gig board is anchored at the ground (GameView adds +0.15 to its position).
 */
export type BuildPieceType = 'floor' | 'wall' | 'ramp' | 'launch-pad';
export type GigPropType = 'crate' | 'barrel' | 'hay';
export interface Size3 { x: number; y: number; z: number }
export type WorldLibraryPropKind =
  'crate' | 'barrel' | 'hay-bale' | 'fence' | 'ramp' | 'trampoline';

/** Same descriptor colours as the World Lab's procedural loading placeholders. */
const WORLD_PROP_COLORS: Readonly<Record<WorldLibraryPropKind, number>> = {
  crate: 0xc4915f, barrel: 0xe67d5d, 'hay-bale': 0xf2c14f,
  fence: 0xe5c587, ramp: 0xe5b974, trampoline: 0x7960d9,
};

export const BUILD_PIECE_SIZES: Readonly<Record<BuildPieceType, Readonly<Size3>>> = {
  floor: { x: 2, y: .46, z: 2 },
  wall: { x: .46, y: 2, z: 2 },
  ramp: { x: 2, y: 1.8, z: 2 },
  'launch-pad': { x: 2, y: .46, z: 2 },
};
export const SURFACE_HALF_EXTENTS: Readonly<Size3> = { x: 2.1, y: .23, z: 2.1 };
export const GIG_BOARD_SIZE: Readonly<Size3> = { x: 3.6, y: 4.25, z: .6 };
export const DEFAULT_CRATE_SIZE: Readonly<Size3> = { x: 1.5, y: 1.5, z: 1.5 };

/** All entries are existing CC0 items in public/assets/library/manifest.json. */
export const LIBRARY_MODELS = {
  board: 'kenney/survival-kit/signpost-single.glb',
  crate: 'kenney/survival-kit/box-large.glb',
  debris: 'kenney/survival-kit/box.glb',
  barrel: 'kenney/survival-kit/barrel.glb',
  hay: 'polypizza/hay-bale/hay_Yu8TOERkpw.glb',
  fence: 'kenney/survival-kit/fence.glb',
  planks: 'kenney/fantasy-town-kit/planks.glb',
  spring: 'kenney/platformer-kit/spring.glb',
  arrow: 'kenney/platformer-kit/arrow.glb',
} as const;

const COLORS = {
  hay: 0xf4bc35, rope: 0xba8531,
  wood: 0xb9722d, woodLight: 0xe5a44e, woodDark: 0x79421f,
  iron: 0x69738b, silver: 0xbac1d3, gold: 0xf9bf31,
  red: 0xe83d50, redLight: 0xff7581, orange: 0xff921d,
  paper: 0xffedbb, ink: 0x9c542e, spring: 0x8494b5,
} as const;
type ColorName = keyof typeof COLORS;

export interface PropFactoryOptions {
  /** Defaults to GLTFLoader.loadAsync; injectable for headless tests. */
  loadModel?: (url: string) => Promise<THREE.Object3D>;
  /** The deployed app root, not the library folder. */
  assetBaseUrl?: string;
}

export function getBuildPieceSize(type: BuildPieceType): Size3 {
  return { ...BUILD_PIECE_SIZES[type] };
}

export function getSurfaceFootprint(halfExtents: Size3 = SURFACE_HALF_EXTENTS): Size3 {
  return { x: halfExtents.x * 2, y: .18, z: halfExtents.z * 2 };
}

/**
 * Vite uses base:'./'. In dev the module lives in /src/props/, while Vite
 * bundles it under /assets/ in production; deriving the root from the module
 * URL works from nested lab pages AND GitHub Pages sub-path deployments.
 */
export function libraryAssetUrl(path: string, assetBaseUrl?: string): string {
  const clean = path.replace(/^\/+/, '');
  if (clean.split('/').some(segment => segment === '..' || segment === '.')) {
    throw new Error('Invalid library asset path');
  }
  const root = assetBaseUrl
    ? new URL(assetBaseUrl, import.meta.url)
    : import.meta.env.BASE_URL.startsWith('/')
      ? new URL(import.meta.env.BASE_URL, import.meta.url)
      : new URL(import.meta.env.DEV ? '../../' : '../', import.meta.url);
  return new URL('assets/library/' + clean, root).href;
}

function scaled(size: Size3, fraction: number): Size3 {
  return { x: size.x * fraction, y: size.y * fraction, z: size.z * fraction };
}

/**
 * The root is usable immediately (a shaped toon fallback). One load per URL
 * populates a cached prototype; each consumer receives an independent clone.
 * The decorative trim stays in place when the model replaces the fallback.
 */
export class PropFactory {
  private readonly loadModel: (url: string) => Promise<THREE.Object3D>;
  private readonly assetBaseUrl?: string;
  private readonly cache = new Map<string, Promise<THREE.Object3D | null>>();
  private readonly prototypes = new Set<THREE.Object3D>();
  private readonly instances = new Set<THREE.Group>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly colors = new Map<ColorName, THREE.MeshToonMaterial>();
  private readonly geometryCache = new Map<string, THREE.BufferGeometry>();
  private readonly worldGeometries = new Map<WorldLibraryPropKind, THREE.BufferGeometry>();
  private readonly worldMaterials = new Map<string, THREE.MeshToonMaterial>();
  private readonly convertedMaterials = new WeakMap<THREE.Material, THREE.Material>();
  private disposed = false;

  constructor(options: PropFactoryOptions = {}) {
    this.assetBaseUrl = options.assetBaseUrl;
    this.loadModel = options.loadModel ??
      (url => new GLTFLoader().loadAsync(url).then(result => result.scene));
  }

  private material(name: ColorName): THREE.MeshToonMaterial {
    let mat = this.colors.get(name);
    if (!mat) {
      mat = new THREE.MeshToonMaterial({ color: COLORS[name], side: THREE.DoubleSide });
      this.colors.set(name, mat);
      this.materials.add(mat);
    }
    return mat;
  }

  private cachedGeometry(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.geometryCache.get(key);
    if (!geometry) {
      geometry = create();
      this.geometryCache.set(key, geometry);
      this.geometries.add(geometry);
    }
    return geometry;
  }

  private addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry,
    color: ColorName, x = 0, y = 0, z = 0): THREE.Mesh {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, this.material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private box(parent: THREE.Object3D, s: Size3, color: ColorName,
    x = 0, y = 0, z = 0): THREE.Mesh {
    return this.addMesh(parent,
      this.cachedGeometry(`box:${s.x}:${s.y}:${s.z}`,
        () => new THREE.BoxGeometry(s.x, s.y, s.z)), color, x, y, z);
  }

  private cylinder(parent: THREE.Object3D, top: number, bottom: number, h: number,
    color: ColorName, x = 0, y = 0, z = 0, sides = 12): THREE.Mesh {
    return this.addMesh(parent,
      this.cachedGeometry(`cylinder:${top}:${bottom}:${h}:${sides}`,
        () => new THREE.CylinderGeometry(top, bottom, h, sides)), color, x, y, z);
  }

  private root(name: string, size: Size3, groundAnchored = false): THREE.Group {
    if (this.disposed) throw new Error('PropFactory has been disposed');
    const root = new THREE.Group();
    root.name = 'prop-' + name;
    root.userData.propKind = name;
    root.userData.nominalSize = { ...size };
    root.userData.groundAnchored = groundAnchored;
    root.userData.assetStatus = 'loading';
    root.userData.assetRevision = 0;
    this.instances.add(root);
    return root;
  }

  private request(path: string): Promise<THREE.Object3D | null> {
    let pending = this.cache.get(path);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => this.loadModel(libraryAssetUrl(path, this.assetBaseUrl)))
        .then(object => {
          if (this.disposed) return null;
          this.prototypes.add(object);
          return object;
        })
        .catch(() => null);
      this.cache.set(path, pending);
    }
    return pending;
  }

  /** Makes each model a centred, exact-size part regardless of source units. */
  private fitted(prototype: THREE.Object3D, bounds: Size3,
    yRotation = 0, xRotation = 0): THREE.Object3D | null {
    const clone = prototype.clone(true);
    if (yRotation) clone.rotation.y += yRotation;
    if (xRotation) clone.rotation.x += xRotation;
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    if (box.isEmpty()) return null;
    const actual = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Some assets use a completely flat plane; never divide by zero.
    const fitted = new THREE.Group();
    fitted.scale.set(
      bounds.x / Math.max(actual.x, .0001),
      bounds.y / Math.max(actual.y, .0001),
      bounds.z / Math.max(actual.z, .0001));
    clone.position.sub(center);
    fitted.add(clone);
    clone.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const toon = (m: THREE.Material): THREE.Material => {
        if (!(m instanceof THREE.MeshStandardMaterial)) return m;
        let mat = this.convertedMaterials.get(m);
        if (!mat) {
          mat = new THREE.MeshToonMaterial({
            color: m.color, map: m.map, transparent: m.transparent,
            opacity: m.opacity, alphaTest: m.alphaTest, side: m.side,
          });
          this.materials.add(mat);
          this.convertedMaterials.set(m, mat);
        }
        return mat;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(toon) : toon(object.material);
    });
    return fitted;
  }

  /** World Lab model geometry, source paint, fitting and tint, shared by every instance. */
  private worldMaterial(color: number, vertexColors: boolean): THREE.MeshToonMaterial {
    const key = (vertexColors ? 'paint:' : 'box:') + color;
    let material = this.worldMaterials.get(key);
    if (!material) {
      material = new THREE.MeshToonMaterial({
        color, vertexColors, gradientMap: TOON_RAMP, side: THREE.FrontSide,
      });
      this.worldMaterials.set(key, material);
      this.materials.add(material);
    }
    return material;
  }

  private fittedWorld(prototype: THREE.Object3D, kind: WorldLibraryPropKind,
    size: Size3, color?: number): THREE.Group | null {
    let geometry = this.worldGeometries.get(kind);
    if (!geometry) {
      // Use the same multi-mesh/atlas/vertex-colour baker as World Lab.
      const baked = bakeLibraryPropGeometry(kind, prototype);
      if (!baked) return null;
      geometry = baked;
      this.worldGeometries.set(kind, geometry);
      this.geometries.add(geometry);
    }
    const nativeBounds = geometry.boundingBox;
    if (!nativeBounds || nativeBounds.isEmpty()) return null;
    const path = PROP_LIBRARY_MODELS[kind];
    const fit = fitLibraryModel(nativeBounds.getSize(new THREE.Vector3()),
      new THREE.Vector3(size.x, size.y, size.z), path);
    // Authored paint is not recoloured. Kenney props use the Lab's subtle
    // descriptor tint (18% descriptor colour, 82% white).
    const tint = new THREE.Color(0xffffff);
    if (!isAuthoredLibraryAsset(path) && color !== undefined) {
      tint.setHex(color).lerp(new THREE.Color(0xffffff), .82);
    }
    const mesh = new THREE.Mesh(geometry, this.worldMaterial(tint.getHex(), true));
    mesh.name = 'world-library-model';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const fitted = new THREE.Group();
    fitted.name = 'world-library-fitted';
    fitted.rotation.y = fit.yaw;
    fitted.scale.copy(fit.scale);
    fitted.add(mesh);
    fitted.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(fitted);
    if (bounds.isEmpty()) return null;
    // World roots are collider-centred: centre X/Z, put the lowest point
    // at the collider floor, and leave descriptor yaw on the caller's root.
    fitted.position.set(
      -(bounds.min.x + bounds.max.x) / 2,
      -size.y / 2 - bounds.min.y,
      -(bounds.min.z + bounds.max.z) / 2);
    return fitted;
  }

  /** Draw one placeholder, then swap in the exact World Lab GLB. */
  createWorldProp(kind: WorldLibraryPropKind, size: Size3, color: number | undefined,
    legacyFallback: () => THREE.Group): THREE.Group {
    const root = this.root('world-' + kind, size);
    const slot = new THREE.Group();
    slot.name = 'library-slot';
    root.add(slot);
    const isFence = kind === 'fence';
    const placeholder = isFence
      ? this.cachedGeometry('world-picket-fence', () => buildProceduralPropGeometry('fence'))
      : this.cachedGeometry(`box:${size.x}:${size.y}:${size.z}`,
        () => new THREE.BoxGeometry(size.x, size.y, size.z));
    const proxy = new THREE.Mesh(placeholder,
      this.worldMaterial(isFence ? 0xffffff : color ?? WORLD_PROP_COLORS[kind], isFence));
    if (isFence) {
      proxy.name = 'world-picket-fence';
      proxy.scale.set(size.x, size.y, size.z);
    }
    proxy.castShadow = true;
    proxy.receiveShadow = true;
    slot.add(proxy);

    const path = PROP_LIBRARY_MODELS[kind];
    void this.request(path.replace(/^assets\/library\//, '')).then(prototype => {
      if (this.disposed || !this.instances.has(root)) return;
      let model: THREE.Group | null = null;
      try {
        if (prototype) model = this.fittedWorld(prototype, kind, size, color);
      } catch {
        // A malformed GLB is treated exactly like a failed network request.
      }
      if (model) {
        slot.clear();
        slot.add(model);
        slot.userData.assetPath = path;
        root.userData.assetStatus = 'ready';
      } else if (isFence) {
        root.userData.assetStatus = 'fallback';
      } else {
        // Keep the existing PropFactory toy shape only when the Lab GLB fails.
        try {
          const fallback = legacyFallback();
          slot.clear();
          slot.add(fallback);
          // The legacy shape has its own async slots: rebuild its batch if
          // those requests finish after the failed world-model request.
          void this.whenReady().then(() => {
            if (this.instances.has(root)) {
              root.userData.assetRevision = (root.userData.assetRevision as number) + 1;
            }
          });
        } catch {
          // The descriptor-coloured box is still safe to draw.
        }
        root.userData.assetStatus = 'fallback';
      }
      root.userData.assetRevision = (root.userData.assetRevision as number) + 1;
    });
    return root;
  }

  /** A model occupies only its allotted slot; all trim remains independent. */
  private mount(owner: THREE.Group, parent: THREE.Object3D, path: string,
    size: Size3, at: THREE.Vector3, fallback: ColorName | ((slot: THREE.Group) => void),
    yRotation = 0, xRotation = 0): void {
    const slot = new THREE.Group();
    slot.name = 'library-slot';
    slot.position.copy(at);
    parent.add(slot);
    if (typeof fallback === 'string') this.box(slot, size, fallback);
    else fallback(slot);
    void this.request(path).then(prototype => {
      if (this.disposed || !this.instances.has(owner)) return;
      const model = prototype && this.fitted(prototype, size, yRotation, xRotation);
      if (model) {
        slot.clear();
        slot.add(model);
        slot.userData.assetPath = path;
        owner.userData.assetStatus = 'ready';
        owner.userData.assetRevision = (owner.userData.assetRevision as number) + 1;
      } else if (owner.userData.assetStatus !== 'ready') {
        owner.userData.assetStatus = 'fallback';
        owner.userData.assetRevision = (owner.userData.assetRevision as number) + 1;
      }
    });
  }

  createGigBoard(): THREE.Group {
    const root = this.root('gig-board', GIG_BOARD_SIZE, true);
    // Source signpost gives a recognisable farm-game shape. Clipboard and clip
    // are deliberately separate so they remain legible at gameplay distance.
    this.mount(root, root, LIBRARY_MODELS.board,
      { x: .42, y: 2.95, z: .42 }, new THREE.Vector3(0, 1.49, 0), 'wood');
    this.box(root, { x: 3.6, y: 1.9, z: .32 }, 'woodDark', 0, 3.3, 0);
    this.box(root, { x: 3.36, y: 1.66, z: .04 }, 'paper', 0, 3.3, .185);
    this.box(root, { x: .82, y: .19, z: .1 }, 'iron', 0, 4.13, .22);
    const clipboardPin = this.cylinder(root, .095, .095, .08, 'silver', 0, 4.12, .285);
    clipboardPin.rotation.x = Math.PI / 2;
    for (const [i, length] of [2.15, 2.62, 1.9].entries()) {
      this.box(root, { x: length, y: .095, z: .045 }, 'ink',
        -.25, 3.74 - i * .37, .216);
    }
    this.cylinder(root, .20, .20, .08, 'gold', -1.18, 3.65, .23, 8);
    return root;
  }

  createCrate(size: Size3 = DEFAULT_CRATE_SIZE): THREE.Group {
    const root = this.root('crate', size);
    this.mount(root, root, LIBRARY_MODELS.crate, scaled(size, .91),
      new THREE.Vector3(), 'wood');
    // Iron corner straps and rivets make the chest read as a supplies crate.
    for (const z of [-.485, .485]) {
      for (const x of [-.41, .41]) {
        this.box(root, { x: size.x * .105, y: size.y * .97, z: size.z * .028 },
          'iron', x * size.x, 0, z * size.z);
        for (const y of [-.4, .4]) {
          const rivet = this.cylinder(root, size.x * .035, size.x * .035, size.z * .021,
            'silver', x * size.x, y * size.y, z * size.z);
          rivet.rotation.x = Math.PI / 2;
        }
      }
      for (const y of [-.43, .43]) {
        this.box(root, { x: size.x * .91, y: size.y * .09, z: size.z * .028 },
          'iron', 0, y * size.y, z * size.z);
      }
    }
    return root;
  }

  /** GamePropMapping scales this shared nominal chunk to each debris body's size. */
  createCrateDebris(edge = .35): THREE.Group {
    const s = { x: edge, y: edge, z: edge };
    const root = this.root('crate-debris', s);
    this.mount(root, root, LIBRARY_MODELS.debris, scaled(s, .91),
      new THREE.Vector3(), 'woodLight');
    this.box(root, { x: edge * .82, y: edge * .15, z: edge * .10 },
      'iron', 0, edge * .39, edge * .42);
    return root;
  }

  private springPad(kind: 'trampoline' | 'launch', halfExtents: Size3): THREE.Group {
    const s = getSurfaceFootprint(halfExtents);
    const root = this.root(kind, s, true);
    const y = halfExtents.y;
    const red = kind === 'trampoline';
    this.box(root, s, red ? 'gold' : 'orange', 0, y + .09, 0);
    this.mount(root, root, LIBRARY_MODELS.spring,
      { x: 1.20, y: .25, z: 1.20 }, new THREE.Vector3(0, y + .285, 0), 'spring');
    this.cylinder(root, 1.67, 1.67, .11, red ? 'red' : 'gold', 0, y + .465, 0, 36);
    this.cylinder(root, 1.50, 1.50, .017, red ? 'redLight' : 'orange',
      0, y + .525, 0, 36);
    const rim = this.addMesh(root,
      this.cachedGeometry('spring-rim', () => new THREE.TorusGeometry(1.67, .085, 7, 32)),
      'woodDark', 0, y + .47, 0);
    rim.rotation.x = Math.PI / 2;
    if (!red) {
      this.mount(root, root, LIBRARY_MODELS.arrow,
        { x: 1.03, y: .02, z: 1.26 }, new THREE.Vector3(0, y + .545, 0), 'paper', 0, -Math.PI / 2);
    }
    return root;
  }

  createTrampoline(halfExtents: Size3 = SURFACE_HALF_EXTENTS): THREE.Group {
    return this.springPad('trampoline', halfExtents);
  }

  createLaunchPad(halfExtents: Size3 = SURFACE_HALF_EXTENTS): THREE.Group {
    return this.springPad('launch', halfExtents);
  }

  private hayBlock(size: Size3, name: string): THREE.Group {
    const root = this.root(name, size);
    this.mount(root, root, LIBRARY_MODELS.hay, scaled(size, .94),
      new THREE.Vector3(), 'hay');
    for (const z of [-.30, .30]) {
      this.box(root, { x: size.x * .96, y: size.y * .12, z: size.z * .058 },
        'rope', 0, size.y * .43, size.z * z);
    }
    return root;
  }

  /** For GameView's variable-size spawned gig props (hay haul and supplies). */
  createGigProp(size: Size3, kind: GigPropType = 'crate'): THREE.Group {
    if (kind === 'crate') return this.createCrate(size);
    if (kind === 'hay') return this.hayBlock(size, 'gig-hay');
    const root = this.root('gig-barrel', size);
    this.mount(root, root, LIBRARY_MODELS.barrel, scaled(size, .95),
      new THREE.Vector3(), 'wood');
    for (const y of [-.30, .30]) {
      this.cylinder(root, size.x * .47, size.x * .47, size.y * .09,
        'iron', 0, size.y * y, 0, 16);
    }
    return root;
  }

  createBuildPiece(type: BuildPieceType): THREE.Group {
    const s = getBuildPieceSize(type);
    if (type === 'floor') return this.hayBlock(s, 'build-floor');
    const root = this.root('build-' + type, s);
    if (type === 'wall') {
      this.mount(root, root, LIBRARY_MODELS.fence,
        { x: .38, y: 1.9, z: 1.85 }, new THREE.Vector3(), 'wood', Math.PI / 2);
      for (const z of [-.88, .88]) {
        this.box(root, { x: .40, y: 2, z: .20 }, 'woodLight', 0, 0, z);
      }
      for (const y of [-.48, .42]) {
        this.box(root, { x: .46, y: .19, z: 1.96 }, 'woodLight', 0, y, 0);
      }
    } else if (type === 'ramp') {
      // Same rising +Z plane and +/-0.9 Y as GameView's convex ramp collider.
      const geometry = this.cachedGeometry('build-ramp', () => {
        const shape = new THREE.BufferGeometry();
        shape.setAttribute('position', new THREE.Float32BufferAttribute(BUILD_RAMP_VERTICES, 3));
        shape.setIndex([...BUILD_RAMP_TRIANGLES]);
        shape.computeVertexNormals();
        return shape;
      });
      this.addMesh(root, geometry, 'woodDark');
      const top = new THREE.Group();
      top.name = 'build-ramp-deck';
      top.rotation.x = -Math.atan2(s.y, s.z);
      root.add(top);
      const deck = { x: 1.84, y: .09, z: 2.47 };
      this.mount(root, top, LIBRARY_MODELS.planks, deck, new THREE.Vector3(), slot => {
        // The library mesh has six evenly spaced boards on two battens. Both
        // versions run across the ramp slope, like the tray's ramp artwork.
        const board = { x: deck.x, y: deck.y / 2, z: deck.z * .1486 };
        const spacing = (deck.z - board.z) / 5;
        for (let i = 0; i < 6; i++) {
          const mesh = this.box(slot, board, 'woodLight', 0, deck.y / 4, (i - 2.5) * spacing);
          mesh.name = 'ramp-slat';
        }
        const batten = { x: deck.x * .1486, y: deck.y / 2, z: deck.z };
        for (const x of [-.2771, .2771]) {
          this.box(slot, batten, 'wood', x * deck.x, -deck.y / 4, 0);
        }
      }, Math.PI / 2);
      for (const x of [-.92, .92]) {
        this.box(top, { x: .12, y: .12, z: 2.45 }, 'woodDark', x, 0, 0);
      }
    } else {
      // Keep the complete spring inside the original +/-0.23 Y collider.
      // A thin base and open frame expose the coils beneath the red button.
      this.box(root, { x: s.x, y: .16, z: s.z }, 'wood', 0, -.15, 0);
      for (const z of [-.94, .94]) {
        this.box(root, { x: 2, y: .12, z: .12 }, 'woodDark', 0, .10, z);
      }
      for (const x of [-.94, .94]) {
        this.box(root, { x: .12, y: .12, z: 2 }, 'woodDark', x, .10, 0);
      }
      this.mount(root, root, LIBRARY_MODELS.spring,
        { x: .95, y: .20, z: .95 }, new THREE.Vector3(0, .015, 0), 'spring');
      this.cylinder(root, .82, .82, .08, 'red', 0, .18, 0, 32);
      this.cylinder(root, .70, .70, .012, 'redLight', 0, .224, 0, 32);
    }
    return root;
  }

  /** Stop tracking a transient prop; pending GLB requests cannot remount it. */
  release(root: THREE.Group): void {
    if (!this.instances.delete(root)) return;
    root.removeFromParent();
    root.clear();
  }

  /** Await all currently requested assets, useful for a lab or a headless test. */
  async whenReady(): Promise<void> {
    await Promise.all(this.cache.values());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const root of this.instances) { root.removeFromParent(); root.clear(); }
    this.instances.clear();
    for (const scene of this.prototypes) {
      scene.traverse(obj => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial) mat.map?.dispose();
          mat.dispose();
        }
      });
    }
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.cache.clear();
    this.geometryCache.clear();
    this.worldGeometries.clear();
    this.worldMaterials.clear();
    this.prototypes.clear();
    this.geometries.clear();
    this.materials.clear();
    this.colors.clear();
  }
}
