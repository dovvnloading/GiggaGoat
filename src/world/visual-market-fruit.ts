import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Vec3 } from './types';
import { publicAssetUrl } from './public-assets';
import { bakeLibraryGeometry } from './visual-hoofington';
import { applyAmbientDistanceFade } from './visual-wind';

/** A presentation contract only: core owns all physical bodies and lifetimes. */
export interface MarketFruitVisualState {
  readonly id: string;
  readonly model: 'apple' | 'orange';
  readonly radius: number;
  readonly position: Vec3;
  readonly rotation: { x: number; y: number; z: number; w: number };
  readonly visible: boolean;
}

export const MARKET_FRUIT_MODELS = {
  apple: 'assets/library/kenney/food-kit/apple.glb',
  orange: 'assets/library/kenney/food-kit/orange.glb',
} as const;

/** Native palette and proportions; centre a unit-diameter model on the body. */
export function marketFruitGeometry(asset: GLTF): THREE.BufferGeometry | null {
  const geometry = bakeLibraryGeometry([{ model: 'fruit', yaw: 0,
    position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } }],
  new Map([['fruit', asset.scene]]));
  if (!geometry) return null;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  if (!(span > 0) || !Number.isFinite(span)) { geometry.dispose(); return null; }
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / span, 1 / span, 1 / span);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function releaseAsset(asset: GLTF): void {
  const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  asset.scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometry.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const item of geometry) item.dispose();
  for (const item of materials) item.dispose();
  for (const item of textures) item.dispose();
}

/** Two fixed-capacity instanced draws, including while fruit is in flight. */
export function buildMarketFruitVisuals(
  initialItems: readonly MarketFruitVisualState[],
  options: { loadAsset?: (url: string) => Promise<GLTF> } = {},
) {
  const root = new THREE.Group();
  root.name = 'reactive-market-fruit';
  root.userData['ready'] = false;
  const batches = new Map<MarketFruitVisualState['model'], THREE.InstancedMesh>();
  const material = new THREE.MeshToonMaterial({ vertexColors: true });
  // Finish the visual fade well before the director's hidden physical cleanup.
  // Both fruit batches share this opaque alpha-hashed material.
  applyAmbientDistanceFade(material, 55, 80);
  const dummy = new THREE.Object3D();
  let disposed = false;
  const models = [...new Set(initialItems.map(item => item.model))];
  const canLoad = options.loadAsset || typeof document !== 'undefined';
  const ready = Promise.allSettled(canLoad ? models.map(async model => {
    let asset: GLTF | undefined;
    try {
      asset = await (options.loadAsset
        ? options.loadAsset(publicAssetUrl(MARKET_FRUIT_MODELS[model]))
        : new GLTFLoader().loadAsync(publicAssetUrl(MARKET_FRUIT_MODELS[model])));
      if (disposed) return;
      const geometry = marketFruitGeometry(asset);
      if (!geometry) throw new Error('Market fruit has no valid geometry');
      const capacity = initialItems.filter(item => item.model === model).length;
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.name = 'market-' + model;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      batches.set(model, mesh);
      root.add(mesh);
    } catch (error) {
      if (!disposed) console.warn('Market fruit art unavailable:', model, error);
    } finally {
      if (asset && !options.loadAsset) releaseAsset(asset);
    }
  }) : []).then(() => { root.userData['ready'] = true; });

  return {
    root,
    ready,
    update(items: readonly MarketFruitVisualState[], cameraPosition?: Readonly<Vec3>): void {
      if (disposed) return;
      for (const [model, mesh] of batches) {
        let count = 0;
        for (const item of items) {
          if (item.model !== model || !item.visible || count >= mesh.instanceMatrix.count) continue;
          const p = item.position, q = item.rotation;
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) ||
            !Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) ||
            !Number.isFinite(q.w) || !Number.isFinite(item.radius) || item.radius <= 0) continue;
          if (cameraPosition) {
            const dx = p.x - cameraPosition.x, dy = p.y - cameraPosition.y, dz = p.z - cameraPosition.z;
            // Include the whole fruit envelope plus a small margin: culling
            // cannot remove a vertex while the shader still gives it opacity.
            if (dx * dx + dy * dy + dz * dz > (82 + item.radius) ** 2) continue;
          }
          dummy.position.copy(p);
          dummy.quaternion.set(q.x, q.y, q.z, q.w).normalize();
          dummy.scale.setScalar(item.radius * 2);
          dummy.updateMatrix();
          mesh.setMatrixAt(count++, dummy.matrix);
        }
        mesh.count = count;
        mesh.visible = count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (count) mesh.computeBoundingSphere();
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const mesh of batches.values()) { mesh.geometry.dispose(); mesh.dispose(); }
      batches.clear();
      material.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}
