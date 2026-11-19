import * as THREE from 'three';
import type { IslandData } from './types';
import { SeededRandom } from './random';
import { gridSample } from './terrain';

/** Small colonies stay at the damp fern beds along the Pines trail. */
export function pinesFireflies(island: IslandData) {
  const rng = new SeededRandom(String(island.seed) + ':pines-fireflies');
  const points: number[] = [], phases: number[] = [];
  const beds = island.props.filter(p => p.poiId === 'whispering-pines' && ['fern','log','lily-pads'].includes(p.kind));
  for (const bed of beds.slice(0,25)) {
    for (let i = 0; i < 4; i++) {
      const x = bed.transform.position.x + rng.range(-2.2,2.2);
      const z = bed.transform.position.z + rng.range(-2.2,2.2);
      points.push(x, Math.max(gridSample(island,x,z),island.seaLevel) + rng.range(.45,1.5), z);
      phases.push(rng.range(0,Math.PI*2));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  geometry.setAttribute('glimmer',new THREE.Float32BufferAttribute(phases,1));
  const uniforms = { uTime:{value:0}, uBrightness:{value:0} };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    vertexShader:`uniform float uTime; attribute float glimmer; varying float vGlow;
      void main(){
        vec3 p = position;
        p.xz += vec2(sin(uTime*.67+glimmer),cos(uTime*.46+glimmer))*.48;
        p.y += sin(uTime*.89+glimmer)*.19;
        vec4 mv = modelViewMatrix*vec4(p,1.);
        vGlow = smoothstep(-.55,.92,sin(uTime*1.18+glimmer)) * (1.-smoothstep(25.,53.,-mv.z));
        gl_PointSize = clamp(92./max(1.,-mv.z),2.,14.);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader:`uniform float uBrightness; varying float vGlow;
      void main(){
        float r=length(gl_PointCoord-.5)*2.;
        float core=1.-smoothstep(.04,.27,r);
        gl_FragColor=vec4(mix(vec3(.58,.86,.18),vec3(1.,.98,.68),core),
          (core+.46*pow(max(0.,1.-r),2.))*vGlow*uBrightness);
        #include <colorspace_fragment>
      }`,
  });
  const swarm = new THREE.Points(geometry,material);
  swarm.name='whispering-pines-fireflies';
  swarm.visible=false;
  return { swarm, update(time:number, daylight:number, rain:number) {
    uniforms.uTime.value=time;
    uniforms.uBrightness.value=(1-THREE.MathUtils.smoothstep(daylight,.08,.65))*(1-rain);
    swarm.visible=points.length>0 && uniforms.uBrightness.value>.02;
  }};
}
