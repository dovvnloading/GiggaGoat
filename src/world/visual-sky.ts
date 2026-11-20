import * as THREE from 'three';
import { cloudTexture, type IslandWeather } from './island-weather';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CLOUD_LIBRARY_MODELS, loadLibraryCloudGeometry } from './library-props';

/** Display RGB from the original painted sky. */
export const SKY_HORIZON_COLOR = new THREE.Color(0.76, 0.88, 0.98);

/** The sky shader interpolates display RGB before converting its output to linear. */
export const GOLDEN_HOUR_SKY = {
  horizon: new THREE.Color().setHex(0xffb27a, THREE.LinearSRGBColorSpace),
  mid: new THREE.Color().setHex(0xd98bc4, THREE.LinearSRGBColorSpace),
  zenith: new THREE.Color().setHex(0x6b5fd1, THREE.LinearSRGBColorSpace),
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
  atmosphere: ReturnType<typeof skyUniforms>;
  update(phase: number, weather?: IslandWeather): { daylight: number; altitude: number;
    direction: THREE.Vector3; golden: number; horizon: THREE.Color };
}

const DOME_RADIUS = 1800;

export function skyUniforms() {
  return {
    uCloudField: { value: cloudTexture() },
    uCover: { value: 0 }, uWet: { value: 0 }, uRain: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uStormSky: { value: new THREE.Color() },
    uDay: { value: 1 },
    uGolden: { value: 0 },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uHorizon: { value: SKY_HORIZON_COLOR },
    uSunsetHorizon: { value: GOLDEN_HOUR_SKY.horizon },
    uSunsetMid: { value: GOLDEN_HOUR_SKY.mid },
    uSunsetZenith: { value: GOLDEN_HOUR_SKY.zenith },
    uSunGlowStrength: { value: 0.29 },
  };
}

/** The sea uses the same view ray and painted gradient as the dome at its edge. */
export const skyColorGLSL = /* glsl */ `
uniform float uDay, uGolden, uSunGlowStrength, uCover;
uniform sampler2D uCloudField;
uniform vec2 uWind;
uniform vec3 uStormSky;
uniform vec3 uSun, uHorizon, uSunsetHorizon, uSunsetMid, uSunsetZenith;
vec3 skyColor(vec3 worldPosition) {
  vec3 ray = normalize(worldPosition - cameraPosition);
  float projectedEye = dot(cameraPosition, ray);
  float reach = -projectedEye + sqrt(max(0.0, projectedEye * projectedEye +
    ${DOME_RADIUS}.0 * ${DOME_RADIUS}.0 - dot(cameraPosition, cameraPosition)));
  vec3 dir = (cameraPosition + reach * ray) / ${DOME_RADIUS}.0;
  float horizon = smoothstep(-0.15, 0.90, dir.y);
  vec3 sunny = mix(uHorizon, vec3(0.08, 0.48, 0.94), horizon);
  vec3 sunset = mix(uSunsetHorizon, uSunsetMid, smoothstep(0.0, 0.5, horizon));
  sunset = mix(sunset, uSunsetZenith, smoothstep(0.5, 1.0, horizon));
  vec3 night = mix(vec3(0.18, 0.22, 0.38), vec3(0.018, 0.045, 0.14), horizon);
  vec3 dayColor = mix(sunny, sunset, uGolden);
  float glow = max(dot(dir, normalize(uSun)), 0.0);
  glow *= glow; glow *= glow; glow *= glow; glow *= glow; glow *= glow;
  dayColor += vec3(1.0, 0.72, 0.36) * glow * uSunGlowStrength;
  vec3 base = mix(night, dayColor, max(uDay, uGolden));
  if (uCover <= 0.0) return base;
  float storm = smoothstep(0.46, 0.96, uCover);
  base = mix(base, uStormSky * (1.0 - 0.30 * horizon), storm * 0.83);
  return base;
}`;

const cloudDeckGLSL = /* glsl */ `
vec3 cloudDeck(vec3 dir, vec3 base) {
  if (uCover <= 0.0 || dir.y <= .002) return base;
  float storm = smoothstep(0.46, 0.96, uCover);
  vec2 plane = (cameraPosition.xz + dir.xz * 140.0 / max(0.048, dir.y)) * 0.0018 + uWind;
  float density = texture2D(uCloudField, plane).r;
  float edge = 0.69 - uCover * 0.38;
  float mass = smoothstep(edge - 0.07, edge + 0.08, density);
  float rim = density - texture2D(uCloudField, plane + uSun.xz * 0.023).r;
  vec3 cloud = mix(vec3(0.80, 0.87, 0.96), vec3(1.00, 0.84, 0.67), uGolden);
  cloud = mix(cloud, vec3(0.34, 0.43, 0.56), clamp(storm * 0.66 + 0.32 * mass - rim, 0.0, 1.0));
  cloud *= mix(vec3(0.28, 0.34, 0.49), vec3(1.0), max(uDay, uGolden));
  cloud += max(0.0, rim) * vec3(0.44, 0.37, 0.27) * uDay;
  return mix(base, cloud, mass * smoothstep(0.002, 0.115, dir.y) * 0.94);
}`;

/** Gradient dome with an actual sun disc, cloud banks and softly glowing night stars. */
export function buildSkyVisuals(): SkyVisuals {
  const group = new THREE.Group();
  group.name = 'storybook-sky';
  const uniforms = skyUniforms();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 18),
    new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: [
        'varying vec3 vSkyWorld;',
        'void main() {',
        '  vSkyWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vSkyWorld;',
        skyColorGLSL, cloudDeckGLSL,
        'void main() {',
        '  gl_FragColor = sRGBTransferEOTF(vec4(cloudDeck(normalize(vSkyWorld), skyColor(vSkyWorld)), 1.0));',
        '  #include <colorspace_fragment>',
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
  const moon = new THREE.Mesh(new THREE.SphereGeometry(19, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xe5edff, fog: false }));
  moon.name = 'island-moon';
  group.add(moon);
  dome.material.addEventListener('dispose', () => uniforms.uCloudField.value.dispose());

  const stormCloudColor = new THREE.Color(0x78889d);
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

  // Evaluate the exact dome gradient at dir.y = 0, without the directional sun glow.
  const horizonFactor = THREE.MathUtils.smoothstep(0, -0.15, 0.90);
  const sunnyHorizon = SKY_HORIZON_COLOR.clone()
    .lerp(new THREE.Color(0.08, 0.48, 0.94), horizonFactor);
  const sunsetHorizon = GOLDEN_HOUR_SKY.horizon.clone()
    .lerp(GOLDEN_HOUR_SKY.mid, THREE.MathUtils.smoothstep(horizonFactor, 0, 0.5))
    .lerp(GOLDEN_HOUR_SKY.zenith, THREE.MathUtils.smoothstep(horizonFactor, 0.5, 1));
  const nightHorizon = new THREE.Color(0.18, 0.22, 0.38)
    .lerp(new THREE.Color(0.018, 0.045, 0.14), horizonFactor);
  const dayHorizon = new THREE.Color();
  const horizon = new THREE.Color();

  function update(phase: number, weather?: IslandWeather): { daylight: number; altitude: number;
    direction: THREE.Vector3; golden: number; horizon: THREE.Color } {
    const angle = phase * Math.PI * 2 - Math.PI / 2;
    const altitude = Math.sin(angle);
    const daylight = THREE.MathUtils.clamp(altitude * 1.8 + 0.3, 0.025, 1);
    // Saturate the painting's late-afternoon palette at phases 0.285–0.29.
    // Noon stays byte-for-byte on the original daytime shader path (golden=0).
    const golden = Math.min(1,
      Math.pow(1 - Math.min(1, Math.abs(altitude) * 1.9), 1.7) * daylight * 4.2);
    dayHorizon.copy(sunnyHorizon).lerp(sunsetHorizon, golden);
    horizon.copy(nightHorizon).lerp(dayHorizon, Math.max(daylight, golden))
      .convertSRGBToLinear();
    // Diagonal warm key, not a nearly vertical noon light that erases facade relief.
    const direction = new THREE.Vector3(Math.cos(angle) * 0.7 + 0.48 * daylight,
      altitude * 0.87, -0.63).normalize();
    const storm = THREE.MathUtils.smoothstep(weather?.cloud ?? 0, .46, .96);
    uniforms.uCover.value = weather?.cloud ?? 0;
    uniforms.uWind.value.set((weather?.time ?? 0) * .00052, (weather?.time ?? 0) * -.00019);
    uniforms.uRain.value = weather?.rain ?? 0;
    uniforms.uWet.value = weather?.wet ?? 0;
    uniforms.uStormSky.value.setRGB(.50, .59, .70).multiplyScalar(.38 + .62 * daylight);
    if (storm > 0) {
      horizon.convertLinearToSRGB().lerp(uniforms.uStormSky.value, storm * .83).convertSRGBToLinear();
    }
    moon.position.copy(direction).multiplyScalar(-940);
    moon.visible = altitude < -.04;
    uniforms.uDay.value = daylight;
    uniforms.uGolden.value = golden;
    // At golden hour this is 1.65× the original glow; at noon it is 0.29.
    uniforms.uSunGlowStrength.value = 0.29 * (1 + 0.65 * golden);
    uniforms.uSun.value.copy(direction);
    sun.position.copy(direction).multiplyScalar(900);
    sun.visible = altitude > -0.07;
    cloudMaterial.opacity = 0.18 + daylight * 0.76;
    cloudMaterial.color.setHex(golden > 0.32 ? 0xffcdb6 : 0xffffff);
    if (weather) {
      cloudMaterial.color.lerp(stormCloudColor, storm * .74);
      cloudMaterial.emissiveIntensity = .09 + .21 * daylight * (1 - storm);
    }
    starMaterial.opacity = (1 - daylight) * 0.94 * (1 - .94 * storm);
    stars.visible = daylight < 0.7;
    return { daylight, altitude, direction, golden, horizon };
  }
  update(0.5);
  return { group, atmosphere: uniforms, update };
}
