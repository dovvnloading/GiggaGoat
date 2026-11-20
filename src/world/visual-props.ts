import * as THREE from 'three';
import { isTerrainTreeAnchor, treeArtCenterY } from './visual-tree-grounding';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitPlantGeometry, plantKitBatches } from './plant-palette';
import { loadGroundedKitGeometry, loadLibraryPropGeometry, PROP_LIBRARY_MODELS } from './library-props';
import { fitLibraryModel, isAuthoredLibraryAsset } from './library-fit';
import { appendPinesLogEntries } from './visual-pines-log-access';
import { setPinesStiltMorphs, type TerrainHeight } from './visual-pines-deck-stilts';
import type { PropDescriptor, PropKind } from './types';
import { kitPreview } from './kit-preview';
import { CRANE_RAMP_GUARD_PREFIX, CRANE_SWITCHBACK_PREFIX } from './crane-yard';
import type { IslandData } from './types';
import { WORLD_LOD, completelyOccluded, isSmallWorldModel,
  simplifiedWorldGeometry } from './lod';

export interface PropBatch {
  sphere: THREE.Sphere;
  meshes: THREE.Mesh[];
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

const authoredKioskKinds = new Set<PropKind>([
  'kiosk-icecream', 'kiosk-popcorn', 'kiosk-games',
  'kiosk-prizes', 'kiosk-candy',
]);
const authoredKioskSignKinds = new Set<PropKind>([
  'kiosk-sign-icecream', 'kiosk-sign-popcorn', 'kiosk-sign-games',
  'kiosk-sign-prizes', 'kiosk-sign-candy',
]);
/** Authored painted hero dressing keeps its GLB vertex colours and full far LOD. */
export const AUTHORED_HERO_DRESSING_KINDS: ReadonlySet<PropKind> = new Set([
  'palm-tree', 'floodlight', 'life-ring', 'cable-spool',
  'pallet-stack', 'log-bridge', 'lily-pads', 'cascade', 'cascade-tall',
]);
const authoredCraneYardKinds = new Set<PropKind>([
  'crane', 'crane-jib', 'crane-cab', 'crane-cable', 'red-girder',
  'concrete-slab', 'concrete-column', 'yard-scaffold', 'safety-rail',
  'chain-fence', 'pipe-stack', 'site-barrier', 'site-banner', 'bunting',
  'satellite-dish', 'ledge', 'cave-mouth', 'flag', 'lookout',
  'platform', 'deck-stilts', 'sign', 'rope-rail', 'bridge',
  // Painted custom landmark (QA LH-1): keeps its own red/white bands.
  'lighthouse',
]);
const SHADOW_KINDS = new Set<PropKind>([
  'barn', 'house', 'shop', 'cottage', 'windmill', 'lighthouse',
  'tower', 'crane', 'tree-pine', 'tree-oak', 'silo', 'water-tower',
  'satellite-dish', 'ferris-wheel',
  'concrete-slab', 'concrete-column', 'yard-scaffold', 'crane-jib',
]);
/** Blender-authored Baa-ardwalk pieces are low-poly with painted materials. */
const authoredBaaardwalkKinds = new Set<PropKind>([
  'pier', 'pier-rail', 'scaffold', 'booth', 'awning', 'signboard',
  ...authoredKioskKinds, ...authoredKioskSignKinds,
  'ferris-wheel', 'trampoline', 'bumper',
]);
/** New themed kiosks retain their own paint; only the legacy booth is tinted. */
const authoredBaaardwalkPaintedKinds = new Set<PropKind>([
  'pier', 'pier-rail', 'scaffold', 'awning', 'signboard',
  ...authoredKioskKinds, ...authoredKioskSignKinds,
  'ferris-wheel', 'trampoline', 'bumper',
]);

function paintPierBoards(shader: THREE.WebGLProgramParametersWithUniforms, scale: number): void {
  shader.uniforms['uPierScale'] = { value: scale };
  shader.vertexShader = shader.vertexShader.replace('#include <common>',
    '#include <common>\nuniform float uPierScale;\nvarying vec3 vPierBoard;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vPierBoard = vec3(position.x, position.z * length(instanceMatrix[2].xyz) / uPierScale, normal.y);`);
  // The baked deck has continuous strips. Offset the end joints per strip and
  // filter them out as their world-space footprint drops under a pixel.
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
    '#include <common>\nvarying vec3 vPierBoard;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float boardRow = floor(vPierBoard.x / 0.01815);
      float boardRun = (vPierBoard.y + mod(boardRow, 4.0) * 1.1) / 4.4;
      float jointDistance = abs(fract(boardRun + 0.5) - 0.5) * 4.4;
      float footprint = fwidth(vPierBoard.y);
      float detail = (1.0 - smoothstep(0.075, 0.45, footprint)) * smoothstep(0.75, 0.95, vPierBoard.z);
      float joint = 1.0 - smoothstep(0.018, 0.050 + footprint * 0.35, jointDistance);
      float tone = fract(boardRow * 0.317 + floor(boardRun) * 0.618) - 0.5;
      diffuseColor.rgb *= 1.0 + detail * (tone * 0.14 - joint * 0.42);`);
}

/** Low-poly Blender town/farm models retain their native paint at every LOD. */
const authoredTownFarmKinds = new Set<PropKind>([
  'ac-unit', 'planter', 'bench', 'gnome', 'hay-bale', 'ramp', 'buoy',
]);
function sways(kind: PropKind): boolean {
  return ['tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft', 'fern', 'bunting', 'flag'].includes(kind);
}

function summitLandmark(prop: PropDescriptor): boolean {
  return prop.poiId === 'mt-gigga' && (prop.kind === 'satellite-dish' || prop.kind === 'flag');
}

/** Grow the silhouette around its footing while leaving the course coordinates alone. */
function poseSummitLandmark(prop: PropDescriptor, art: THREE.Object3D): void {
  const { x, y, z } = prop.size;
  const yaw = prop.transform.rotationY;
  if (prop.kind === 'satellite-dish') {
    art.scale.set(x * 1.37, y * 1.44, z * 1.18);
    art.rotation.y += 0.64;
    // The fixture was authored with a 1 m pedestal lift. Lower the art's
    // foot into that gap and leave the actual cylinder at its existing pose.
    art.position.y -= 0.09 * y;
  } else {
    art.scale.set(x * 1.56, y * 1.25, z);
    art.rotation.y += 0.48;
    // Baked GLB pole centre is -0.4212 of the normalised total width.
    const pole = -0.4212;
    art.position.x += pole * (x * Math.cos(yaw) - art.scale.x * Math.cos(art.rotation.y));
    art.position.z += pole * (art.scale.x * Math.sin(art.rotation.y) - x * Math.sin(yaw));
  }
  art.position.y += (art.scale.y - y) * 0.49;
}

/** Spatially batched instancing; LOD/culling works without per-object draw calls. */
export function buildPropVisuals(props: readonly PropDescriptor[], chunkSize = 96,
  island?: IslandData, replacedPropIds?: ReadonlySet<string>, distantPinesGround?: TerrainHeight): PropVisuals {
  const group = new THREE.Group();
  group.name = 'handcrafted-props';
  // A full-detail far batch uses the near mesh. Preserve existing far-name
  // lookups (including lookups through ancestor groups) without a second draw.
  const mergedFarMeshes = new Map<string, THREE.InstancedMesh>();
  const findObject = group.getObjectByProperty.bind(group);
  group.getObjectByProperty = (name: string, value: unknown): THREE.Object3D | undefined => {
    if (name === 'name' && typeof value === 'string') {
      const merged = mergedFarMeshes.get(value);
      if (merged) return merged;
    }
    return findObject(name, value);
  };
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
  const windUniforms: Array<{ value: number }> = [];
  interface Job {
    kind: PropKind;
    entries: PropDescriptor[];
    mesh: THREE.InstancedMesh; // stable original descriptor index for physics
    batch: PropBatch;
    near?: THREE.InstancedMesh;
    far?: THREE.InstancedMesh;
    slots: number[]; // Indices in the authoritative physics mesh used by this model.
    nearIndices: number[];
    farIndices: number[];
    /** Visual-only transforms, multiplied after the unchanged physics matrices. */
    adjustments?: THREE.Matrix4[];
    stiltPose?: THREE.Mesh;
    originalVersion: number;
    occluded: boolean[];
  }
  const jobs: Job[] = [];
  // One BatchedMesh can draw the two different cascade GLBs in a single
  // material pass. The remaining waterfall foam is already one draw.
  let cascadeBatch: { mesh: THREE.BatchedMesh; ids: Map<Job, number[]> } | undefined;
  const dummy = new THREE.Object3D();
  const rampGuardYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  for (const [kind, entries] of buckets) {
    let geometry = geometries.get(kind);
    if (!geometry) {
      geometry = kitPreview(kind, entries[0]!.size);
      if (island && kind === 'log-bridge' && entries.length === 1)
        geometry = appendPinesLogEntries(geometry, island, entries[0]!);
      // A small local embed also seats the kit trees while the GLBs
      // load. Keep stable source matrices for the renderer's prop bindings.
      if (island && (kind === 'tree-oak' || kind === 'tree-pine') &&
        entries.every(prop => prop.body.type === 'static' &&
          isTerrainTreeAnchor(island, prop.transform.position, prop.size.y))) {
        geometry.translate(0, -.02, 0);
      }
      geometries.set(kind, geometry);
    }
    let material = materials.get(kind);
    if (!material) {
      material = new THREE.MeshToonMaterial({
        color: 0xffffff, vertexColors: true, gradientMap: TOON_RAMP,
        side: kind === 'rock' || kind === 'stepping-stone' || kind === 'log-bridge'
          ? THREE.DoubleSide : THREE.FrontSide,
        emissive: kind === 'rock' ? 0x626773 : 0x000000,
        emissiveIntensity: kind === 'rock' ? 0.42 : 0,
        fog: true,
      });
      if (kind === 'pier' && island) {
        material.onBeforeCompile = shader => paintPierBoards(shader, island.size / 600);
      } else if (sways(kind)) {
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
    const switchback = entries.some(prop => prop.id.startsWith(CRANE_SWITCHBACK_PREFIX));
    const switchbackSpan = switchback ? geometry.boundingBox!.getSize(new THREE.Vector3()) : null;
    for (let i = 0; i < entries.length; i++) {
      const prop = entries[i]!;
      const p = prop.transform.position;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(prop.transform.rotationX ?? 0, prop.transform.rotationY, 0, 'YXZ');
      const switchMember = prop.id.startsWith(CRANE_SWITCHBACK_PREFIX);
      const rampGuard = prop.id.startsWith(CRANE_RAMP_GUARD_PREFIX);
      // The rail model runs along its local X. The ramp runs along local Z.
      if (rampGuard) dummy.quaternion.multiply(rampGuardYaw);
      // Preserve the stable instance slot when connected scenery draws this prop.
      if (replacedPropIds?.has(prop.id)) dummy.scale.setScalar(0);
      else if (rampGuard) dummy.scale.set(prop.size.z, prop.size.y, prop.size.x);
      else dummy.scale.set(prop.size.x, prop.size.y, prop.size.z);
      // The access slabs meet end to end, so fit their art to the collider edges.
      if (switchMember && switchbackSpan) dummy.scale.divide(switchbackSpan);
      if (summitLandmark(prop)) poseSummitLandmark(prop, dummy);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color(switchMember && prop.color !== undefined ? prop.color : 0xffffff));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const stiltPose = island && kind === 'deck-stilts'
      ? setPinesStiltMorphs(mesh, entries, island, distantPinesGround, replacedPropIds) : undefined;
    mesh.computeBoundingSphere();
    group.add(mesh);
    const drawn: THREE.InstancedMesh[] = [mesh];
    const batch: PropBatch = {
      meshes: drawn, sphere: mesh.boundingSphere?.clone() ?? new THREE.Sphere(),
      // Global instance batches must not vanish when their centre is distant.
      nearOnly: false,
    };
    batches.push(batch);
    jobs.push({ kind, entries, mesh, batch, stiltPose, slots: entries.map((_, i) => i), nearIndices: [], farIndices: [],
      originalVersion: -1,
      occluded: entries.map(entry => Boolean(island && entry.body.type !== 'dynamic' &&
        completelyOccluded(island, entry.transform.position, entry.size, entry))),
    });
  }

  // Packed kit meshes supply the first painted frame and network
  // failure fallbacks. Once loaded, swap their *geometry*, not the mesh:
  // the physics bindings and descriptor order stay stable. Habitat variants
  // draw compact subsets of those same transforms in model-specific batches.
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
      'sign', 'container', 'crane', 'ferris-wheel', ...authoredKioskKinds,
    ];
    // Populate the art camera first while other district models stream in.
    jobs.sort((a, b) => {
      const left = priorityKinds.indexOf(a.kind), right = priorityKinds.indexOf(b.kind);
      return (left < 0 ? priorityKinds.length : left) -
        (right < 0 ? priorityKinds.length : right);
    });
    const originalJobs = jobs.length;
    let next = 0;
    const white = new THREE.Color(0xffffff), tint = new THREE.Color();
    async function loadPlantVariants(job: Job, island: IslandData): Promise<void> {
      if (!['tree-oak','tree-pine','bush','flower'].includes(job.kind)) return;
      const trunk = job.kind === 'tree-oak' || job.kind === 'tree-pine';
      for (const [model, slots] of plantKitBatches(job.entries)) {
        if (disposed) break;
        const path = 'assets/library/kenney/nature-kit/' + model + '.glb';
        let geometry: THREE.BufferGeometry;
        try {
          geometry = await loadGroundedKitGeometry(path, loader);
        } catch (error) {
          // The original kit batch still owns these slots if a variant fails.
          console.warn('Could not load plant kit ' + path, error);
          continue;
        }
        if (disposed) { geometry.dispose(); break; }
        fitPlantGeometry(geometry, job.kind);
        const draw = new THREE.InstancedMesh(geometry, job.mesh.material, slots.length);
        draw.name = 'habitat-' + model;
        draw.count = 0;
        draw.frustumCulled = false;
        draw.castShadow = job.mesh.castShadow;
        draw.receiveShadow = job.mesh.receiveShadow;
        draw.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        group.add(draw);
        job.batch.meshes.push(draw);
        const claimed = new Set(slots);
        job.slots = job.slots.filter(i => !claimed.has(i));
        job.originalVersion = -1;
        const adjustments: THREE.Matrix4[] = [];
        if (trunk) for (const i of slots) {
          const p = job.entries[i]!;
          const y = treeArtCenterY(island, p.transform.position, p.size.y, -.49);
          adjustments[i] = new THREE.Matrix4().makeTranslation(0, (y - p.transform.position.y) / p.size.y, 0);
        }
        jobs.push({ ...job, slots, adjustments, near: draw, far: draw, nearIndices: [], farIndices: [] });
        shadowChanged = true;
      }
    }
    async function worker(): Promise<void> {
      while (!disposed && next < originalJobs) {
        const job = jobs[next++]!;
        const path = PROP_LIBRARY_MODELS[job.kind];
        let pending = cache.get(path);
        if (!pending) {
          pending = loadLibraryPropGeometry(job.kind, loader).then(geometry =>
            island && job.kind === 'log-bridge' && job.entries.length === 1
              ? appendPinesLogEntries(geometry, island, job.entries[0]!) : geometry);
          cache.set(path, pending);
        }
        try {
          const libraryGeometry = await pending;
          // Authored lattice, landmarks and painted container detail must remain
          // intact beyond the detailed-distance threshold.
          const distantGeometry = authoredCraneYardKinds.has(job.kind) ||
            authoredBaaardwalkKinds.has(job.kind) ||
            authoredTownFarmKinds.has(job.kind) ||
            AUTHORED_HERO_DRESSING_KINDS.has(job.kind) || job.kind === 'container'
            ? libraryGeometry : await simplifiedWorldGeometry(libraryGeometry);
          if (disposed) {
            if (distantGeometry !== libraryGeometry) distantGeometry.dispose();
            libraryGeometry.dispose();
            return;
          }
          const original = job.mesh.geometry;
          // The descriptor matrices remain the authoritative physics bindings.
          // Only near/far rendering copies get an extra local-space fit.
          if (!isAuthoredLibraryAsset(path)) {
            const native = libraryGeometry.boundingBox!.getSize(new THREE.Vector3());
            job.adjustments = job.entries.map(entry => {
              const box = new THREE.Vector3(entry.size.x, entry.size.y, entry.size.z);
              const fit = fitLibraryModel(native, box, path);
              return new THREE.Matrix4().makeTranslation(0, -0.5, 0)
                .multiply(new THREE.Matrix4().makeScale(
                  1 / Math.max(box.x, 0.001),
                  1 / Math.max(box.y, 0.001),
                  1 / Math.max(box.z, 0.001),
                ))
                .multiply(new THREE.Matrix4().makeRotationY(fit.yaw))
                .multiply(new THREE.Matrix4().makeScale(
                  fit.scale.x, fit.scale.y, fit.scale.z));
            });
          } else if (island && (job.kind === 'tree-oak' || job.kind === 'tree-pine')) {
            const base = libraryGeometry.boundingBox!.min.y;
            job.adjustments = job.entries.map(prop => {
              const anchor = prop.transform.position;
              const y = prop.body.type === 'static'
                ? treeArtCenterY(island, anchor, prop.size.y, base) : anchor.y;
              return new THREE.Matrix4().makeTranslation(0, (y - anchor.y) / prop.size.y, 0);
            });
          } else if (job.kind === 'ramp' && job.entries.some(prop => prop.id.startsWith('downtown-bleatsville-ramp-'))) {
            // The loaded timber asset rises toward local -Z. The Downtown
            // service ramp colliders and fallback art rise toward +Z.
            job.adjustments = job.entries.map(prop => new THREE.Matrix4()
              .makeRotationY(prop.id.startsWith('downtown-bleatsville-ramp-') ? Math.PI : 0));
          } else if (job.entries.some(prop => prop.id.startsWith(CRANE_SWITCHBACK_PREFIX))) {
            const span = original.boundingBox!.getSize(new THREE.Vector3())
              .divide(libraryGeometry.boundingBox!.getSize(new THREE.Vector3()));
            job.adjustments = job.entries.map(prop => prop.id.startsWith(CRANE_SWITCHBACK_PREFIX)
              ? new THREE.Matrix4().makeScale(span.x, span.y, span.z) : new THREE.Matrix4());
          }
          job.mesh.geometry = libraryGeometry;
          if (island && job.stiltPose)
            job.stiltPose = setPinesStiltMorphs(job.mesh, job.entries, island, distantPinesGround, replacedPropIds);
          // Keep authored paint while tinting the marked access and its supports.
          for (let i = 0; i < job.entries.length; i++) {
            const prop = job.entries[i]!;
            const color = prop.color;
            if (color !== undefined && prop.id.startsWith(CRANE_SWITCHBACK_PREFIX)) {
              job.mesh.setColorAt(i, tint.setHex(color));
              continue;
            }
            job.mesh.setColorAt(i,
              job.kind === 'grass-tuft' || job.kind === 'tree-pine' ||
                authoredCraneYardKinds.has(job.kind) ||
                authoredBaaardwalkPaintedKinds.has(job.kind) ||
                authoredTownFarmKinds.has(job.kind) ||
                AUTHORED_HERO_DRESSING_KINDS.has(job.kind) || color === undefined
                ? white : job.kind === 'container' || job.kind === 'booth'
                  ? tint.setHex(color) : tint.setHex(color).lerp(white, 0.82));
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
          const far = distantGeometry === libraryGeometry ? near :
            new THREE.InstancedMesh(distantGeometry, job.mesh.material, job.entries.length);
          const copies = near === far ? [near] : [near, far];
          for (const [index, copy] of copies.entries()) {
            copy.name = 'render-' + (index === 0 ? 'near' : 'far') + '-' + job.kind;
            // Three sizes the morph texture on the first write. Allocate with
            // the full batch capacity before enabling visibility compaction.
            if (job.stiltPose) {
              job.mesh.getMorphAt(0, job.stiltPose);
              copy.setMorphAt(0, job.stiltPose);
            }
            copy.count = 0;
            copy.castShadow = job.mesh.castShadow;
            copy.receiveShadow = job.mesh.receiveShadow;
            copy.frustumCulled = false; // each instance is clipped below
            copy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            group.add(copy);
          }
          if (near === far) mergedFarMeshes.set('render-far-' + job.kind, near);
          job.near = near;
          job.far = far;
          job.batch.meshes.splice(0, job.batch.meshes.length, ...copies);
          job.mesh.visible = false;
          original.dispose();
          group.userData['libraryLoaded'] = (group.userData['libraryLoaded'] as number) + 1;
          if (job.mesh.castShadow) shadowChanged = true;
          if (island) await loadPlantVariants(job, island);
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
        if (disposed) return;
        const falls = jobs.filter(job => job.kind === 'cascade' ||
          job.kind === 'cascade-tall');
        if (falls.length === 2 && falls.every(job => job.near && job.near === job.far)) {
          // The painted models have the same position/normal/color attributes,
          // but different silhouettes. BatchedMesh keeps each geometry intact
          // while drawing both with one toon material and one draw call.
          const count = falls.reduce((total, job) => total + job.entries.length, 0);
          const vertices = falls.reduce((total, job) =>
            total + job.mesh.geometry.getAttribute('position').count, 0);
          const indices = falls.reduce((total, job) =>
            total + (job.mesh.geometry.index?.count ?? 0), 0);
          const batch = new THREE.BatchedMesh(count, vertices, indices,
            falls[0]!.mesh.material as THREE.MeshToonMaterial);
          batch.name = 'render-cascade-batch';
          batch.frustumCulled = false; // Explicit per-pool culling below.
          batch.perObjectFrustumCulled = false;
          const ids = new Map<Job, number[]>();
          const matrix = new THREE.Matrix4();
          for (const job of falls) {
            const geometryId = batch.addGeometry(job.mesh.geometry);
            const ownIds: number[] = [];
            for (let i = 0; i < job.entries.length; i++) {
              const instanceId = batch.addInstance(geometryId);
              job.mesh.getMatrixAt(i, matrix);
              batch.setMatrixAt(instanceId, matrix);
              batch.setColorAt(instanceId, new THREE.Color(0xffffff));
              ownIds.push(instanceId);
            }
            ids.set(job, ownIds);
            group.remove(job.near!);
            // Preserve the stable props-<kind> physics mesh and descriptor order.
            job.batch.meshes.length = 0;
          }
          falls[0]!.batch.meshes.push(batch);
          group.add(batch);
          cascadeBatch = { mesh: batch, ids };
        }
        group.userData['libraryReady'] = true;
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
        const fallIds = cascadeBatch?.ids.get(job);
        if (fallIds && cascadeBatch) {
          for (let i = 0; i < job.entries.length; i++) {
            job.mesh.getMatrixAt(i, matrix);
            const el = matrix.elements;
            centre.set(el[12]!, el[13]!, el[14]!);
            const size = job.entries[i]!.size;
            const radius = Math.hypot(size.x, size.y, size.z) * 0.52;
            test.center.copy(centre);
            test.radius = radius;
            const visible = !suppressed && !job.occluded[i] &&
              !(el[0] === 0 && el[5] === 0 && el[10] === 0) &&
              position.distanceTo(centre) - radius <= maxDistance &&
              frustum.intersectsSphere(test);
            cascadeBatch.mesh.setMatrixAt(fallIds[i]!, matrix);
            cascadeBatch.mesh.setVisibleAt(fallIds[i]!, visible);
          }
          continue;
        }
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
        if (!suppressed) for (const i of job.slots) {
          if (job.occluded[i]) continue;
          job.mesh.getMatrixAt(i, matrix);
          const el = matrix.elements;
          // The authored districts suppress old overlapping art with a
          // zero-scale transform, not by deleting its physics descriptor.
          if (el[0] === 0 && el[5] === 0 && el[10] === 0) continue;
          centre.set(el[12]!, el[13]!, el[14]!);
          const prop = job.entries[i]!;
          const size = prop.size;
          const radius = (summitLandmark(prop)
            ? Math.hypot(el[0]!, el[1]!, el[2]!, el[4]!, el[5]!, el[6]!, el[8]!, el[9]!, el[10]!)
            : Math.hypot(size.x, size.y, size.z)) * 0.52;
          test.set(centre, radius);
          if (job.stiltPose) test.copy(job.mesh.geometry.boundingSphere!).applyMatrix4(matrix);
          const distance = position.distanceTo(test.center) - test.radius;
          if (distance > (isSmallWorldModel(job.kind) ? WORLD_LOD.smallPropDistance : maxDistance)) continue;
          if (!frustum.intersectsSphere(test)) continue;
          (distance <= WORLD_LOD.detailedDistance ?
            nearIndices : farIndices).push(i);
        }
        const version = job.mesh.instanceMatrix.version;
        const changed = version !== job.originalVersion ||
          !same(job.nearIndices, nearIndices) || !same(job.farIndices, farIndices);
        if (changed) {
          const compact = (mesh: THREE.InstancedMesh, indices: readonly number[],
            offset = 0): void => {
            for (let at = 0; at < indices.length; at++) {
              const index = indices[at]!;
              job.mesh.getMatrixAt(index, matrix);
              const adjustment = job.adjustments?.[index];
              if (adjustment) matrix.multiply(adjustment);
              mesh.setMatrixAt(offset + at, matrix);
              if (job.mesh.instanceColor) {
                job.mesh.getColorAt(index, colour);
                mesh.setColorAt(offset + at, colour);
              }
              if (job.stiltPose) {
                job.mesh.getMorphAt(index, job.stiltPose);
                mesh.setMorphAt(offset + at, job.stiltPose);
              }
            }
          };
          const finish = (mesh: THREE.InstancedMesh, count: number): void => {
            mesh.count = count;
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
          };
          compact(job.near, nearIndices);
          if (job.near === job.far) {
            // One geometry/material draw: near descriptors first, then far.
            compact(job.near, farIndices, nearIndices.length);
            finish(job.near, nearIndices.length + farIndices.length);
          } else {
            compact(job.far, farIndices);
            finish(job.near, nearIndices.length);
            finish(job.far, farIndices.length);
          }
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
    dispose(): void {
      disposed = true;
      const instances = new Set<THREE.InstancedMesh>();
      for (const job of jobs) {
        instances.add(job.mesh);
        if (job.near) instances.add(job.near);
        if (job.far) instances.add(job.far);
      }
      for (const instance of instances) instance.dispose();
    },
  };
}
