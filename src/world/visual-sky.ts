import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CLOUD_LIBRARY_MODELS, loadLibraryCloudGeometry } from './library-props';

/** Daytime horizon RGB in the sky shader's linear working space. */
export const SKY_HORIZON_COLOR = new THREE.Color(0.76, 0.88, 0.98);

/** Golden-hour palette in Three.js linear colour space; daytime stays separate. */
export const GOLDEN_HOUR_SKY = {
  horizon: new THREE.Color(0xffb27a),
  mid: new THREE.Color(0xd98bc4),
  zenith: new THREE.Color(0x6b5fd1),
} as const;
// Clouds need a brighter, gentler shade than the shared prop toon ramp.
const CLOUD_RAMP = new THREE.DataTexture(
  new Uint8Array([
    214, 214, 214, 255,
    232, 232, 232, 255,
    246, 246, 246, 255,
    255, 255, 255, 255,
  ]),
  4, 1, THREE.RGBAFormat,
);
CLOUD_RAMP.magFilter = THREE.NearestFilter;
CLOUD_RAMP.minFilter = THREE.NearestFilter;
CLOUD_RAMP.generateMipmaps = false;
CLOUD_RAMP.needsUpdate = true;

export type LightingPreset = 'day' | 'golden-hour' | 'night';

export interface SkyVisuals {
  group: THREE.Group;
  update(phase: number): { daylight: number; altitude: number; direction: THREE.Vector3 };
}

/** Gradient dome with an actual sun disc, cloud banks and softly glowing night stars. */
export function buildSkyVisuals(): SkyVisuals {
  const group = new THREE.Group();
  group.name = 'storybook-sky';
  const uniforms = {
    uDay: { value: 1 },
    uGolden: { value: 0 },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uHorizon: { value: SKY_HORIZON_COLOR },
    uSunsetHorizon: { value: GOLDEN_HOUR_SKY.horizon },
    uSunsetMid: { value: GOLDEN_HOUR_SKY.mid },
    uSunsetZenith: { value: GOLDEN_HOUR_SKY.zenith },
    uSunGlowStrength: { value: 0.29 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 18),
    new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: [
        'varying vec3 vDirection;',
        'void main() {',
        '  vDirection = normalize(position);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uDay, uGolden, uSunGlowStrength;',
        'uniform vec3 uSun, uHorizon, uSunsetHorizon, uSunsetMid, uSunsetZenith;',
        'varying vec3 vDirection;',
        'void main() {',
        '  vec3 dir = normalize(vDirection);',
        '  float horizon = smoothstep(-0.15, 0.90, dir.y);',
        '  vec3 sunny = mix(uHorizon, vec3(0.08, 0.48, 0.94), horizon);',
        '  vec3 sunset = mix(uSunsetHorizon, uSunsetMid, smoothstep(0.0, 0.5, horizon));',
        '  sunset = mix(sunset, uSunsetZenith, smoothstep(0.5, 1.0, horizon));',
        '  vec3 night = mix(vec3(0.18, 0.22, 0.38), vec3(0.018, 0.045, 0.14), horizon);',
        '  vec3 dayColor = mix(sunny, sunset, uGolden);',
        '  float glow = max(dot(dir, normalize(uSun)), 0.0);',
        '  glow *= glow; glow *= glow; glow *= glow; glow *= glow; glow *= glow;',
        '  dayColor += vec3(1.0, 0.72, 0.36) * glow * uSunGlowStrength;',
        '  gl_FragColor = vec4(mix(night, dayColor, max(uDay, uGolden)), 1.0);',
        '}',
      ].join('\n'),
    }));
  dome.name = 'gradient-sky';
  dome.frustumCulled = false;
  group.add(dome);

  // Keep all 24 historical bank positions and all ten RNG draws per bank:
  // two for the ring, one for height, one for breadth, six for retired puffs.
  // The three authored, individually painted cumulus GLBs become one draw each.
  const cloudMaterial = new THREE.MeshToonMaterial({
    color: 0xffffff, vertexColors: true, gradientMap: CLOUD_RAMP,
    emissive: 0xffffff, emissiveIntensity: 0.3,
    transparent: true, opacity: 0.94, depthWrite: false, fog: true,
  });
  const CLOUD_BOTTOM = 300, CLOUD_TOP = 380;
  interface CloudPlacement { x: number; z: number; heightFraction: number; scale: number }
  const placements: CloudPlacement[][] = CLOUD_LIBRARY_MODELS.map(() => []);
  let s = 0x49a0b12d;
  const rand = (): number => {
    s = (Math.imul(s ^ (s >>> 13), 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = 0; i < 24; i++) {
    const a = rand() * Math.PI * 2, r = 330 + rand() * 380;
    const heightFraction = rand();
    const breadth = 28 + rand() * 28;
    placements[i % CLOUD_LIBRARY_MODELS.length]!.push({
      x: Math.cos(a) * r, z: Math.sin(a) * r, heightFraction,
      scale: 0.8 + (breadth - 28) / 28 * 0.6,
    });
    for (let retiredPuff = 0; retiredPuff < 3; retiredPuff++) {
      rand(); // old puff height
      rand(); // old puff depth
    }
  }
  // Unlike prop colliders, the sky has no procedural fallback: until a GLB
  // finishes loading (or if it fails), its clouds produce zero draw calls.
  if (typeof document !== 'undefined') {
    const loader = new GLTFLoader();
    for (const [index, path] of CLOUD_LIBRARY_MODELS.entries()) {
      void loadLibraryCloudGeometry(path, loader).then(geometry => {
        const entries = placements[index]!;
        const clouds = new THREE.InstancedMesh(geometry, cloudMaterial, entries.length);
        clouds.name = 'puffy-cloud-banks-' + (index + 1);
        clouds.renderOrder = 3; // After rising-sea (order 2).
        clouds.frustumCulled = false;
        const modelHeight = geometry.boundingBox!.getSize(new THREE.Vector3()).y;
        const matrix = new THREE.Matrix4();
        for (const [instance, placement] of entries.entries()) {
          // GLB geometry is anchored at its flat base. Keep the *entire*
          // scaled silhouette within the 300–380 m band.
          const availableHeight = Math.max(0,
            CLOUD_TOP - CLOUD_BOTTOM - modelHeight * placement.scale);
          matrix.compose(
            new THREE.Vector3(placement.x,
              CLOUD_BOTTOM + placement.heightFraction * availableHeight, placement.z),
            new THREE.Quaternion(),
            new THREE.Vector3(placement.scale, placement.scale, placement.scale),
          );
          clouds.setMatrixAt(instance, matrix);
        }
        clouds.instanceMatrix.needsUpdate = true;
        group.add(clouds);
      }).catch(error => {
        console.warn('Could not load authored sky cloud ' + path, error);
      });
    }
  }

  const sun = new THREE.Mesh(new THREE.SphereGeometry(25, 24, 14),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0, fog: false }));
  sun.name = 'visible-sun';
  group.add(sun);

  const starPositions: number[] = [];
  for (let i = 0; i < 320; i++) {
    const a = rand() * Math.PI * 2;
    const y = rand() * 0.91 + 0.08;
    const horizontal = Math.sqrt(1 - y * y);
    starPositions.push(Math.cos(a) * horizontal * 1250, y * 1250,
      Math.sin(a) * horizontal * 1250);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position',
    new THREE.Float32BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xfff5d6, size: 2, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.name = 'night-stars';
  group.add(stars);

  function update(phase: number): { daylight: number; altitude: number; direction: THREE.Vector3 } {
    const angle = phase * Math.PI * 2 - Math.PI / 2;
    const altitude = Math.sin(angle);
    const daylight = THREE.MathUtils.clamp(altitude * 1.8 + 0.3, 0.025, 1);
    // Saturate the painting's late-afternoon palette at phases 0.285–0.29.
    // Noon stays byte-for-byte on the original daytime shader path (golden=0).
    const golden = Math.min(1,
      Math.pow(1 - Math.min(1, Math.abs(altitude) * 1.9), 1.7) * daylight * 4.2);
    // Diagonal warm key, not a nearly vertical noon light that erases facade relief.
    const direction = new THREE.Vector3(Math.cos(angle) * 0.7 + 0.48 * daylight,
      altitude * 0.87, -0.63).normalize();
    uniforms.uDay.value = daylight;
    uniforms.uGolden.value = golden;
    // At golden hour this is 1.65× the original glow; at noon it is 0.29.
    uniforms.uSunGlowStrength.value = 0.29 * (1 + 0.65 * golden);
    uniforms.uSun.value.copy(direction);
    sun.position.copy(direction).multiplyScalar(900);
    sun.visible = altitude > -0.07;
    cloudMaterial.opacity = 0.18 + daylight * 0.76;
    cloudMaterial.color.setHex(golden > 0.32 ? 0xffcdb6 : 0xffffff);
    starMaterial.opacity = (1 - daylight) * 0.94;
    stars.visible = daylight < 0.7;
    return { daylight, altitude, direction };
  }
  update(0.5);
  return { group, update };
}
