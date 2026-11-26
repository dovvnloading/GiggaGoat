import * as THREE from 'three';
import { sampleEnvironmentWind, type EnvironmentWind } from './environment-wind';
import type { PropKind } from './types';

export function createWindUniforms(seed: string | number) {
  const sample = sampleEnvironmentWind(0, seed);
  return {
    uWorldWind: { value: sample.time },
    uWindSeed: { value: sample.phase },
    uWindVelocity: { value: new THREE.Vector2(sample.directionX * sample.strength,
      sample.directionZ * sample.strength) },
  };
}
export type WindUniforms = ReturnType<typeof createWindUniforms>;

export function updateWindUniforms(uniforms: WindUniforms, wind: EnvironmentWind): void {
  uniforms.uWorldWind.value = wind.time;
  uniforms.uWindSeed.value = wind.phase;
  uniforms.uWindVelocity.value.set(wind.directionX * wind.strength, wind.directionZ * wind.strength);
}

/** The same wave equation is used by CPU boat/steam and GPU foliage motion. */
const WIND_GLSL = `
uniform float uWorldWind;
uniform float uWindSeed;
uniform vec2 uWindVelocity;
attribute float windWeight;
float islandGust(vec2 p) {
  return .62 + .24 * sin(uWorldWind * .31 + uWindSeed + p.x * .012 + p.y * .009)
    + .14 * sin(uWorldWind * .73 + uWindSeed * 1.7 + p.x * .047 - p.y * .033);
}
`;

export function applyWindShader(shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: WindUniforms): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>',
    '#include <common>\n' + WIND_GLSL).replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
      vec2 wind = uWindVelocity * islandGust(instanceMatrix[3].xz);
      vec2 xAxis = instanceMatrix[0].xz;
      vec2 zAxis = instanceMatrix[2].xz;
      // Dot into each instance's local basis: yawed plants bend together.
      // Weight is model-local, so roots stay planted at every island scale.
      float heightScale = length(instanceMatrix[1].xyz);
      transformed.x += dot(xAxis, wind) * windWeight * heightScale / max(.0001, dot(xAxis, xAxis));
      transformed.z += dot(zAxis, wind) * windWeight * heightScale / max(.0001, dot(zAxis, zAxis));
    #endif`);
}

/**
 * Author a bend mask on the actual loaded geometry, not an assumed unit box.
 * Trunks/poles and the attached edge of fabric remain immobile. This also
 * works for native-metre meadow kits and normalised baked prop variants.
 */
export function prepareWindGeometry(geometry: THREE.BufferGeometry, kind: PropKind | 'meadow'): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const height = Math.max(.0001, box.max.y - box.min.y);
  const width = Math.max(.0001, box.max.x - box.min.x);
  const positions = geometry.getAttribute('position'), colours = geometry.getAttribute('color');
  const weights = new Float32Array(positions.count);
  const ease = THREE.MathUtils.smoothstep;
  const tree = kind === 'tree-oak' || kind === 'tree-pine';
  for (let i = 0; i < positions.count; i++) {
    const y = (positions.getY(i) - box.min.y) / height;
    const x = (positions.getX(i) - box.min.x) / width;
    if (kind === 'flag') {
      // The shipped pennant's pole occupies its leftmost 16% of the box.
      weights[i] = height * .035 * ease(x, .18, .85) * ease(y, .60, .76);
    } else if (kind === 'bunting') {
      // Both end fixings and the upper cable line remain attached.
      weights[i] = height * .07 * Math.sin(Math.PI * x) ** 2 * (1 - ease(y, .75, 1));
    } else {
      const woody = tree && colours && colours.getX(i) > colours.getY(i) * 1.18 &&
        colours.getX(i) > colours.getZ(i) * 1.25;
      weights[i] = woody ? 0 : height * (tree ? .018 : kind === 'meadow' ? .17 : .065) *
        ease(y, tree ? .35 : .06, 1) ** 2;
    }
  }
  geometry.setAttribute('windWeight', new THREE.BufferAttribute(weights, 1));
}

/** Opaque alpha hashing supports distant fades without sorted transparent layers. */
export function applyAmbientDistanceFade(material: THREE.Material, near: number, far: number): void {
  material.alphaHash = !material.transparent;
  material.onBeforeCompile = shader => {
    shader.uniforms['uLifeFadeRange'] = { value: new THREE.Vector2(near, far) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying float vLifeDistance;').replace('#include <project_vertex>',
      '#include <project_vertex>\nvLifeDistance = length(mvPosition.xyz);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vLifeDistance;\nuniform vec2 uLifeFadeRange;')
      .replace('#include <alphahash_fragment>',
        'diffuseColor.a *= 1.0 - smoothstep(uLifeFadeRange.x, uLifeFadeRange.y, vLifeDistance);\n' +
        '#include <alphahash_fragment>');
  };
  material.customProgramCacheKey = () => 'ambient-distance-fade-v1';
}
