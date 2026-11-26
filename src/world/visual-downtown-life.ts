import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData, Vec3 } from './types';
import { DOWNTOWN_MODELS, makeDowntownPlacements } from './visual-downtown';
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
  const anchors = downtownLifeAnchors(island);
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  let disposed = false, cupsReady = false;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const fountainCount = anchors.fountain ? 96 : 0;
  const servings = anchors.tables.flatMap(table => [-1, 1].map(side =>
    ({ ...table.position, z: table.position.z + side * .37 * scale })));
  const steamCount = servings.length * 6;
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
    void loader.loadAsync(publicAssetUrl(CUP)).then(asset => {
      try {
        if (disposed) return;
        const coffeePlan = servings.map(point => ({ model: 'coffee', yaw: .3,
          size: { x: .24 * scale, y: .17 * scale, z: .24 * scale },
          position: { ...point, y: point.y + .085 * scale } }));
        const geometry = bakeLibraryGeometry(coffeePlan, new Map([['coffee', asset.scene]]), undefined, { coffee: CUP });
        if (!geometry) return;
        const material = new THREE.MeshToonMaterial({ vertexColors: true });
        geometries.add(geometry); materials.add(material);
        const cups = new THREE.Mesh(geometry, material);
        cups.name = 'cafe-coffee-service';
        cups.receiveShadow = true;
        group.add(cups);
        cupsReady = true;
      } finally { disposeSource(asset); }
    }).catch(error => {
      if (!disposed) console.warn('Cafe service art unavailable:', error);
    }).finally(() => {
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
      for (let t = 0; t < servings.length; t++) {
        const cup = servings[t]!;
        for (let j = 0; j < 6; j++) {
          const i = fountainCount + t * 6 + j;
          const phase = (time * .32 + j / 6 + t * .37) % 1;
          const curl = Math.sin(phase * 5 + t * 2.7) * .035 * scale;
          positions[i * 3] = cup.x + curl + wind.x * phase * .025;
          positions[i * 3 + 1] = cup.y + (.13 + phase * .65) * scale;
          positions[i * 3 + 2] = cup.z + wind.z * phase * .025;
          opacity[i] = cupsReady ? Math.sin(phase * Math.PI) * .19 * (.35 + .65 * daylight) : 0;
        }
      }
      particlesGeometry.getAttribute('position').needsUpdate = true;
      particlesGeometry.getAttribute('alpha').needsUpdate = true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      ripples.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
