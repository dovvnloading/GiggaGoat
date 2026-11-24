import * as THREE from 'three';
import type { PropKind } from './types';

/** Material families for the authored Downtown building set. Zero protects
 * details with unknown surface identity instead of repainting their atlas. */
export function downtownFinish(mesh: string, material: string, brick = false): number {
  const name = material.toLowerCase(), part = mesh.toLowerCase();
  if (/glass|glaz|window.?pane/.test(name)) return 7;
  if (/brick/.test(name)) return 8;
  if (/wall|plaster|stucco|masonry/.test(name)) return brick ? 8 : 4;
  if (/roof|membrane|shingle/.test(name)) return 5;
  if (/plinth|cornice|foundation|stone|concrete/.test(name)) return 9;
  if (/steel|metal|aluminium|aluminum|gutter|vent/.test(name)) return 6;
  if (/door|flower|leaf|wood|sign|awning|window|trim|frame/.test(name)) return 0;
  // The commercial kit also supplies one shared palette atlas. Its shell
  // is treated conservatively in the shader, with colour/normal masks.
  if (/^building[-_ ](?:type[-_ ]?)?/.test(part) &&
      /paint|atlas|material|colormap|palette/.test(name)) return 10;
  return 0;
}

export type PropFinish = 'concrete' | 'metal' | 'timber' | 'corrugated';
const finishes: Partial<Record<PropKind, PropFinish>> = {
  'concrete-slab': 'concrete', 'concrete-column': 'concrete',
  'site-barrier': 'concrete', 'dam-wall': 'concrete',
  container: 'corrugated', 'ac-unit': 'metal', crane: 'metal',
  'crane-jib': 'metal', 'crane-cab': 'metal', 'yard-scaffold': 'metal',
  'safety-rail': 'metal', 'red-girder': 'metal', 'pipe-stack': 'metal',
  pier: 'timber', dock: 'timber', fence: 'timber', crate: 'timber',
  'pallet-stack': 'timber', 'cable-spool': 'timber',
};
export function propFinish(kind: PropKind): PropFinish | undefined { return finishes[kind]; }

const ids: Record<PropFinish, number> = { concrete: 1, metal: 2, timber: 3, corrugated: 4 };

/**
 * Local-metre material finish on the existing batched prop geometry. Uses
 * the actual instance scale (including streamed asset fit), keeps colours
 * underneath, and fades line/grain detail before it aliases at a distance.
 * No additional geometry, maps, draw calls or time-dependent shader inputs.
 */
export function paintPropFinish(material: THREE.MeshToonMaterial, finish: PropFinish, scale: number): void {
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => previousKey + ':lived-in-prop-' + finish;
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms['uFinishScale'] = { value: 1 / scale };
    shader.uniforms['uFinishKind'] = { value: ids[finish] };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform float uFinishScale;
varying vec3 vFinishMetres;
varying vec3 vFinishNormal;
varying float vFinishPhase;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 finishSize = vec3(1.0);
vFinishPhase = 0.0;
#ifdef USE_INSTANCING
  finishSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vFinishPhase = dot(instanceMatrix[3].xz, vec2(0.137, 0.071)) * uFinishScale;
#endif
vFinishMetres = position * finishSize * uFinishScale;
vFinishNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uFinishKind;
varying vec3 vFinishMetres;
varying vec3 vFinishNormal;
varying float vFinishPhase;
float finishLine(float p, float w) {
  float aa = max(fwidth(p), 0.002);
  return (1.0 - smoothstep(w, w + aa, abs(fract(p + 0.5) - 0.5))) *
    (1.0 - smoothstep(0.12, 0.40, aa));
}
float finishGrain(float p) {
  return sin(p) * (1.0 - smoothstep(0.35, 2.0, fwidth(p)));
}`).replace('#include <color_fragment>', `#include <color_fragment>
vec3 fm = vFinishMetres;
float verticalFace = 1.0 - smoothstep(0.20, 0.62, abs(normalize(vFinishNormal).y));
float across = fm.x + fm.z * 0.87;
float broad = 0.5 + 0.5 * sin(across * 1.31 + vFinishPhase) * sin(fm.y * 0.81 + 2.0);
float fine = finishGrain(across * 18.1 + fm.y * 23.7 + vFinishPhase) *
  finishGrain(fm.z * 13.3 - fm.y * 8.4);
if (uFinishKind < 1.5) {
  // Pour lifts, board formwork, and tie-hole shadows on exposed columns.
  float course = fm.y / 1.25;
  float panel = across / 1.8;
  float seams = max(finishLine(course, 0.012), finishLine(panel, 0.009)) * verticalFace;
  vec2 tie = vec2(fract(panel + 0.5) - 0.5, fract(course + 0.5) - 0.5);
  float holes = (1.0 - smoothstep(0.023, 0.054, length(tie))) *
    (1.0 - smoothstep(0.09, 0.23, max(fwidth(course), fwidth(panel)))) * verticalFace;
  diffuseColor.rgb *= (0.93 + broad * 0.12 + fine * 0.025 - seams * 0.13 - holes * 0.17);
} else if (uFinishKind < 2.5) {
  // Painted steel has broad unevenness and occasional vertical runoff.
  float streak = finishGrain(across * 7.8 + vFinishPhase) * (0.5 + 0.5 * broad);
  diffuseColor.rgb *= (0.94 + broad * 0.09 + fine * 0.018 - streak * 0.035 * verticalFace);
} else if (uFinishKind < 3.5) {
  // Sun-bleached timber and end-grain, not a repeating high-contrast stripe.
  float grain = finishGrain(fm.x * 44.0 + 0.7 * sin(fm.z * 0.9 + fm.y * 2.7 + vFinishPhase));
  float end = finishGrain(fm.y * 19.1 + fm.z * 28.3);
  diffuseColor.rgb *= (0.92 + broad * 0.13 + grain * 0.045 + end * 0.018);
} else {
  // Container faces already have ribbed geometry; the finish follows the
  // existing profiles and adds subtle grime, rather than drawing fake ribs.
  float streak = finishGrain(across * 12.7 + vFinishPhase);
  diffuseColor.rgb *= (0.92 + broad * 0.13 + fine * 0.02 - streak * 0.035 * verticalFace);
}
`);
  };
}

/** Additional local-coordinate finishes for the existing district batch. */
export const DOWNTOWN_FINISH_GLSL = `
else if (facadeStyle > 3.5) {
  vec3 m = vHoofingtonFacade.xyz * uFacadeScale;
  float wall = 1.0 - smoothstep(0.12, 0.42, abs(dot(normalize(vNormal), viewMatrix[1].xyz)));
  float along = m.x + m.z * 0.91;
  float wash = 0.5 + 0.5 * sin(along * 1.08 + m.y * 0.17) * cos(m.y * 0.78 - along * 0.21);
  float nearGround = 1.0 - smoothstep(0.12, 0.95, m.y);
  float grainPosition = along * 17.3 + m.y * 26.1;
  float grain = sin(grainPosition) * (1.0 - smoothstep(0.45, 2.0, fwidth(grainPosition)));
  if (facadeStyle < 4.5) {
    // Painted render: mild rain traces, base splash-back, patchy trowel grain.
    float streak = sin(along * 5.6 + 0.5 * sin(m.y * 0.48)) *
      (1.0 - smoothstep(0.4, 1.8, fwidth(along * 5.6)));
    diffuseColor.rgb *= 1.0 + wall * (0.08 * (wash - 0.5) + 0.025 * grain -
      0.12 * nearGround - 0.035 * streak * (0.4 + 0.6 * wash));
  } else if (facadeStyle < 5.5) {
    // Roof membrane laps and sun-bleached bitumen. Only upward faces.
    float seams = paintedJoint(m.z / 1.35, 0.013) + 0.5 * paintedJoint(m.x / 4.0, 0.008);
    diffuseColor.rgb *= 1.0 + (1.0 - wall) * (0.12 * (wash - 0.5) - 0.15 * seams + grain * 0.018);
  } else if (facadeStyle < 6.5) {
    diffuseColor.rgb *= 0.96 + wash * 0.08 + grain * 0.015;
  } else if (facadeStyle < 7.5) {
    // A restrained reflected sky gradient, without turning blue panes white.
    float sheen = smoothstep(0.10, 0.90, fract(m.y / 2.6));
    diffuseColor.rgb *= 0.93 + 0.16 * sheen;
  } else if (facadeStyle < 8.5) {
    // Running bond: stagger the vertical mortar joints on alternate courses.
    float course = m.y / 0.22;
    float column = along / 0.44 + mod(floor(course), 2.0) * 0.5;
    float mortar = max(paintedJoint(course, 0.028), paintedJoint(column, 0.018));
    float brickTone = fract(floor(course) * 0.618 + floor(column) * 0.381) - 0.5;
    float visible = 1.0 - smoothstep(0.12, 0.38, max(fwidth(course), fwidth(column)));
    vec3 brick = diffuseColor.rgb * (1.0 + brickTone * 0.13 * visible + grain * 0.025 - nearGround * 0.11);
    vec3 joint = mix(brick, vec3(0.40, 0.36, 0.31), 0.27);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(brick, joint, mortar), wall);
  } else if (facadeStyle < 9.5) {
    float joints = paintedJoint(m.y / 0.35, 0.019) * 0.65 + paintedJoint(along / 1.1, 0.012);
    diffuseColor.rgb *= 1.0 + wall * (0.08 * (wash - 0.5) - 0.12 * joints - nearGround * 0.08);
  } else {
    // Shared commercial atlas: skip the cool glazing and dark frames.
    // Roof/wall materials with explicit labels take the more precise paths above.
    float lum = dot(diffuseColor.rgb, vec3(0.21, 0.72, 0.07));
    float glazing = smoothstep(0.015, 0.13, diffuseColor.b - diffuseColor.r) *
      smoothstep(0.0, 0.07, diffuseColor.b - diffuseColor.g);
    float paint = smoothstep(0.14, 0.33, lum) * (1.0 - glazing);
    diffuseColor.rgb *= 1.0 + wall * paint * (0.07 * (wash - 0.5) - 0.10 * nearGround + grain * 0.018);
  }
}
`;
