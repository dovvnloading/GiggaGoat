import * as THREE from 'three';

/** Daytime horizon RGB in the sky shader's linear working space. */
export const SKY_HORIZON_COLOR = new THREE.Color(0.76, 0.88, 0.98);
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
        'uniform float uDay, uGolden; uniform vec3 uSun, uHorizon;',
        'varying vec3 vDirection;',
        'void main() {',
        '  vec3 dir = normalize(vDirection);',
        '  float horizon = smoothstep(-0.15, 0.90, dir.y);',
        '  vec3 sunny = mix(uHorizon, vec3(0.08, 0.48, 0.94), horizon);',
        '  vec3 sunset = mix(vec3(1.0, 0.60, 0.47), vec3(0.56, 0.45, 0.73), horizon);',
        '  vec3 night = mix(vec3(0.18, 0.22, 0.38), vec3(0.018, 0.045, 0.14), horizon);',
        '  vec3 dayColor = mix(sunny, sunset, uGolden);',
        '  float glow = max(dot(dir, normalize(uSun)), 0.0);',
        '  glow *= glow; glow *= glow; glow *= glow; glow *= glow; glow *= glow;',
        '  dayColor += vec3(1.0, 0.72, 0.36) * glow * 0.29;',
        '  gl_FragColor = vec4(mix(night, dayColor, uDay), 1.0);',
        '}',
      ].join('\n'),
    }));
  dome.name = 'gradient-sky';
  dome.frustumCulled = false;
  group.add(dome);

  // One cloud draw call; deterministic ellipsoid clusters rather than flat billboards.
  const cloudMaterial = new THREE.MeshToonMaterial({
    color: 0xffffff, gradientMap: CLOUD_RAMP,
    emissive: 0xffffff, emissiveIntensity: 0.3,
    transparent: true, opacity: 0.94, depthWrite: false, fog: true,
  });
  const cloudCount = 72;
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2),
    cloudMaterial, cloudCount);
  clouds.name = 'puffy-cloud-banks';
  clouds.renderOrder = 3; // Transparent clouds draw after rising-sea (order 2).
  const matrix = new THREE.Matrix4();
  let s = 0x49a0b12d;
  const rand = (): number => {
    s = (Math.imul(s ^ (s >>> 13), 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = 0; i < cloudCount / 3; i++) {
    const a = rand() * Math.PI * 2, r = 330 + rand() * 380;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = 150 + rand() * 100;
    const breadth = 28 + rand() * 28;
    for (let j = 0; j < 3; j++) {
      matrix.compose(
        new THREE.Vector3(x + (j - 1) * breadth * 0.63 * 1.25, y + (j === 1 ? 7 : 0),
          z + (j % 2 ? 9 : -9) * 1.25),
        new THREE.Quaternion(),
        new THREE.Vector3(breadth * (j === 1 ? 1.35 : 1), (20 + rand() * 10) * 0.62,
          24 + rand() * 13),
      );
      clouds.setMatrixAt(i * 3 + j, matrix);
    }
  }
  clouds.instanceMatrix.needsUpdate = true;
  clouds.frustumCulled = false;
  group.add(clouds);

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
    const golden = Math.pow(1 - Math.min(1, Math.abs(altitude) * 1.9), 1.7) * daylight;
    // Diagonal warm key, not a nearly vertical noon light that erases facade relief.
    const direction = new THREE.Vector3(Math.cos(angle) * 0.7 + 0.48 * daylight,
      altitude * 0.87, -0.63).normalize();
    uniforms.uDay.value = daylight;
    uniforms.uGolden.value = golden;
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
