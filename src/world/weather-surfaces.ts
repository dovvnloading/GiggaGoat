import type * as THREE from 'three';
import type { skyUniforms } from './visual-sky';

type Shader = Parameters<THREE.MeshToonMaterial['onBeforeCompile']>[0];
export function weatherSurface(shader: Shader, sky: ReturnType<typeof skyUniforms>, road: boolean): void {
  const { uWet, uRain, uCover, uWind, uCloudField, uSun, uDay } = sky;
  Object.assign(shader.uniforms, { uWet, uRain, uCover, uWind, uCloudField, uSun, uDay });
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uWet, uRain, uCover, uDay;
uniform vec2 uWind;
uniform vec3 uSun;
uniform sampler2D uCloudField;`);
  const detail = road ? `
    float aggregate = texture2D(uCloudField, groundXZ * vec2(.35,.58)).r;
    diffuseColor.rgb *= .79 + .41 * aggregate;
    float basin = texture2D(uCloudField, groundXZ * vec2(.029,.055)).r;
    float puddle = uWet * smoothstep(.49, .65, basin) * smoothstep(.23, .85, abs(vAsphaltSection.x));
    diffuseColor.rgb *= 1.0 - .32 * uWet;
    vec3 eye = normalize(cameraPosition - vRainWorld);
    float sheen = pow(1.0 - clamp(eye.y, 0.0, 1.0), 2.0);
    float glint = pow(max(0.0, dot(reflect(-uSun, vec3(0,1,0)), eye)), 18.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.27,.38,.47) * (.31 + .69*uDay),
      puddle * (.20 + .68*sheen));
    vec2 cell = groundXZ * 1.8;
    float seed = fract(dot(floor(cell), vec2(.3183,.4197)));
    vec2 ripple = fract(cell) - .5 + .24 * sin(seed * vec2(62.1, 83.7));
    float age = fract(uWind.x * 2600.0 + seed);
    float ring = 1.0 - smoothstep(.009, .037 + fwidth(cell.x), abs(length(ripple) - age * .44));
    float nearRain = 1.0 - smoothstep(10.0, 23.0, length(cameraPosition - vRainWorld));
    diffuseColor.rgb += puddle * (glint * vec3(.55,.37,.19) + uRain * ring * (1.0-age) * nearRain * .12);
  ` : `
    float meadowPatch = texture2D(uCloudField, groundXZ * .014).r;
    float broken = texture2D(uCloudField, groundXZ * .16).r;
    float grass = smoothstep(.005,.09,diffuseColor.g - diffuseColor.r * .73);
    vec3 dry = vec3(1.13,1.025,.79), damp = vec3(.72,.91,.83);
    diffuseColor.rgb *= mix(vec3(1),mix(dry,damp,smoothstep(.31,.65,meadowPatch)),grass);
    diffuseColor.rgb *= (.95 + .11 * broken) * (1.0 - uWet * (.12 + .13 * meadowPatch));
  `;
  if (road) {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRainWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRainWorld = (modelMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRainWorld;');
  }
  shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
    vec2 groundXZ = ${road ? 'vRainWorld.xz' : 'vWorld.xz'};
    ${detail}
    vec2 projectionXZ = groundXZ + uSun.xz * 140.0 / max(.18, uSun.y);
    float overhead = texture2D(uCloudField, projectionXZ * .0018 + uWind).r;
    float shade = smoothstep(.62 - .33*uCover, .75 - .33*uCover, overhead) * uDay;
    diffuseColor.rgb *= mix(vec3(1), vec3(.70,.77,.86), shade);
  `);
}
