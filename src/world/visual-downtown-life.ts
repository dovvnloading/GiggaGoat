import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData, Vec3 } from './types';
import { DOWNTOWN_MODELS, makeDowntownPlacements, type DowntownPlacement } from './visual-downtown';
import { bakeLibraryGeometry } from './visual-hoofington';
import { fitLibraryModel } from './library-fit';
import { publicAssetUrl } from './public-assets';
import { sampleEnvironmentWind } from './environment-wind';

const CUP = 'assets/library/kenney/food-kit/cup-coffee.glb';
// Measured from the shipped fountain GLB, including its two water surfaces.
const FOUNTAIN_NATIVE = new THREE.Vector3(2, .480000019, 2);
const TABLE_NATIVE = new THREE.Vector3(.6928203, .366733961, .8);

export interface DowntownLifeAnchors {
  fountain: { position: Vec3; scale: number; basinY: number; nozzleY: number; radius: number } | null;
  tables: { position: Vec3; scale: number }[];
}

/** Derive supports from the same fitted library art, not its larger descriptor envelope. */
export function downtownLifeAnchors(island: IslandData): DowntownLifeAnchors {
  const plan = makeDowntownPlacements(island);
  const source = plan.find(p => p.model === 'fountain');
  let fountain: DowntownLifeAnchors['fountain'] = null;
  if (source) {
    const scale = fitLibraryModel(FOUNTAIN_NATIVE, new THREE.Vector3().copy(source.size), DOWNTOWN_MODELS.fountain).scale.x;
    const floor = source.position.y - source.size.y / 2;
    fountain = { position: { x: source.position.x, y: floor, z: source.position.z }, scale,
      basinY: floor + .143 * scale, nozzleY: floor + .465 * scale, radius: .69 * scale };
  }
  const tables = plan.filter(p => p.model === 'table').map(p => {
    const fit = fitLibraryModel(TABLE_NATIVE, new THREE.Vector3().copy(p.size), DOWNTOWN_MODELS.table);
    return { position: { x: p.position.x, y: p.position.y - p.size.y / 2 + TABLE_NATIVE.y * fit.scale.y,
      z: p.position.z }, scale: island.size / 600 };
  });
  return { fountain, tables };
}

/**
 * Copy only the named, authored ShopGlass triangles, with exactly the same
 * .96/.98 fit as the district baker. Frames, signs, doors and paint stay intact.
 */
export function downtownWindowGeometry(
  placements: readonly DowntownPlacement[], sources: ReadonlyMap<string, THREE.Group>,
): THREE.BufferGeometry | null {
  const coordinates: number[] = [];
  const vertex = new THREE.Vector3(), local = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  for (const place of placements) {
    if (place.source?.kind !== 'shop') continue;
    const model = sources.get(place.model);
    if (!model) continue;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model), span = bounds.getSize(new THREE.Vector3());
    if (Math.min(span.x, span.y, span.z) < .0001) continue;
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw);
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const geometry = node.geometry, positions = geometry.getAttribute('position'), indices = geometry.index;
      const groups = geometry.groups.length ? geometry.groups : [{ start: 0,
        count: indices?.count ?? positions.count, materialIndex: 0 }];
      for (const part of groups) {
        if (materials[part.materialIndex ?? 0]?.name !== 'ShopGlass') continue;
        for (let i = part.start; i < part.start + part.count; i++) {
          const index = indices ? indices.getX(i) : i;
          vertex.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld);
          local.set(((vertex.x - bounds.min.x) / span.x - .5) * place.size.x * .96,
            ((vertex.y - bounds.min.y) / span.y - .5) * place.size.y * .98,
            ((vertex.z - bounds.min.z) / span.z - .5) * place.size.z * .96).applyQuaternion(rotation);
          coordinates.push(local.x + place.position.x, local.y + place.position.y, local.z + place.position.z);
        }
      }
    });
  }
  if (!coordinates.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeSource(asset: GLTF): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  asset.scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const item of geometries) item.dispose();
  for (const item of materials) item.dispose();
  for (const item of textures) item.dispose();
}

export function buildDowntownLifeVisuals(island: IslandData) {
  const group = new THREE.Group();
  group.name = 'downtown-fountain-and-service';
  group.userData['ready'] = typeof document === 'undefined';
  const anchors = downtownLifeAnchors(island), plan = makeDowntownPlacements(island);
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  let disposed = false, cupsReady = false;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const loaded: GLTF[] = [];
  const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffce87, transparent: true,
    opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  materials.add(windowMaterial);
  const fountainCount = anchors.fountain ? 96 : 0;
  const steamCount = anchors.tables.length * 12;
  const count = fountainCount + steamCount;
  const positions = new Float32Array(count * 3), colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count), opacity = new Float32Array(count);
  const particlesGeometry = new THREE.BufferGeometry();
  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  particlesGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  particlesGeometry.setAttribute('alpha', new THREE.BufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage));
  geometries.add(particlesGeometry);
  const particlesMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true,
    uniforms: { brightness: { value: 1 }, viewportScale: { value: 480 } },
    vertexShader: `attribute float size; attribute float alpha;
varying vec3 vColor; varying float vAlpha;
uniform float viewportScale;
void main() {
  vec4 at = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * at;
  gl_PointSize = clamp(size * viewportScale / max(1.0, -at.z), 1.0, 18.0);
  vColor = color; vAlpha = alpha;
}`,
    fragmentShader: `uniform float brightness;
varying vec3 vColor; varying float vAlpha;
void main() {
  float radius = length(gl_PointCoord - .5) * 2.0;
  float alpha = (1.0 - smoothstep(.25, 1.0, radius)) * vAlpha;
  if (alpha < .005) discard;
  gl_FragColor = vec4(vColor * brightness, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  materials.add(particlesMaterial);
  const particles = new THREE.Points(particlesGeometry, particlesMaterial);
  particles.name = 'fountain-droplets-and-cafe-steam';
  particles.frustumCulled = false;
  group.add(particles);
  for (let i = 0; i < count; i++) {
    const steam = i >= fountainCount;
    colours.set(steam ? [.88, .91, .87] : [.48, .84, .92], i * 3);
    sizes[i] = (steam ? .15 : .065) * scale;
  }
  const rippleGeometry = new THREE.RingGeometry(.93, 1, 24).rotateX(-Math.PI / 2);
  const rippleMaterial = new THREE.MeshBasicMaterial({ color: 0xb9eff2, transparent: true,
    opacity: .34, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  geometries.add(rippleGeometry); materials.add(rippleMaterial);
  const ripples = new THREE.InstancedMesh(rippleGeometry, rippleMaterial, anchors.fountain ? 8 : 1);
  ripples.name = 'fountain-impact-ripples';
  ripples.count = anchors.fountain ? 8 : 0;
  ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ripples.frustumCulled = false;
  group.add(ripples);
  const ripple = new THREE.Object3D(), rippleColour = new THREE.Color();
  const wind = sampleEnvironmentWind(0, island.seed);

  if (typeof document !== 'undefined') {
    const loader = new GLTFLoader();
    const required = [...new Set(plan.filter(p => p.source?.kind === 'shop').map(p => p.model))];
    const windowLoads = required.map(async model => {
      const asset = await loader.loadAsync(publicAssetUrl(DOWNTOWN_MODELS[model]));
      if (disposed) { disposeSource(asset); return null; }
      loaded.push(asset);
      return [model, asset.scene] as const;
    });
    const cupLoad = loader.loadAsync(publicAssetUrl(CUP)).then(asset => {
      if (disposed) { disposeSource(asset); return; }
      loaded.push(asset);
      const coffeePlan = anchors.tables.map(table => ({ model: 'coffee', yaw: .3,
        size: { x: .20 * scale, y: .17 * scale, z: .20 * scale },
        position: { x: table.position.x, y: table.position.y + .085 * scale, z: table.position.z } }));
      const geometry = bakeLibraryGeometry(coffeePlan, new Map([['coffee', asset.scene]]), undefined, { coffee: CUP });
      if (!geometry) return;
      const material = new THREE.MeshToonMaterial({ vertexColors: true });
      geometries.add(geometry); materials.add(material);
      const cups = new THREE.Mesh(geometry, material);
      cups.name = 'cafe-coffee-service';
      cups.receiveShadow = true;
      group.add(cups);
      cupsReady = true;
    }).catch(error => {
      if (!disposed) console.warn('Cafe service art unavailable:', error);
    });
    void Promise.allSettled(windowLoads).then(results => {
      if (disposed) return;
      const sources = new Map<string, THREE.Group>();
      for (const result of results) if (result.status === 'fulfilled' && result.value) sources.set(...result.value);
      const geometry = downtownWindowGeometry(plan, sources);
      if (geometry) {
        geometries.add(geometry);
        const windows = new THREE.Mesh(geometry, windowMaterial);
        windows.name = 'occupied-shopfront-windows';
        group.add(windows);
      }
    }).then(() => cupLoad).catch(error => {
      if (!disposed) console.warn('Downtown service detail unavailable:', error);
    }).finally(() => {
      for (const asset of loaded) disposeSource(asset);
      loaded.length = 0;
      group.userData['ready'] = true;
    });
  }

  return {
    group,
    anchors,
    update(time: number, daylight: number, rain: number, camera: THREE.Vector3): void {
      if (disposed || !Number.isFinite(time)) return;
      const distance = Math.hypot(camera.x - centre.x, camera.z - centre.z);
      group.visible = distance < (group.visible ? 235 : 215) * scale;
      if (!group.visible) return;
      windowMaterial.opacity = .68 * (1 - THREE.MathUtils.smoothstep(daylight, .15, .6));
      particlesMaterial.uniforms['brightness']!.value = .34 + .66 * daylight;
      sampleEnvironmentWind(time, island.seed, rain, centre.x, centre.z, wind);
      if (anchors.fountain) {
        const f = anchors.fountain;
        for (let i = 0; i < fountainCount; i++) {
          const nozzle = i % 4, angle = nozzle * Math.PI / 2 + Math.PI / 4;
          const phase = (time * .76 + Math.floor(i / 4) / 24 + nozzle * .071) % 1;
          const radius = (.04 + .53 * phase) * f.scale;
          positions[i * 3] = f.position.x + Math.cos(angle) * radius + wind.x * .007 * phase;
          positions[i * 3 + 1] = f.nozzleY + Math.sin(Math.PI * phase) * .24 * f.scale + (f.basinY - f.nozzleY) * phase;
          positions[i * 3 + 2] = f.position.z + Math.sin(angle) * radius + wind.z * .007 * phase;
          opacity[i] = .78;
        }
        for (let i = 0; i < 8; i++) {
          const angle = (i % 4) * Math.PI / 2 + Math.PI / 4;
          const phase = (time * .76 + Math.floor(i / 4) * .5) % 1;
          ripple.position.set(f.position.x + Math.cos(angle) * .57 * f.scale, f.basinY + .008,
            f.position.z + Math.sin(angle) * .57 * f.scale);
          const radius = (.025 + phase * .085) * f.scale;
          ripple.scale.set(radius, 1, radius);
          ripple.updateMatrix();
          ripples.setMatrixAt(i, ripple.matrix);
          rippleColour.setScalar((1 - phase) * (.4 + .6 * daylight));
          ripples.setColorAt(i, rippleColour);
        }
        ripples.instanceMatrix.needsUpdate = true;
        if (ripples.instanceColor) ripples.instanceColor.needsUpdate = true;
      }
      for (let t = 0; t < anchors.tables.length; t++) {
        const table = anchors.tables[t]!;
        for (let j = 0; j < 12; j++) {
          const i = fountainCount + t * 12 + j;
          const phase = (time * .32 + j / 12 + t * .37) % 1;
          const curl = Math.sin(phase * 5 + t * 2.7) * .035 * scale;
          positions[i * 3] = table.position.x + curl + wind.x * phase * .025;
          positions[i * 3 + 1] = table.position.y + (.13 + phase * .65) * scale;
          positions[i * 3 + 2] = table.position.z + wind.z * phase * .025;
          opacity[i] = cupsReady ? Math.sin(phase * Math.PI) * .19 * (.35 + .65 * daylight) : 0;
        }
      }
      particlesGeometry.getAttribute('position').needsUpdate = true;
      particlesGeometry.getAttribute('alpha').needsUpdate = true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const asset of loaded) disposeSource(asset);
      loaded.length = 0;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      ripples.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
