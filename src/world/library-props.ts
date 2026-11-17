import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PropKind } from './types';
import { publicAssetUrl } from './public-assets';
import { isAuthoredLibraryAsset } from './library-fit';

/**
 * Every procedural prop has a sourced CC0 replacement. All paths are checked
 * against public/assets/library/manifest.json by library-props.test.ts.
 * Some specialized details have no exact CC0 asset (dish, trampoline, jib);
 * their closest pack equivalents are listed explicitly rather than loading
 * uncredited CC-BY files.
 */
export const PROP_LIBRARY_MODELS = {
  'barn': 'assets/library/quaternius/farm-buildings-bundle/small-barn_aTcDP7UERC.glb',
  // Painting-palette Kenney suburban houses (docs/art/WORLD_ART_PLAN.md).
  'house': 'assets/library/custom/hoofington-houses/house-t-white.glb',
  'shop': 'assets/library/kenney/city-kit-commercial/building-a.glb',
  'tower': 'assets/library/kenney/pirate-kit/tower-watch.glb',
  'windmill': 'assets/library/custom/hoofington-props/windmill.glb',
  'lighthouse': 'assets/library/custom/lighthouse/lighthouse.glb',
  'ferris-wheel': 'assets/library/polypizza/ferris-wheel/ferris-wheel_6CepsZjXBw.glb',
  'crane': 'assets/library/custom/crane-yard/crane-mast.glb',
  'scaffold': 'assets/library/kenney/retro-urban-kit/scaffolding-structure.glb',
  'beam': 'assets/library/kenney/retro-urban-kit/detail-beam.glb',
  'pier': 'assets/library/kenney/pirate-kit/structure-platform-dock.glb',
  'deck': 'assets/library/kenney/pirate-kit/platform-planks.glb',
  'pier-rail': 'assets/library/kenney/pirate-kit/structure-fence.glb',
  'bumper': 'assets/library/kenney/city-kit-roads/construction-barrier.glb',
  'booth': 'assets/library/kenney/fantasy-town-kit/stall-red.glb',
  'satellite-dish': 'assets/library/kenney/furniture-kit/televisionAntenna.glb',
  'dam-wall': 'assets/library/kenney/factory-kit/structure-wall.glb',
  'fence': 'assets/library/custom/hoofington-props/picket-fence.glb',
  'hay-bale': 'assets/library/polypizza/hay-bale/hay_Yu8TOERkpw.glb',
  'crate': 'assets/library/kenney/platformer-kit/crate.glb',
  'barrel': 'assets/library/kenney/survival-kit/barrel.glb',
  'tree-pine': 'assets/library/kenney/nature-kit/tree_pineTallA.glb',
  'tree-oak': 'assets/library/custom/hoofington-props/tree-round-a.glb',
  'rock': 'assets/library/kenney/nature-kit/rock_largeB.glb',
  'log': 'assets/library/kenney/nature-kit/log.glb',
  'lamp': 'assets/library/usdcraft/street-lamp-lantern.glb',
  'ramp': 'assets/library/kenney/platformer-kit/platform-ramp.glb',
  'ledge': 'assets/library/kenney/nature-kit/cliff_half_rock.glb',
  'bridge': 'assets/library/kenney/nature-kit/bridge_wood.glb',
  'bench': 'assets/library/kenney/retro-urban-kit/detail-bench.glb',
  'sign': 'assets/library/kenney/city-kit-roads/road-sign-empty.glb',
  'flag': 'assets/library/kenney/pirate-kit/flag-high.glb',
  'buoy': 'assets/library/kenney/watercraft-kit/buoy.glb',
  'platform': 'assets/library/kenney/platformer-kit/platform.glb',
  'silo': 'assets/library/custom/hoofington-props/silo.glb',
  'mailbox': 'assets/library/custom/hoofington-props/mailbox.glb',
  'gnome': 'assets/library/polypizza/garden-gnome/gnome_Yy3yuQ4l6r.glb',
  'trampoline': 'assets/library/kenney/platformer-kit/spring.glb',
  'bunting': 'assets/library/kenney/holiday-kit/lights-colored.glb',
  'container': 'assets/library/kenney/city-kit-industrial/shipping-container-a.glb',
  'cone': 'assets/library/kenney/city-kit-roads/construction-cone.glb',
  'awning': 'assets/library/kenney/city-kit-commercial/detail-awning.glb',
  'planter': 'assets/library/kenney/city-kit-suburban/planter.glb',
  'fountain': 'assets/library/kenney/fantasy-town-kit/fountain-round.glb',
  'ac-unit': 'assets/library/kenney/factory-kit/machine.glb',
  'water-tower': 'assets/library/kenney/city-kit-industrial/water-tower.glb',
  'mushroom': 'assets/library/kenney/nature-kit/mushroom_red.glb',
  'stump': 'assets/library/kenney/nature-kit/stump_round.glb',
  'lookout': 'assets/library/kenney/pirate-kit/tower-watch.glb',
  'control-house': 'assets/library/kenney/city-kit-industrial/building-a.glb',
  'dock': 'assets/library/kenney/pirate-kit/structure-platform-dock-small.glb',
  'cottage': 'assets/library/custom/hoofington-houses/house-f-white.glb',
  'shipwreck': 'assets/library/kenney/pirate-kit/ship-wreck.glb',
  'cave-mouth': 'assets/library/kenney/nature-kit/cliff_cave_rock.glb',
  'bush': 'assets/library/custom/hoofington-props/bush-round-a.glb',
  'flower': 'assets/library/custom/hoofington-props/flowers-pink.glb',
  'grass-tuft': 'assets/library/custom/hoofington-props/daisies.glb',
  'rope-rail': 'assets/library/kenney/platformer-kit/fence-rope.glb',
  'stepping-stone': 'assets/library/kenney/nature-kit/rock_smallFlatA.glb',
  'chimney': 'assets/library/kenney/city-kit-industrial/chimney-small.glb',
  'signboard': 'assets/library/kenney/city-kit-roads/sign-highway-wide.glb',
  'concrete-slab': 'assets/library/kenney/factory-kit/floor-large.glb',
  'concrete-column': 'assets/library/kenney/nature-kit/statue_column.glb',
  'yard-scaffold': 'assets/library/kenney/retro-urban-kit/scaffolding-structure.glb',
  'safety-rail': 'assets/library/kenney/city-kit-roads/construction-barrier.glb',
  'chain-fence': 'assets/library/kenney/city-kit-roads/construction-fence.glb',
  'crane-jib': 'assets/library/custom/crane-yard/crane-jib.glb',
  'crane-cab': 'assets/library/custom/crane-yard/crane-cab.glb',
  'crane-cable': 'assets/library/custom/crane-yard/crane-cable.glb',
  'red-girder': 'assets/library/custom/crane-yard/red-girder.glb',
  'pipe-stack': 'assets/library/kenney/factory-kit/pipe-large.glb',
  'site-barrier': 'assets/library/kenney/city-kit-roads/construction-barrier.glb',
} as const satisfies Record<PropKind, string>;

type PixelMap = { data: Uint8ClampedArray; width: number; height: number };

/** Extract an atlas only once per texture; never create per-instance materials. */
function pixels(texture: THREE.Texture, cache: Map<THREE.Texture, PixelMap | null>): PixelMap | null {
  if (cache.has(texture)) return cache.get(texture)!;
  let result: PixelMap | null = null;
  if (typeof document !== 'undefined') {
    try {
      const image = texture.image as CanvasImageSource & { width?: number; height?: number };
      if (image && image.width && image.height) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(256, image.width);
        canvas.height = Math.min(256, image.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context) {
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          result = { data: context.getImageData(0, 0, canvas.width, canvas.height).data,
            width: canvas.width, height: canvas.height };
        }
      }
    } catch {
      // No canvas or inaccessible atlas: material and vertex paint remain.
    }
  }
  cache.set(texture, result);
  return result;
}

/**
 * Bake all GLB primitives and their source paint into ONE unindexed geometry.
 * Instancing this result costs one draw per prop kind, not one per GLB part.
 * World transforms are folded in before the authored collider-sized envelope
 * is applied. Descriptor positions, yaw and sizes remain untouched.
 */
export function bakeLibraryPropGeometry(
  kind: PropKind, root: THREE.Object3D,
): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) return null;
  const span = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const authored = isAuthoredLibraryAsset(PROP_LIBRARY_MODELS[kind]);
  const scale = new THREE.Vector3(
    0.98 / Math.max(0.001, span.x),
    0.98 / Math.max(0.001, span.y),
    0.98 / Math.max(0.001, span.z),
  );
  const positions: number[] = [], colours: number[] = [];
  const vertex = new THREE.Vector3(), uv = new THREE.Vector2();
  const colour = new THREE.Color(), texel = new THREE.Color();
  const white = new THREE.Color(0xffffff);
  const imageCache = new Map<THREE.Texture, PixelMap | null>();
  const paintedFoliage = new Set<PropKind>([
    'tree-pine', 'planter',
  ]);

  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.geometry;
    const coordinates = source.getAttribute('position');
    if (!coordinates || coordinates.itemSize < 3) return;
    const vertexColours = source.getAttribute('color');
    const textureCoords = source.getAttribute('uv');
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const groups = source.groups;
    const indices = source.index;
    const count = indices ? indices.count : coordinates.count;
    let groupIndex = 0;
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      for (let corner = 0; corner < 3; corner++) {
        const at = triangle + corner;
        while (groupIndex + 1 < groups.length &&
          at >= groups[groupIndex]!.start + groups[groupIndex]!.count) groupIndex++;
        const material = materials[groups[groupIndex]?.materialIndex ?? 0] ?? materials[0]!;
        const index = indices ? indices.getX(at) : at;
        vertex.fromBufferAttribute(coordinates as THREE.BufferAttribute, index);
        if (object instanceof THREE.SkinnedMesh) object.applyBoneTransform(index, vertex);
        vertex.applyMatrix4(object.matrixWorld);
        // Authored anchor-frame assets retain their legacy per-axis envelope.
        // Other GLBs keep native dimensions for a uniform per-instance fit.
        positions.push(
          authored ? (vertex.x - centre.x) * scale.x : vertex.x - centre.x,
          authored ? (vertex.y - centre.y) * scale.y : vertex.y - bounds.min.y,
          authored ? (vertex.z - centre.z) * scale.z : vertex.z - centre.z,
        );
        const height = (vertex.y - bounds.min.y) / Math.max(0.001, span.y);
        const base = (material as THREE.MeshStandardMaterial).color;
        colour.copy(base instanceof THREE.Color ? base : white);
        if (vertexColours && vertexColours.itemSize >= 3) {
          colour.r *= vertexColours.getX(index);
          colour.g *= vertexColours.getY(index);
          colour.b *= vertexColours.getZ(index);
        }
        const map = (material as THREE.MeshStandardMaterial).map;
        // Legacy pine/planter foliage needs painted colours in place of
        // alpha-atlas padding. Blender props retain source paint.
        if (!paintedFoliage.has(kind) && map && textureCoords && textureCoords.itemSize >= 2) {
          const image = pixels(map, imageCache);
          if (image) {
            uv.set(textureCoords.getX(index), textureCoords.getY(index));
            map.transformUv(uv);
            // Quantize to the nearest texel centre, not a width-1/height-1
            // interpolation that can pick the neighbouring palette swatch.
            const x = Math.min(image.width - 1, Math.max(0, Math.floor(uv.x * image.width)));
            // GLTFLoader textures have flipY=false: transformed v is top-down.
            const v = map.flipY ? 1 - uv.y : uv.y;
            const y = Math.min(image.height - 1,
              Math.max(0, Math.floor(v * image.height)));
            const pixel = (y * image.width + x) * 4;
            if (image.data[pixel + 3]! > 24) {
              texel.setRGB(image.data[pixel]! / 255,
                image.data[pixel + 1]! / 255, image.data[pixel + 2]! / 255,
                THREE.SRGBColorSpace);
              colour.multiply(texel);
            }
          }
        }
        if (kind === 'tree-pine') colour.setHex(height > 0.23 ? 0x478f62 : 0x856346);
        else if (kind === 'planter') colour.setHex(height > 0.57 ? 0x77b65f : 0xbb8967);
        colours.push(colour.r, colour.g, colour.b);
      }
    }
  });
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Release transient GLTF resources once their colour and geometry are baked. */
function disposeLoadedModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}

/** Failure rejects, allowing the existing procedural instancing to remain. */
export async function loadLibraryPropGeometry(
  kind: PropKind, loader: GLTFLoader,
): Promise<THREE.BufferGeometry> {
  const model = await loader.loadAsync(publicAssetUrl(PROP_LIBRARY_MODELS[kind]));
  try {
    if (kind === 'lamp') {
      // Districts draw all street lamps in native-material near/far batches.
      // The legacy prop's instance indices remain intact for physics, but its
      // geometry must be inert: baking this GLB would duplicate and repaint it.
      // Load before returning so a missing asset preserves procedural fallback.
      const marker = new THREE.BufferGeometry();
      marker.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0, 0, 0, 0, 0, 0, 0,
      ], 3));
      marker.setAttribute('color', new THREE.Float32BufferAttribute([
        1, 1, 1, 1, 1, 1, 1, 1, 1,
      ], 3));
      marker.computeBoundingSphere();
      return marker;
    }
    const geometry = bakeLibraryPropGeometry(kind, model.scene);
    if (!geometry) throw new Error('Library model has no visible triangles: ' + kind);
    return geometry;
  } finally {
    disposeLoadedModel(model.scene);
  }
}
