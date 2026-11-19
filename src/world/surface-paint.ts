import * as THREE from 'three';
import { clamp, GradientNoise, hashString, smoothstep } from './random';
import type { IslandData } from './types';

const MAP_RESOLUTION = 256;
/** The software renderer samples the same authored masks as the terrain shaders. */
export const surfacePaintMaps = new WeakMap<THREE.Material, {
  kind: 'road' | 'lawn'; data: Uint8Array; samples: number; width: number; cx: number; cz: number;
}>();
type ToonShader = Parameters<THREE.MeshToonMaterial['onBeforeCompile']>[0];

function filteredPaint(data: Uint8Array, format: THREE.PixelFormat): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, MAP_RESOLUTION, MAP_RESOLUTION, format);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** World-space patches across the island, filtered at distance with no repeating grain. */
export function paintAsphalt(material: THREE.MeshToonMaterial, island: IslandData): void {
  const noise = new GradientNoise(hashString(String(island.seed) + ':asphalt-wear'));
  const data = new Uint8Array(MAP_RESOLUTION * MAP_RESOLUTION);
  for (let z = 0; z < MAP_RESOLUTION; z++) for (let x = 0; x < MAP_RESOLUTION; x++) {
    const u = (x + .5) / MAP_RESOLUTION * 600, v = (z + .5) / MAP_RESOLUTION * 600;
    const wear = .52 + noise.sample(u / 12.4, v / 11.8) * .46 +
      noise.sample(u / 4.9 + 4.2, v / 4.5 - 6.2) * .14;
    data[z * MAP_RESOLUTION + x] = Math.round(clamp(wear, 0, 1) * 255);
  }
  const map = filteredPaint(data, THREE.RedFormat);
  surfacePaintMaps.set(material, { kind: 'road', data, samples: MAP_RESOLUTION,
    width: island.size, cx: 0, cz: 0 });
  material.addEventListener('dispose', () => map.dispose());
  material.onBeforeCompile = shader => {
    shader.uniforms['uAsphaltWear'] = { value: map };
    shader.uniforms['uAsphaltMapScale'] = { value: 1 / island.size };
    shader.uniforms['uAsphaltEdgeScale'] = { value: 600 / island.size };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute vec2 roadCrossSection;
varying vec2 vAsphaltXZ;
varying vec2 vAsphaltSection;`,
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vAsphaltXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
vAsphaltSection = roadCrossSection;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform sampler2D uAsphaltWear;
uniform float uAsphaltMapScale;
uniform float uAsphaltEdgeScale;
varying vec2 vAsphaltXZ;
varying vec2 vAsphaltSection;`,
    ).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
float asphaltWear = texture2D(uAsphaltWear, vAsphaltXZ * uAsphaltMapScale + 0.5).r;
float metresToRoadEdge = (1.0 - abs(vAsphaltSection.x)) *
  vAsphaltSection.y * uAsphaltEdgeScale;
float shoulder = 1.0 - smoothstep(0.10, 1.03, metresToRoadEdge);
float contact = 1.0 - smoothstep(0.04, 0.29, metresToRoadEdge);
diffuseColor.rgb *= mix(0.81, 1.14, asphaltWear);
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.98, 0.94, 0.86), shoulder);
diffuseColor.rgb *= 1.0 - 0.15 * contact;`,
    );
  };
}

export function makeVillageGroundPaint(island: IslandData, material?: THREE.Material): {
  map: THREE.DataTexture; apply(shader: ToonShader): void;
} {
  const village = island.pois.find(poi => poi.id === 'hoofington')!.center;
  const scale = island.size / 600, width = 114 * scale;
  const footprints = island.props.filter(prop => prop.poiId === 'hoofington' &&
    (prop.kind === 'house' || prop.kind === 'cottage')).map(prop => ({
    position: prop.transform.position, cos: Math.cos(prop.transform.rotationY),
    sin: Math.sin(prop.transform.rotationY),
    // The authored fitted houses retain about 92% of the descriptor footprint.
    halfX: prop.size.x * .46, halfZ: prop.size.z * .46,
  }));
  const noise = new GradientNoise(hashString(String(island.seed) + ':hoofington-lawn'));
  const data = new Uint8Array(MAP_RESOLUTION * MAP_RESOLUTION * 2);
  for (let z = 0; z < MAP_RESOLUTION; z++) for (let x = 0; x < MAP_RESOLUTION; x++) {
    const dx = ((x + .5) / MAP_RESOLUTION - .5) * width;
    const dz = ((z + .5) / MAP_RESOLUTION - .5) * width;
    const wx = village.x + dx, wz = village.z + dz;
    let contact = 0;
    for (const { position, cos, sin, halfX, halfZ } of footprints) {
      const relativeX = wx - position.x, relativeZ = wz - position.z;
      const wallX = Math.abs(relativeX * cos - relativeZ * sin) - halfX;
      const wallZ = Math.abs(relativeX * sin + relativeZ * cos) - halfZ;
      const metres = Math.hypot(Math.max(0, wallX), Math.max(0, wallZ)) / scale;
      contact = Math.max(contact, 1 - smoothstep(.05, 1.45, metres));
    }
    const neighbourhood = 1 - smoothstep(.36, .49, Math.max(Math.abs(dx), Math.abs(dz)) / width);
    const lawn = noise.sample(dx / (9.7 * scale), dz / (11.8 * scale)) * neighbourhood;
    const at = (z * MAP_RESOLUTION + x) * 2;
    data[at] = Math.round(contact * neighbourhood * 255);
    data[at + 1] = Math.round(clamp(.5 + lawn * .62, 0, 1) * 255);
  }
  const map = filteredPaint(data, THREE.RGFormat);
  if (material) surfacePaintMaps.set(material, { kind: 'lawn', data, samples: MAP_RESOLUTION,
    width, cx: village.x, cz: village.z });
  return {
    map,
    apply(shader): void {
      shader.uniforms['uVillageGroundPaint'] = { value: map };
      shader.uniforms['uVillagePaintBounds'] = { value: new THREE.Vector3(village.x, village.z, 1 / width) };
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uVillageGroundPaint;
uniform vec3 uVillagePaintBounds;`,
      ).replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 villagePaintUV = (vWorld.xz - uVillagePaintBounds.xy) * uVillagePaintBounds.z + 0.5;
if (all(greaterThan(villagePaintUV, vec2(0.0))) && all(lessThan(villagePaintUV, vec2(1.0)))) {
  vec2 villagePaint = texture2D(uVillageGroundPaint, villagePaintUV).rg;
  diffuseColor.rgb *= 1.0 + (villagePaint.g - 0.5) * vec3(0.26, 0.31, 0.21);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.70, 0.73, 0.63), villagePaint.r);
}`,
      );
    },
  };
}

const PAINTED_JOINT = `
// Fade the drawn joint as its projected spacing approaches a pixel.
float paintedJoint(float position, float width) {
  float aa = max(fwidth(position), 0.004);
  float distanceToJoint = abs(fract(position + 0.5) - 0.5);
  return (1.0 - smoothstep(width, width + aa, distanceToJoint)) *
    (1.0 - smoothstep(0.10, 0.30, aa));
}`;

export function paintHoofingtonFacades(material: THREE.MeshToonMaterial, scale: number): void {
  material.onBeforeCompile = shader => {
    shader.uniforms['uFacadeScale'] = { value: 1 / scale };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 hoofingtonFacade;
varying vec4 vHoofingtonFacade;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vHoofingtonFacade = hoofingtonFacade;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uFacadeScale;
varying vec4 vHoofingtonFacade;
${PAINTED_JOINT}`).replace('#include <color_fragment>', `#include <color_fragment>
float facadeStyle = vHoofingtonFacade.w;
if (facadeStyle > 0.5) {
  vec3 metres = vHoofingtonFacade.xyz * uFacadeScale;
  float wall = 1.0 - smoothstep(0.12, 0.35, abs(dot(normalize(vNormal), viewMatrix[1].xyz)));
  float along = metres.x + metres.z * 0.82;
  float weathering = 0.5 + 0.5 * sin(along * 0.69 + metres.y * 0.16) *
    cos(along * 0.29 - metres.y * 0.75);
  float footing = 1.0 - smoothstep(0.14, 0.82, metres.y);
  float siding = 0.0;
  if (facadeStyle < 1.5) {
    // Soft plaster wash and low foundation courses. Dark doors/roofs and blue
    // glass retain their baked palette.
    wall *= smoothstep(0.23, 0.48, dot(diffuseColor.rgb, vec3(0.21, 0.72, 0.07))) *
      smoothstep(-0.02, 0.12, diffuseColor.r - diffuseColor.b);
    float course = metres.y / 0.30;
    float stagger = mod(floor(course), 2.0) * 0.5;
    siding = (paintedJoint(course, 0.035) +
      paintedJoint(along / 0.85 + stagger, 0.025) * 0.65) * footing;
  } else if (facadeStyle < 2.5) {
    // The barn atlas also supplies ivory trim. Shade only the red board faces.
    float redContrast = (diffuseColor.r - max(diffuseColor.g, diffuseColor.b)) /
      max(0.01, diffuseColor.r);
    wall *= smoothstep(0.20, 0.48, redContrast) * smoothstep(0.10, 0.25, diffuseColor.r);
    siding = paintedJoint(along / 0.54, 0.032);
  } else {
    // Courses on mill masonry and subtle ring seams on the silo.
    siding = paintedJoint(metres.y / 0.64, 0.024) *
      (0.32 + 0.68 * (1.0 - smoothstep(1.5, 4.0, metres.y)));
  }
  vec3 footingTint = mix(vec3(1.0), vec3(0.78, 0.74, 0.67), footing * (0.45 + 0.55 * weathering));
  diffuseColor.rgb *= mix(vec3(1.0), footingTint * (0.96 + 0.08 * weathering - 0.14 * siding), wall);
}`);
  };
}

export function paintHoofingtonVerge(material: THREE.MeshToonMaterial, scale: number): void {
  material.onBeforeCompile = shader => {
    shader.uniforms['uVergeScale'] = { value: 1 / scale };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 hoofingtonVerge;
varying vec2 vVergeSection;
varying vec2 vVergeXZ;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vVergeSection = hoofingtonVerge;
vVergeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uVergeScale;
varying vec2 vVergeSection;
varying vec2 vVergeXZ;
${PAINTED_JOINT}`).replace('#include <color_fragment>', `#include <color_fragment>
if (vVergeSection.y > 0.5) {
  vec2 paving = vVergeXZ * uVergeScale;
  float slab = paving.y / 2.35;
  float slabTone = 0.5 + 0.5 * sin(floor(slab) * 2.31 + paving.x * 0.24);
  float wash = mix(0.5, slabTone, 1.0 - smoothstep(0.14, 0.45, fwidth(slab)));
  float shoulder = 1.0 - smoothstep(0.01, 0.16, min(vVergeSection.x, 1.0 - vVergeSection.x));
  float joint = paintedJoint(slab, 0.011);
  diffuseColor.rgb *= mix(0.88, 1.04, wash);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.89, 0.85, 0.76),
    shoulder * (vVergeSection.y < 1.5 ? 0.66 : 0.25));
  diffuseColor.rgb *= 1.0 - 0.15 * joint;
}`);
  };
}
