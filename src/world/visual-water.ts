import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData, PropDescriptor, RiverPoint, Vec2, Vec3 } from './types';
import { gridIndex, gridSample, segmentProjection } from './terrain';
import { skyColorGLSL, skyUniforms } from './visual-sky';
import { damHeadwaterSurface, getDamHeadwater } from './dam-landscape';
import { findBookmark } from './viewer/bookmarks';

/**
 * Retain the former 96×96 sea grid around the island, then fan its square
 * perimeter into three sparse circular rings. Only the distant edge changes:
 * shoreline waves keep their original vertex spacing and the last ring has
 * no square silhouette from elevated cameras.
 */
function circularSeaGeometry(islandSize: number): THREE.BufferGeometry {
  const divisions = 96;
  const half = islandSize * 2.15 / 2;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const add = (x: number, y: number): number => {
    const index = positions.length / 3;
    positions.push(x, y, 0); // local XY; the sea rotates onto world XZ
    uvs.push(x / (2 * half) + 0.5, y / (2 * half) + 0.5);
    return index;
  };
  for (let j = 0; j <= divisions; j++) {
    for (let i = 0; i <= divisions; i++) {
      add(-half + i * 2 * half / divisions, -half + j * 2 * half / divisions);
    }
  }
  const stride = divisions + 1;
  for (let j = 0; j < divisions; j++) {
    for (let i = 0; i < divisions; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride + 1, d = a + stride;
      indices.push(a, b, c, a, c, d);
    }
  }

  // Traverse the square counter-clockwise; each ring reuses the same angles
  // so the stitched outer triangles have no gaps or T-junctions.
  const boundary: number[] = [];
  for (let i = 0; i < divisions; i++) boundary.push(i);
  for (let j = 0; j < divisions; j++) boundary.push(j * stride + divisions);
  for (let i = divisions; i > 0; i--) boundary.push(divisions * stride + i);
  for (let j = divisions; j > 0; j--) boundary.push(j * stride);
  let inner = boundary;
  for (const radius of [1.7, 2.7, 4].map(factor => factor * islandSize)) {
    const outer = boundary.map(index => {
      const x = positions[index * 3]!, y = positions[index * 3 + 1]!;
      const scale = radius / Math.hypot(x, y);
      return add(x * scale, y * scale);
    });
    for (let i = 0; i < inner.length; i++) {
      const next = (i + 1) % inner.length;
      indices.push(inner[i]!, outer[i]!, outer[next]!,
        inner[i]!, outer[next]!, inner[next]!);
    }
    inner = outer;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Extend the terrain's square border down to a deep, circular seabed.
 * Three rings share 128 angular samples: the first ray/square intersection
 * coincides with the terrain's +/-size/2 grid boundary in world XZ.
 */
function seabedSkirtGeometry(island: IslandData): THREE.BufferGeometry {
  const sides = 128;
  const scale = island.size / 600;
  const half = island.size / 2;
  const positions: number[] = [], colours: number[] = [], indices: number[] = [];
  const wetSand = new THREE.Color(0xd9c79a);
  const shallows = new THREE.Color(0x5fa9a8);
  const deep = new THREE.Color(0x1d5f73);
  for (let i = 0; i < sides; i++) {
    const theta = i * Math.PI * 2 / sides;
    const x = Math.cos(theta), z = Math.sin(theta);
    const distance = half / Math.max(Math.abs(x), Math.abs(z));
    for (const [radius, y, colour] of [
      [distance, gridSample(island, x * distance, z * distance) - 0.05 * scale, wetSand],
      [distance * 1.35, island.seaLevel - 10 * scale, shallows],
      [island.size * 4, island.seaLevel - 40 * scale, deep],
    ] as const) {
      positions.push(x * radius, y, z * radius);
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    for (let ring = 0; ring < 2; ring++) {
      const a = i * 3 + ring, b = next * 3 + ring;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

interface AnimatedUniforms {
  uTime: { value: number };
  uLevel: { value: number };
}
type LightUniform = { value: THREE.Vector3 };
export interface WaterVisuals {
  sea: THREE.Mesh;
  inland: THREE.Group;
  mountain: THREE.Group;
  light: THREE.Vector3;
  replacedCascadeIds: ReadonlySet<string>;
  update(time: number, tide: number): void;
  setLighting(daylight: number, golden: number): void;
}

/** Float height atlas lets the sea shade by actual terrain depth, including rising tide. */
function seaMaterial(island: IslandData, uLight: LightUniform,
  atmosphere: ReturnType<typeof skyUniforms>): { material: THREE.ShaderMaterial;
  uniforms: AnimatedUniforms } {
  const atlas = new THREE.DataTexture(
    island.heights.slice(), island.resolution, island.resolution,
    THREE.RedFormat, THREE.FloatType,
  );
  atlas.magFilter = THREE.LinearFilter;
  atlas.minFilter = THREE.LinearFilter;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.needsUpdate = true;
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: island.seaLevel },
    uLight,
  };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      // ShaderMaterial does not inject fog uniforms automatically. Include the
      // standard set so refreshFogUniforms works in real WebGL scenes.
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...uniforms,
      ...atmosphere,
      uTerrain: { value: atlas },
      uSize: { value: island.size },
      uSeaDatum: { value: island.seaLevel },
      uShallow: { value: new THREE.Color(0x48c9c9) },
      uDeep: { value: new THREE.Color(0x2a8fc0) },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    vertexShader: [
      'uniform float uTime;',
      '#include <fog_pars_vertex>',
      'varying vec3 vWorld;',
      'void main() {',
      '  vec3 p = position;',
      '  p.z -= 0.15 * sin(position.x * 0.10 + uTime * 1.7)',
      '        + 0.11 * cos(position.y * 0.12 - uTime * 1.3);',
      '  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;',
      '  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * mvPosition;',
      '  #include <fog_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uTerrain;',
      'uniform float uSize, uLevel, uSeaDatum, uTime;',
      'uniform vec3 uShallow, uDeep, uLight;',
      'varying vec3 vWorld;',
      '#include <fog_pars_fragment>',
      skyColorGLSL,
      'float filteredRipple(float phase) {',
      '  float detail = 1.0 - smoothstep(0.45, 1.65, fwidth(phase));',
      '  return sin(phase) * detail;',
      '}',
      'void main() {',
      '  vec2 seaXZ = vWorld.xz;',
      '  vec2 mapXZ = seaXZ / uSize;',
      '  vec2 atlasUV = clamp(mapXZ + 0.5, 0.0, 1.0);',
      '  float ground = texture2D(uTerrain, atlasUV).r;',
      '  float depth = uLevel - ground;',
      '  float scale = uSize / 600.0;',
      '  float flood = smoothstep(8.0, 30.0, (uLevel - uSeaDatum) / scale);',
      '  // Taper to deep water outside the height atlas to avoid extending its edge.',
      '  float atlasInterior = 1.0 - smoothstep(0.48, 0.5, max(abs(mapXZ.x), abs(mapXZ.y)));',
      '  float shelf = mix(36.0, 11.0 * scale, flood);',
      '  float deepMix = mix(1.0, smoothstep(0.0, shelf, depth), atlasInterior);',
      '  vec3 shallows = mix(uShallow, uDeep, flood * 0.58);',
      '  vec3 color = mix(shallows, uDeep, deepMix);',
      '  // Crossed, gently warped ripples keep their footprint filtered at grazing angles.',
      '  float swell = filteredRipple(dot(seaXZ, vec2(0.082, 0.117)) + uTime * 0.72);',
      '  float crossWave = filteredRipple(dot(seaXZ, vec2(-0.172, 0.067)) - uTime * 0.95 + 1.5 * swell);',
      '  float ripples = 0.56 * swell + 0.44 * crossWave;',
      '  color += vec3(0.011, 0.025, 0.030) * (0.4 + 0.55 * ripples) * (1.0 - deepMix);',
      '  color += vec3(0.022, 0.040, 0.048) * ripples * flood * atlasInterior;',
      '  // The swash follows the tide contour. Its broken highlights stay soft at distance.',
      '  float coast = smoothstep(-0.07, 0.18, depth) * (1.0 - smoothstep(0.65, 2.1, depth));',
      '  coast *= atlasInterior * (1.0 - smoothstep(0.24, 1.25, fwidth(depth)));',
      '  float foam = mix(0.12, 0.40, smoothstep(-0.38, 0.7, ripples));',
      '  foam = mix(foam, mix(0.025, 0.27, smoothstep(0.02, 0.7, ripples)), flood);',
      '  foam *= mix(0.4, 1.0, smoothstep(0.16, 1.0, uLight.x));',
      '  color = mix(color, vec3(0.88, 0.96, 0.92), coast * foam);',
      '  float cover = mix(1.0, smoothstep(-0.24, 0.48, depth), atlasInterior);',
      '  // Reach exact dome color before the sea edge or the game camera far plane.',
      '  float haze = smoothstep(2.0, 3.25, length(mapXZ));',
      '  #ifdef USE_FOG',
      '    haze = max(haze, smoothstep(1000.0, 1700.0, vFogDepth));',
      '    #ifdef FOG_EXP2',
      '      float fogDepth = fogDensity * vFogDepth;',
      '      haze = max(haze, 1.0 - exp(-fogDepth * fogDepth));',
      '    #else',
      '      haze = max(haze, smoothstep(fogNear, fogFar, vFogDepth));',
      '    #endif',
      '  #endif',
      '  vec3 litColor = color * uLight;',
      '  if (haze > 0.0) litColor = mix(litColor, skyColor(vWorld), haze);',
      '  // Once below the clear shoreline, contrast falls with travel through water.',
      '  vec3 eye = cameraPosition - vWorld;',
      '  float viewAngle = abs(eye.y) / max(length(eye), 0.0001);',
      '  float submergedDepth = mix(36.0, depth / scale, atlasInterior);',
      '  float pathLength = max(0.0, submergedDepth - 0.7) / max(0.30, viewAngle);',
      '  float transmission = 0.12 * exp(-0.14 * pathLength);',
      '  float alpha = cover * (1.0 - transmission * (1.0 - haze * (1.0 - atlasInterior)));',
      '  gl_FragColor = sRGBTransferEOTF(vec4(litColor, alpha));',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  // Release the height atlas with the shader, not by allocating one per frame.
  const originalDispose = material.dispose.bind(material);
  material.dispose = (): void => { atlas.dispose(); originalDispose(); };
  return { material, uniforms };
}
function inlandMaterial(uLight: LightUniform): { material: THREE.ShaderMaterial; time: { value: number } } {
  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uLight },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: [
      'varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  vUv = uv;',
      '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime; uniform vec3 uLight; varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  float stream = sin(vUv.y * 45.0 - uTime * 5.0 +',
      '    sin(vWorld.x * 0.16) * 2.0);',
      '  float edge = smoothstep(0.72, 0.97, abs(vUv.x * 2.0 - 1.0));',
      '  float streak = smoothstep(0.62, 0.94, stream);',
      '  vec3 blue = mix(vec3(0.09, 0.57, 0.72), vec3(0.29, 0.79, 0.84),',
      '    0.48 + 0.2 * stream);',
      '  vec3 col = mix(blue, vec3(0.92, 0.98, 0.92),',
      '    edge * (0.46 + streak * 0.42) + streak * 0.12);',
      '  gl_FragColor = vec4(col * uLight, 0.91);',
      '}',
    ].join('\n'),
  });
  return { material, time };
}
/**
 * Interpolate the authored centreline at <=2 scaled metres per sample. The
 * river data (including its gameplay levels) is unchanged; only the visible
 * mesh uses these extra stations.
 */
function resampleRiver(points: readonly RiverPoint[], spacing: number): RiverPoint[] {
  if (!points.length) return [];
  const stations = [{ ...points[0]! }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(run / spacing));
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      stations.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        width: a.width + (b.width - a.width) * t,
        level: a.level + (b.level - a.level) * t,
      });
    }
  }
  return stations;
}

const FOREST_OUTFLOW_START = 11;
export const PINES_GLADE_CASCADE = 'whispering-pines-glade-cascade';

function riverMaterial(stream: THREE.ShaderMaterial, tide: { value: number }): THREE.ShaderMaterial {
  const material = stream.clone();
  // The reservoir retains its own shader. All river reaches share this flow
  // program and the existing lighting/time uniforms in one merged draw.
  material.uniforms = { ...stream.uniforms, uStreamTide: tide };
  material.vertexShader = stream.vertexShader
    .replace('varying vec2 vUv;', 'attribute vec3 streamStyle; varying vec3 vStreamStyle; varying vec2 vUv;')
    .replace('vUv = uv;', 'vUv = uv; vStreamStyle = streamStyle;');
  material.fragmentShader = stream.fragmentShader.replace('void main() {', `
varying vec3 vStreamStyle;
uniform float uStreamTide;
float forestRipple(float phase) {
  return sin(phase) * (1.0 - smoothstep(0.55, 1.9, fwidth(phase)));
}
void main() {
  if (vStreamStyle.x > 0.5) {
    float falling = vStreamStyle.z;
    float across = abs(vUv.x * 2.0 - 1.0);
    float bend = vUv.x + 0.10 * sin(vUv.y * 1.5 + 0.45 * uTime);
    float current = forestRipple(1.7 * vUv.y + 13.0 * bend - uTime * 2.05);
    float crossFlow = forestRipple(2.6 * vUv.y - 17.0 * bend + 0.7 * current - uTime * 1.33);
    float veins = forestRipple(25.0 * bend + 0.83 * vUv.y - uTime * 0.55);
    float broken = smoothstep(0.36, 0.84, 0.55 * current + 0.45 * crossFlow);
    float bank = smoothstep(0.58, 0.98, across);
    vec3 shaded = mix(vec3(0.055, 0.30, 0.36), vec3(0.11, 0.46, 0.50),
      0.46 + 0.23 * current + 0.14 * crossFlow);
    shaded = mix(shaded, vec3(0.14, 0.34, 0.33), 0.74 * bank);
    shaded = mix(shaded, vec3(0.16, 0.55, 0.60), falling * (0.52 + 0.20 * veins));
    float foam = 0.34 * broken * vStreamStyle.y * (1.0 - bank);
    foam += falling * (0.22 * smoothstep(0.2, 0.86, veins) +
      0.32 * broken * smoothstep(0.7, 1.0, vUv.y));
    vec3 col = mix(shaded, vec3(0.70, 0.87, 0.81), foam);
    float cover = 1.0 - smoothstep(0.77, 1.0, across);
    if (vStreamStyle.x > 2.5) cover *= 1.0 - smoothstep(-0.04, 0.23, uStreamTide - vWorld.y);
    gl_FragColor = vec4(col * uLight, 0.94 * cover);
    return;
  }`);
  return material;
}

function riverRibbonSections(points: readonly RiverPoint[], scale: number) {
  const stations = resampleRiver(points, 2 * scale);
  return stations.map((center, i) => {
    const a = stations[Math.max(0, i - 1)]!, b = stations[Math.min(stations.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length, nz = dx / length;
    return {
      center,
      left: { x: center.x - nx * center.width / 2, z: center.z - nz * center.width / 2 },
      right: { x: center.x + nx * center.width / 2, z: center.z + nz * center.width / 2 },
    };
  });
}

/** Clearance from the XZ footprint built by the forest river mesh. */
export function makeForestOutflowClearance(island: IslandData): (x: number, z: number, radius: number) => boolean {
  const sections = riverRibbonSections(island.river.slice(FOREST_OUTFLOW_START), island.size / 600);
  const triangles: THREE.Triangle[] = [];
  const vertex = (point: Vec2) => new THREE.Vector3(point.x, 0, point.z);
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1]!, b = sections[i]!;
    const leftA = vertex(a.left), rightA = vertex(a.right);
    const leftB = vertex(b.left), rightB = vertex(b.right);
    triangles.push(new THREE.Triangle(leftA, rightA, leftB), new THREE.Triangle(rightA, rightB, leftB));
  }
  const probe = new THREE.Vector3(), closest = new THREE.Vector3();
  return (x, z, radius) => {
    probe.set(x, 0, z);
    return triangles.every(triangle =>
      triangle.closestPointToPoint(probe, closest).distanceToSquared(probe) >= radius ** 2);
  };
}

function riverMesh(points: readonly RiverPoint[], material: THREE.Material,
  island: IslandData, damCenter?: { x: number; z: number }, forest = false): THREE.Mesh {
  const scale = island.size / 600;
  const sections = riverRibbonSections(points, scale);
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [], style: number[] = [];
  let accumulated = 0;
  for (let i = 0; i < sections.length; i++) {
    const { center: p, left, right } = sections[i]!;
    if (i) {
      const prev = sections[i - 1]!.center;
      accumulated += Math.hypot(p.x - prev.x, p.z - prev.z);
    }
    if (forest) {
      const previous = sections[Math.max(0, i - 1)]!.center;
      const next = sections[Math.min(sections.length - 1, i + 1)]!.center;
      const centreY = gridSample(island, p.x, p.z);
      const run = Math.max(0.001, Math.hypot(next.x - previous.x, next.z - previous.z));
      const drop = gridSample(island, previous.x, previous.z) - gridSample(island, next.x, next.z);
      const rapids = THREE.MathUtils.smoothstep(drop / run, 0.075, 0.33);
      const reach = accumulated / scale;
      for (const [edge, phase] of [[left, 0.2], [right, 2.25]] as const) {
        const bend = 0.83 + 0.09 * Math.sin(reach * 0.19 + phase) +
          0.06 * Math.sin(reach * 0.071 - phase);
        const x = THREE.MathUtils.lerp(p.x, edge.x, bend);
        const z = THREE.MathUtils.lerp(p.z, edge.z, bend);
        const ground = gridSample(island, x, z);
        const y = Math.min(ground, THREE.MathUtils.lerp(centreY, ground, 0.46)) + 0.19 * scale;
        vertices.push(x, y, z);
      }
      style.push(1, rapids, 0, 1, rapids, 0);
    } else {
      // The original mountain ribbon keeps its independently draped banks.
      vertices.push(left.x, gridSample(island, left.x, left.z) + 0.15 * scale, left.z,
        right.x, gridSample(island, right.x, right.z) + 0.15 * scale, right.z);
      style.push(0, 0, 0, 0, 0, 0);
    }
    uvs.push(0, accumulated / 10, 1, accumulated / 10);
    if (i > 0) {
      const prev = sections[i - 1]!.center;
      const horizontalRun = Math.hypot(p.x - prev.x, p.z - prev.z);
      const nearDam = damCenter !== undefined && Math.hypot(
        (prev.x + p.x) / 2 - damCenter.x,
        (prev.z + p.z) / 2 - damCenter.z,
      ) <= 70;
      const before = (vertices[(i * 2 - 2) * 3 + 1]! +
        vertices[(i * 2 - 1) * 3 + 1]!) * 0.5;
      const after = (vertices[(i * 2) * 3 + 1]! +
        vertices[(i * 2 + 1) * 3 + 1]!) * 0.5;
      // The Dam owns the steep plunge-pool slope. Keep every draped vertex
      // and UV, but omit steep quads beside the bespoke spillway.
      if (!nearDam || before - after <= 0.25 * horizontalRun) {
        const k = i * 2;
        indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('streamStyle', new THREE.Float32BufferAttribute(style, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rippling-river';
  return mesh;
}

/** Fit a single low, wet rock step inside the existing forest falls site. */
function forestCascade(island: IslandData, prop: PropDescriptor, outflow: THREE.Mesh) {
  const scale = island.size / 600;
  const pool = cascadePoolCentre(prop, scale);
  const yaw = prop.transform.rotationY;
  const forward = new THREE.Vector2(Math.sin(yaw), Math.cos(yaw));
  const side = new THREE.Vector2(forward.y, -forward.x);
  const poolProbe = new THREE.Raycaster(
    new THREE.Vector3(pool.x, pool.y + 6 * scale, pool.z),
    new THREE.Vector3(0, -1, 0), 0, 12 * scale);
  const poolY = poolProbe.intersectObject(outflow)[0]?.point.y ?? pool.y;
  const at = (t: number, across: number): Vec3 => {
    const crest = 0.34 * scale * Math.sin(across / prop.size.x * 4.4);
    const run = (t - 1) * (prop.size.z * 0.58 + crest);
    const centre = Math.sin(t * Math.PI) * prop.size.x * 0.065;
    return {
      x: pool.x + forward.x * run + side.x * (across + centre),
      y: poolY + scale * (0.025 + 2.05 * (1 - THREE.MathUtils.smoothstep(t, 0.08, 0.89))),
      z: pool.z + forward.y * run + side.y * (across + centre),
    };
  };
  const wet: number[] = [], wetUv: number[] = [], wetStyle: number[] = [], wetIndex: number[] = [];
  const dry: number[] = [], dryIndex: number[] = [];
  const rows = 14, waterColumns = 4, rockColumns = 4;
  function stitch(indices: number[], row: number, stride: number): void {
    if (!row) return;
    for (let column = 0; column < stride - 1; column++) {
      const a = (row - 1) * stride + column, b = a + 1, c = a + stride, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const wetHalf = prop.size.x * (0.25 + 0.06 * t + 0.028 * Math.sin(5 * t));
    for (let column = 0; column <= waterColumns; column++) {
      const u = column / waterColumns;
      const point = at(t, (u * 2 - 1) * wetHalf);
      wet.push(point.x, point.y + Math.sin(u * Math.PI) * 0.035 * scale, point.z);
      wetUv.push(u, t);
      wetStyle.push(2, 0.48 + 0.52 * t, 1);
    }
    for (let column = 0; column <= rockColumns; column++) {
      const u = (column / rockColumns) * 2 - 1;
      const lower = Math.abs(u) === 1;
      const width = prop.size.x * (0.41 + 0.045 * Math.sin(17 * t + u));
      const point = at(t, u * width);
      const ground = gridSample(island, point.x, point.z);
      const height = lower ? Math.min(point.y - 0.35 * scale, ground - 0.25 * scale) :
        point.y - (u === 0 ? 0.17 : 0.05 + 0.15 * Math.sin(t * 15 + u)) * scale;
      dry.push(point.x, height, point.z);
    }
    stitch(wetIndex, row, waterColumns + 1);
    stitch(dryIndex, row, rockColumns + 1);
  }
  // Ground the back face as well as both sides, so the uphill view reads
  // a single stone lip instead of an open floating sheet.
  const rear = dry.length / 3;
  for (let i = 0; i <= rockColumns; i++) {
    const x = dry[i * 3]!, y = dry[i * 3 + 1]!, z = dry[i * 3 + 2]!;
    dry.push(x, Math.min(y, gridSample(island, x, z) - 0.25 * scale), z);
    if (i > 0) dryIndex.push(i - 1, rear + i - 1, i, i, rear + i - 1, rear + i);
  }
  const water = new THREE.BufferGeometry();
  water.setAttribute('position', new THREE.Float32BufferAttribute(wet, 3));
  water.setAttribute('uv', new THREE.Float32BufferAttribute(wetUv, 2));
  water.setAttribute('streamStyle', new THREE.Float32BufferAttribute(wetStyle, 3));
  water.setIndex(wetIndex);
  water.computeVertexNormals();
  const rock = new THREE.BufferGeometry();
  rock.setAttribute('position', new THREE.Float32BufferAttribute(dry, 3));
  rock.setIndex(dryIndex);
  rock.computeVertexNormals();
  const bed = new THREE.Mesh(rock,
    new THREE.MeshLambertMaterial({ color: 0x637778, side: THREE.DoubleSide, flatShading: true }));
  bed.name = 'whispering-pines-rock-step';
  bed.receiveShadow = true;
  return { water, bed };
}

/** Interpolate the same native triangles that the near-view terrain draws. */
function cliffHeight(island: IslandData, x: number, z: number): number {
  const { resolution: n, size, heights } = island;
  const gx = THREE.MathUtils.clamp((x / size + 0.5) * (n - 1), 0, n - 1);
  const gz = THREE.MathUtils.clamp((z / size + 0.5) * (n - 1), 0, n - 1);
  const i = Math.min(Math.floor(gx), n - 2), j = Math.min(Math.floor(gz), n - 2);
  const u = gx - i, v = gz - j;
  const a = heights[gridIndex(n, i, j)]!, b = heights[gridIndex(n, i + 1, j)]!;
  const c = heights[gridIndex(n, i, j + 1)]!, d = heights[gridIndex(n, i + 1, j + 1)]!;
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

/** One connected sheet across the cliff face and the receiving terrace basin. */
function terraceCascade(island: IslandData, prop: PropDescriptor): THREE.BufferGeometry | undefined {
  const scale = island.size / 600;
  const start = cascadePoolCentre(prop, scale);
  const yaw = prop.transform.rotationY;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const ground = (x: number, z: number) => cliffHeight(island, x, z);
  const place = (run: number, across: number): Vec2 => ({
    x: start.x + (sin * run + cos * across) * scale,
    z: start.z + (cos * run - sin * across) * scale,
  });
  const trails = island.roads.filter(road => road.type === 'trail')
    .flatMap(road => road.points.slice(1).map((b, i) =>
      ({ a: road.points[i]!, b, radius: road.width / 2 })));
  const protectedProps = island.props.filter(item => item.collidable &&
    item.poiId === 'mt-gigga' && ['ledge', 'ramp', 'platform', 'bridge'].includes(item.kind));
  function clearance(point: Vec2): number {
    let space = Infinity;
    for (const { a, b, radius } of trails) {
      space = Math.min(space, segmentProjection(point, a, b).distance - radius);
    }
    for (const item of protectedProps) {
      const p = item.transform.position;
      const x = point.x - p.x, z = point.z - p.z;
      const angle = item.transform.rotationY, c = Math.cos(angle), s = Math.sin(angle);
      const dx = Math.max(0, Math.abs(x * c - z * s) - item.size.x / 2);
      const dz = Math.max(0, Math.abs(x * s + z * c) - item.size.z / 2);
      space = Math.min(space, Math.hypot(dx, dz));
    }
    return space / scale;
  }
  const lip = place(-7.35, 0);
  const basin = place(2.32, 1.10);
  const basinY = ground(basin.x, basin.z) + 0.26 * scale;
  if (ground(lip.x, lip.z) - basinY < 3 * scale) return undefined;

  const vertices: number[] = [], uv: number[] = [], style: number[] = [], indices: number[] = [];
  const rows = 24, columns = 4;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const run = THREE.MathUtils.lerp(-7.35, 3.12, t);
    const bias = 1.10 * THREE.MathUtils.smoothstep(t, 0.57, 0.93) + 0.21 * Math.sin(t * 8);
    const centre = place(run, bias);
    const pooling = THREE.MathUtils.smoothstep(run, 1.18, 2.08);
    const shaft = THREE.MathUtils.smoothstep(t, 0, 0.15);
    const narrowing = 1 - THREE.MathUtils.smoothstep(t, 0.89, 1);
    const shape = 0.13 + narrowing * (0.96 * shaft + 0.84 * pooling + 0.12 * Math.sin(t * 14));
    const width = Math.min(shape, clearance(centre) - 0.24);
    if (width <= 0.08) return undefined;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const across = (u * 2 - 1);
      const point = place(run + 0.22 * across * Math.sin(t * 11) * narrowing, bias + across * width);
      if (clearance(point) < 0.19) return undefined;
      const height = ground(point.x, point.z);
      const offset = (0.10 + 0.28 * Math.sin(u * Math.PI)) * scale;
      vertices.push(point.x, THREE.MathUtils.lerp(height + offset, basinY, pooling), point.z);
      uv.push(u, t);
      style.push(3, THREE.MathUtils.smoothstep(run, -0.3, 1.1) * narrowing, 1 - pooling);
      if (row > 0 && column > 0) {
        const d = row * (columns + 1) + column, c = d - 1;
        const b = d - columns - 1, a = b - 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('streamStyle', new THREE.Float32BufferAttribute(style, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** One cliff curtain only where a 4 m stretch of real riverbed drops 3 m. */
function riverCliffDrop(island: IslandData, a: RiverPoint, b: RiverPoint,
  damCenter?: { x: number; z: number }):
  { top: THREE.Vector3; bottom: THREE.Vector3; width: number } | undefined {
  const scale = island.size / 600;
  const run = Math.hypot(b.x - a.x, b.z - a.z);
  const window = 4 * scale;
  if (run < window) return undefined;
  // Evaluate every possible 4 m run at <=2 m intervals. Authored water
  // levels cannot create a fall on a flat terrace.
  const checks = Math.max(1, Math.ceil((run - window) / (2 * scale)));
  let bestDrop = -Infinity;
  let best: { top: THREE.Vector3; bottom: THREE.Vector3; width: number } | undefined;
  for (let i = 0; i <= checks; i++) {
    const t = (run - window) * i / checks / run;
    const u = t + window / run;
    const x0 = a.x + (b.x - a.x) * t, z0 = a.z + (b.z - a.z) * t;
    if (damCenter && Math.hypot(x0 - damCenter.x, z0 - damCenter.z) <= 70) continue;
    const x1 = a.x + (b.x - a.x) * u, z1 = a.z + (b.z - a.z) * u;
    const upper = gridSample(island, x0, z0);
    const lower = gridSample(island, x1, z1);
    const drop = upper - lower;
    if (drop >= 3 * scale && drop > bestDrop) {
      bestDrop = drop;
      best = {
        top: new THREE.Vector3(x0, upper + 0.26 * scale, z0),
        bottom: new THREE.Vector3(x1, lower + 0.18 * scale, z1),
        width: (a.width + (b.width - a.width) * t) * 0.4,
      };
    }
  }
  return best;
}
/** Rendering-only identity for the exact river, terrace and backdrop fall sites. */
export interface WaterfallSite {
  id: string;
  top: THREE.Vector3;
  bottom: THREE.Vector3;
  width: number;
}

/** Native dimensions in metres of the two painted models (no rotation). */
export const CASCADE_NATIVE_SIZE = {
  cascade: { x: 6.6, y: 10.5, z: 9.2 },
  'cascade-tall': { x: 6.6, y: 14, z: 4 },
} as const;

type CascadePlacement = Pick<PropDescriptor, 'size' | 'transform'>;

/** The +Z pool centre is shared by placement, trail checks and foam. */
export function cascadePoolCentre(prop: CascadePlacement, scale: number): Vec3 {
  const distance = prop.size.z * 0.25;
  const yaw = prop.transform.rotationY;
  return {
    x: prop.transform.position.x + Math.sin(yaw) * distance,
    y: prop.transform.position.y - prop.size.y / 2 + 0.3 * scale,
    z: prop.transform.position.z + Math.cos(yaw) * distance,
  };
}

/** Six model-local lip-to-pool clearance samples transformed to world space. */
export function cascadeWaterLine(prop: CascadePlacement, scale: number): Vec3[] {
  const { size, transform } = prop;
  const lipY = 0.92 * size.y, poolY = 0.3 * scale;
  const lipZ = -size.z / 2 + 0.12 * size.z;
  const poolZ = size.z / 2 - 0.25 * size.z;
  const sin = Math.sin(transform.rotationY), cos = Math.cos(transform.rotationY);
  return [0.1, 0.26, 0.42, 0.58, 0.74, 0.9].map(t => {
    const localZ = lipZ + (poolZ - lipZ) * t;
    return {
      x: transform.position.x + sin * localZ,
      y: transform.position.y - size.y / 2 + lipY + (poolY - lipY) * t,
      z: transform.position.z + cos * localZ,
    };
  });
}

/** The GLB supplies the water silhouette; foam follows the placed pool. */
function makeWaterfallFoam(group: THREE.Group, prop: PropDescriptor, scale: number): void {
  const id = prop.id.startsWith('waterfall-cascade-')
    ? prop.id.slice('waterfall-cascade-'.length) : prop.id;
  const centre = cascadePoolCentre(prop, scale);
  const pool = new THREE.Vector3(centre.x, centre.y, centre.z);
  const yaw = prop.transform.rotationY;
  const sideways = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const width = prop.size.x;
  const marker = new THREE.Group();
  marker.name = id;
  group.add(marker);

  const offsets = [-0.4, -0.2, 0, 0.2, 0.4] as const;
  const sizeJitter = [0.94, 1.11, 0.89, 1.07, 0.97] as const;
  const foam = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xeaf8ff, transparent: true, opacity: 0.6, depthWrite: false,
    }), offsets.length);
  foam.name = id + '-foam';
  foam.userData['cascadeFoam'] = true;
  const dummy = new THREE.Object3D();
  for (const [index, offset] of offsets.entries()) {
    dummy.position.copy(pool).addScaledVector(sideways, offset * width);
    const fleckWidth = width * sizeJitter[index]!;
    dummy.scale.set(fleckWidth * 0.16, fleckWidth * 0.07, fleckWidth * 0.16);
    dummy.updateMatrix();
    foam.setMatrixAt(index, dummy.matrix);
  }
  foam.instanceMatrix.needsUpdate = true;
  foam.computeBoundingSphere();
  group.add(foam);
}
/**
 * One InstancedMesh renders all cascade foam (five blobs per waterfall).
 * Keep named, mesh-free markers with the corresponding instance ranges so
 * waterfall-specific tests and debug inspection still locate their flecks.
 * This offsets the new HF-10 cascade's draw call without changing budgets.
 */
function batchWaterfallFoam(group: THREE.Group): void {
  const foams = group.children.filter((object): object is THREE.InstancedMesh =>
    object instanceof THREE.InstancedMesh && object.userData['cascadeFoam'] === true);
  if (!foams.length) return;
  const first = foams[0]!;
  const total = foams.reduce((sum, foam) => sum + foam.count, 0);
  const combined = new THREE.InstancedMesh(first.geometry, first.material, total);
  combined.name = 'waterfall-foam-batch';
  const transform = new THREE.Matrix4();
  let offset = 0;
  for (const foam of foams) {
    const marker = new THREE.Group();
    marker.name = foam.name;
    marker.userData['instanceOffset'] = offset;
    marker.userData['instanceCount'] = foam.count;
    for (let i = 0; i < foam.count; i++) {
      foam.getMatrixAt(i, transform);
      combined.setMatrixAt(offset + i, transform);
    }
    offset += foam.count;
    group.remove(foam);
    group.add(marker);
    if (foam !== first) {
      foam.geometry.dispose();
      (foam.material as THREE.Material).dispose();
    }
  }
  combined.instanceMatrix.needsUpdate = true;
  combined.computeBoundingSphere();
  group.add(combined);
}

/**
 * Find one descending Mt. Gigga face in Hoofington's painted composition.
 * Polar rings are spaced 2 m apart with <=2 m arc steps; no RNG or fixed
 * waterfall coordinates, so other island seeds/sizes can safely return none.
 */
function hoofingtonBackdropWaterfall(island: IslandData):
  { top: THREE.Vector3; bottom: THREE.Vector3 } | undefined {
  const peak = island.pois.find(poi => poi.id === 'mt-gigga');
  const bookmark = findBookmark('08');
  if (!peak || !bookmark) return undefined;
  const scale = island.size / 600;
  const cx = peak.center.x, cz = peak.center.z;
  const camera = new THREE.PerspectiveCamera(bookmark.fov, 16 / 9, 0.1, 2000);
  camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
  camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
  camera.updateMatrixWorld();

  // Only nearby road/trail points and prop centres can violate the 6 m
  // exclusion. Pre-filtering avoids scanning the whole island for each ring.
  const obstacles: Array<{ x: number; z: number }> = [];
  const reach = 106 * scale;
  for (const road of island.roads) for (const point of road.points) {
    if (Math.hypot(point.x - cx, point.z - cz) <= reach) obstacles.push(point);
  }
  for (const prop of island.props) {
    // A cascade is the result of this search, never an obstacle to itself.
    if (prop.kind === 'cascade' || prop.kind === 'cascade-tall') continue;
    const point = prop.transform.position;
    if (Math.hypot(point.x - cx, point.z - cz) <= reach) obstacles.push(point);
  }
  const minDistanceSq = (6 * scale) ** 2;
  const projected = new THREE.Vector3();
  let bestDrop = -Infinity;
  let best: { top: THREE.Vector3; bottom: THREE.Vector3 } | undefined;
  for (let ring = 40; ring <= 100; ring += 2) {
    const radius = ring * scale;
    const samples = Math.ceil(Math.PI * 2 * radius / (2 * scale));
    for (let i = 0; i < samples; i++) {
      const angle = i * 2 * Math.PI / samples;
      const radialX = Math.cos(angle), radialZ = Math.sin(angle);
      const x = cx + radialX * radius, z = cz + radialZ * radius;
      const upper = gridSample(island, x, z);
      if (!Number.isFinite(upper)) continue;
      projected.set(x, upper + 0.26 * scale, z).project(camera);
      if (Math.abs(projected.x) >= 0.7 || Math.abs(projected.y) >= 0.8 ||
          projected.z < -1 || projected.z >= 1) continue;
      if (obstacles.some(point =>
        (point.x - x) ** 2 + (point.z - z) ** 2 <= minDistanceSq)) continue;

      // The negative central-difference gradient points down the actual
      // sampled slope; on a perfectly flat patch, fall back to outward radial.
      const step = 2 * scale;
      const gx = gridSample(island, x + step, z) - gridSample(island, x - step, z);
      const gz = gridSample(island, x, z + step) - gridSample(island, x, z - step);
      const length = Math.hypot(gx, gz);
      const downX = length > 1e-8 ? -gx / length : radialX;
      const downZ = length > 1e-8 ? -gz / length : radialZ;
      const bottomX = x + 10 * scale * downX;
      const bottomZ = z + 10 * scale * downZ;
      const lower = gridSample(island, bottomX, bottomZ);
      const drop = upper - lower;
      if (drop >= 6 * scale && drop > bestDrop) {
        bestDrop = drop;
        best = {
          top: new THREE.Vector3(x, upper + 0.26 * scale, z),
          bottom: new THREE.Vector3(bottomX, lower + 0.18 * scale, bottomZ),
        };
      }
    }
  }
  return best;
}

/**
 * Pure, deterministic site selection matching the former makeFalls calls.
 * Uses final sampled terrain (not authored water levels); never consumes RNG.
 * Returned vectors are newly allocated and may be used by both the descriptor
 * pass and the water-foam renderer without mutating the island.
 */
export function waterfallSites(island: IslandData): WaterfallSite[] {
  const sites: WaterfallSite[] = [];
  const scale = island.size / 600;
  const damPlot = island.plots.find(plot => plot.poiId === 'the-dam');
  const insideDamPlot = (x: number, z: number): boolean =>
    damPlot !== undefined && Math.hypot(x - damPlot.center.x,
      z - damPlot.center.z) <= damPlot.radius;

  for (let i = 0; i < island.river.length - 1; i++) {
    const fall = riverCliffDrop(island, island.river[i]!, island.river[i + 1]!,
      damPlot?.center);
    if (fall) sites.push({ id: 'mountain-waterfall-' + i, ...fall });
  }
  for (const [i, angle] of [0.54, 0.89].entries()) {
    const upperRadius = (i === 0 ? 38 : 74) * scale;
    const lowerRadius = (i === 0 ? 46 : 83) * scale;
    const x0 = Math.cos(angle) * upperRadius, z0 = Math.sin(angle) * upperRadius;
    const x1 = Math.cos(angle) * lowerRadius, z1 = Math.sin(angle) * lowerRadius;
    if (insideDamPlot(x0, z0)) continue;
    const upper = gridSample(island, x0, z0);
    const lower = gridSample(island, x1, z1);
    if (upper - lower > 3 * scale) sites.push({
      id: 'front-terrace-waterfall-' + (i + 1),
      top: new THREE.Vector3(x0, upper + 0.26 * scale, z0),
      bottom: new THREE.Vector3(x1, lower + 0.18 * scale, z1),
      width: (i === 0 ? 5.1 : 4.2) * scale,
    });
  }
  const backdrop = hoofingtonBackdropWaterfall(island);
  if (backdrop) sites.push({
    id: 'hoofington-backdrop-waterfall',
    ...backdrop, width: 6 * scale,
  });
  return sites;
}

function buildDamReservoir(island: IslandData, light: LightUniform, time: { value: number }): THREE.Mesh {
  const { positions, depths } = damHeadwaterSurface(island);
  const { scale } = getDamHeadwater(island);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depths, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uLight: light, uScale: { value: scale } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: [
      'attribute float depth;',
      'varying float vDepth;',
      'varying vec2 vGround;',
      'void main() {',
      '  vDepth = depth;',
      '  vGround = position.xz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime, uScale;',
      'uniform vec3 uLight;',
      'varying float vDepth;',
      'varying vec2 vGround;',
      'float wave(float phase) {',
      '  return sin(phase) * (1.0 - smoothstep(0.45, 1.5, fwidth(phase)));',
      '}',
      'void main() {',
      '  float depth = vDepth / uScale;',
      '  vec2 xz = vGround / uScale;',
      '  float ripple = 0.58 * wave(dot(xz, vec2(0.48, 0.32)) - uTime * 1.12)',
      '    + 0.42 * wave(dot(xz, vec2(-0.34, 0.52)) + uTime * 0.84);',
      '  float deep = smoothstep(0.0, 2.9, depth);',
      '  vec3 color = mix(vec3(0.30, 0.73, 0.69), vec3(0.13, 0.46, 0.63), deep);',
      '  color += vec3(0.023, 0.055, 0.063) * ripple;',
      '  float wash = smoothstep(0.04, 0.17, depth) * (1.0 - smoothstep(0.17, 0.46, depth));',
      '  color = mix(color, vec3(0.69, 0.88, 0.76), wash * (0.12 + 0.09 * ripple));',
      '  float cover = smoothstep(0.0, 0.19, depth);',
      '  gl_FragColor = sRGBTransferEOTF(vec4(color * uLight, 0.92 * cover));',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const surface = new THREE.Mesh(geometry, material);
  surface.name = 'dam-reservoir';
  return surface;
}

/** Reusable animated sea, river, reservoir and waterfall visual effects. */
export function buildWaterVisuals(island: IslandData,
  atmosphere = skyUniforms()): WaterVisuals {
  // The sea, rivers and reservoir share the same daylight tint.
  const uLight: LightUniform = { value: new THREE.Vector3(1, 1, 1) };
  const nightLight = new THREE.Vector3(0.16, 0.20, 0.34);
  const dayLight = new THREE.Vector3(1, 1, 1);
  const seaMat = seaMaterial(island, uLight, atmosphere);
  const sea = new THREE.Mesh(
    circularSeaGeometry(island.size),
    seaMat.material,
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = island.seaLevel;
  sea.name = 'rising-sea';
  sea.renderOrder = 2;
  const skirt = new THREE.Mesh(seabedSkirtGeometry(island),
    new THREE.MeshLambertMaterial({ vertexColors: true, fog: true }));
  skirt.name = 'seabed-skirt';
  skirt.renderOrder = 1;
  skirt.castShadow = false;
  skirt.receiveShadow = false;
  // The water renderer already adds the sea to the scene. Parent the skirt
  // there without making it follow the sea's rotation or changing tide:
  // Rx(-90) * T(0, 0, -tide) * Rx(+90) cancels in world coordinates.
  skirt.rotation.x = Math.PI / 2;
  skirt.position.z = -island.seaLevel;
  sea.add(skirt);
  const inland = new THREE.Group();
  inland.name = 'rivers-reservoir-and-falls';
  const mountain = new THREE.Group();
  mountain.name = 'mountain-terrace-falls';
  const stream = inlandMaterial(uLight);
  const riverPaint = riverMaterial(stream.material, seaMat.uniforms.uLevel);
  const replacedCascadeIds = new Set<string>();
  const damPlot = island.plots.find(plot => plot.poiId === 'the-dam');
  // The bespoke Dam plunge-pool surface occupies the middle reaches. Do
  // not draw the old thin river ribbon over it: its extra side vertices
  // make a bright diagonal sheet across the otherwise sculpted pool.
  const upstream = riverMesh(island.river.slice(0, 5), riverPaint,
    island, damPlot?.center);
  upstream.name = 'rippling-river';
  const forestOutflow = riverMesh(island.river.slice(FOREST_OUTFLOW_START), riverPaint,
    island, damPlot?.center, true);
  forestOutflow.name = 'forest-river-after-dam';
  // Both reaches use the same animated shader. Merge their disconnected
  // index buffers into one draw so the new shoreline foam costs no extra
  // scene mesh. The Dam plunge pool remains an intentional gap between them.
  const glade = island.props.find(prop => prop.id === PINES_GLADE_CASCADE);
  const cascade = glade && forestCascade(island, glade, forestOutflow);
  const riverParts = [upstream.geometry, forestOutflow.geometry];
  if (cascade) {
    riverParts.push(cascade.water);
    inland.add(cascade.bed);
    replacedCascadeIds.add(PINES_GLADE_CASCADE);
  }
  const terraceParts = new Map<string, THREE.BufferGeometry>();
  for (const prop of island.props) {
    if (!prop.id.startsWith('waterfall-cascade-front-terrace-waterfall-')) continue;
    const connected = terraceCascade(island, prop);
    if (connected) terraceParts.set(prop.id, connected);
  }
  const terraces = terraceParts.size ? mergeGeometries([...terraceParts.values()]) : null;
  if (terraces) {
    const terraceWater = new THREE.Mesh(terraces, riverPaint);
    terraceWater.name = 'mountain-terrace-water';
    mountain.add(terraceWater);
    terraces.computeBoundingBox();
    for (const id of terraceParts.keys()) replacedCascadeIds.add(id);
  }
  terraceParts.forEach(geometry => geometry.dispose());
  const riverGeometry = mergeGeometries(riverParts);
  if (riverGeometry) {
    riverParts.forEach(geometry => geometry.dispose());
    upstream.geometry = riverGeometry;
    inland.add(upstream);
  } else {
    inland.add(upstream, forestOutflow);
    for (const extra of riverParts.slice(2)) inland.add(new THREE.Mesh(extra, riverPaint));
  }
  const scale = island.size / 600;
  const reservoir = buildDamReservoir(island, uLight, stream.time);
  const headwaterLevel = getDamHeadwater(island).level;
  inland.add(reservoir);
  // The authored cascade GLB owns all waterfall silhouettes and plunge pools.
  // Keep the named mesh-free markers and the single instanced foam draw.
  for (const prop of island.props) {
    if ((prop.kind === 'cascade' || prop.kind === 'cascade-tall') &&
        (prop.id.startsWith('waterfall-cascade-') ||
          prop.id === PINES_GLADE_CASCADE)) {
      if (prop.id === PINES_GLADE_CASCADE || !replacedCascadeIds.has(prop.id)) {
        makeWaterfallFoam(inland, prop, scale);
      }
    }
  }
  batchWaterfallFoam(inland);
  // MeshBasicMaterial ignores light uniforms; retain each foam/fleck base colour
  // so changing phase never compounds its tint or alters the daytime palette.
  const foamBaseColors = new Map<THREE.MeshBasicMaterial, THREE.Color>();
  inland.traverse(object => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
      foamBaseColors.set(object.material, object.material.color.clone());
    }
  });
  // The four spillway sheets and their foam now come from the custom Dam GLB.
  // Keep the mountain and river cascades, but do not draw duplicate dam falls.
  return {
    sea, inland, mountain, light: uLight.value, replacedCascadeIds,
    setLighting(daylight: number, golden: number): void {
      const warmth = THREE.MathUtils.clamp(golden, 0, 1);
      dayLight.set(1, 1 - 0.14 * warmth, 1 - 0.26 * warmth);
      uLight.value.copy(nightLight).lerp(dayLight,
        THREE.MathUtils.smoothstep(daylight, 0.025, 0.6));
      for (const [material, base] of foamBaseColors) {
        material.color.setRGB(base.r * uLight.value.x,
          base.g * uLight.value.y, base.b * uLight.value.z);
      }
    },
    update(time: number, tide: number): void {
      seaMat.uniforms.uTime.value = time;
      seaMat.uniforms.uLevel.value = tide;
      stream.time.value = time;
      sea.position.y = tide;
      skirt.position.z = -tide; // Keep the skirt fixed under the rising sea.
      reservoir.visible = tide < headwaterLevel;
      inland.visible = tide < island.reservoir.level + 2 * scale;
      if (terraces) mountain.visible = tide < terraces.boundingBox!.max.y + 0.23;
    },
  };
}
