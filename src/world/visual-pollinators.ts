import * as THREE from 'three';
import { SeededRandom } from './random';
import { capeSurface } from './lighthouse-access';
import { isPointInsideProps } from './layouts';
import type { IslandData, PoiId, Vec3 } from './types';
import { ambientFlightActivity, ambientInRange, sampleEnvironmentWind } from './environment-wind';
import { applyAmbientDistanceFade } from './visual-wind';

export interface PollinatorFlight {
  district: PoiId;
  center: Vec3;
  radius: number;
  period: number;
  phase: number;
  size: number;
  color: number;
}
const habitats: readonly PoiId[] = ['hoofington', 'whispering-pines', 'downtown-bleatsville', 'old-lighthouse'];
const colors = [0xf7c45f, 0xeacb7f, 0xb4b6e5, 0xebead6, 0xef9956] as const;

/** Daytime pollinators stay near existing flowering props; no spawned
 * gameplay entities, AI, physics, or random consumption by the island generator. */
export function planPollinators(island: IslandData): PollinatorFlight[] {
  const scale = island.size / 600;
  const result: PollinatorFlight[] = [];
  for (const district of habitats) {
    const rng = new SeededRandom(String(island.seed) + ':pollinators:' + district);
    const plants = island.props.filter(p => p.poiId === district && p.body.type === 'static' &&
      (p.kind === 'flower' || p.kind === 'planter'));
    const clear: PollinatorFlight[] = [];
    for (const plant of plants) {
      if (clear.length >= 5) break;
      const p = plant.transform.position;
      if (clear.some(f => Math.hypot(f.center.x - p.x, f.center.z - p.z) < 7.5 * scale)) continue;
      const ground = capeSurface(island, p.x, p.z);
      const y = Math.max(ground + 1.25 * scale, p.y + plant.size.y / 2 + .34 * scale);
      if (ground < island.seaLevel + .4 * scale || y - ground > 3.3 * scale) continue;
      const radius = rng.range(.65, 1.28) * scale;
      const open = Array.from({ length: 12 }, (_, i) => {
        const a = i * Math.PI / 6;
        return { x: p.x + Math.cos(a) * radius, y: y - .27 * scale,
          z: p.z + Math.sin(a) * radius * .8 };
      }).every(point => !isPointInsideProps(point, island.props, .17 * scale));
      if (!open) continue;
      clear.push({ district, center: { x: p.x, y, z: p.z }, radius,
        period: rng.range(4.5, 9.5), phase: rng.range(0, Math.PI * 2),
        size: rng.range(.17, .26) * scale, color: rng.pick(colors) });
    }
    result.push(...clear);
  }
  return result;
}

/** One patterned wing, mirrored with a rotation (never negative instance
 * scale). Dark edges and central spots make the motion read close to the goat. */
function wingGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  const a = [0, 0, -.12] as const, b = [.42, .01, -.47] as const;
  const c = [.94, -.02, -.29] as const, d = [.88, .03, .06] as const;
  const e = [.65, 0, .40] as const, f = [.27, .01, .37] as const;
  const g = [0, 0, .16] as const, center = [.46, .07, -.03] as const;
  const ring = [a, b, c, d, e, f, g];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    const mix = i % 2 ? .75 : .95;
    positions.push(...center, ...p, ...q);
    colors.push(mix, mix, mix, .21, .19, .15, .38, .32, .24);
  }
  // A small dark body follows each wing root.
  positions.push(-.035, .02, -.37, .035, .02, -.37, 0, .08, .34);
  colors.push(.16, .14, .10, .16, .14, .10, .2, .17, .12);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function buildPollinators(island: IslandData) {
  const group = new THREE.Group();
  group.name = 'daytime-pollinators';
  const flights = planPollinators(island);
  if (!flights.length) return { group, update() {}, dispose() {} };
  const scale = island.size / 600;
  const geometry = wingGeometry();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  applyAmbientDistanceFade(material, 42 * scale, 55 * scale);
  const tideUniform = { value: island.seaLevel };
  const distanceShader = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    distanceShader.call(material, shader, renderer);
    shader.uniforms['uPollinatorTide'] = tideUniform;
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying float vPollinatorHeight;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 pollinatorWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vPollinatorHeight = pollinatorWorld.y;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float uPollinatorTide;\nvarying float vPollinatorHeight;')
      .replace('#include <alphahash_fragment>',
        `diffuseColor.a *= smoothstep(uPollinatorTide + ${(scale * .9).toFixed(4)},
          uPollinatorTide + ${(scale * 1.5).toFixed(4)}, vPollinatorHeight);\n#include <alphahash_fragment>`);
  };
  material.customProgramCacheKey = () => 'ambient-pollinator-v1-' + scale;
  const entries = habitats.flatMap(district => {
    const local = flights.filter(f => f.district === district);
    if (!local.length) return [];
    const mesh = new THREE.InstancedMesh(geometry, material, local.length * 2);
    mesh.name = 'pollinator-wings-' + district;
    mesh.frustumCulled = false; // compact only close, visible flights below
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.visible = false;
    group.add(mesh);
    return [{ mesh, flights: local.map(flight => ({ flight, inRange: false })) }];
  });
  const dummy = new THREE.Object3D(), yaw = new THREE.Quaternion(), flap = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1);
  const bounds = new THREE.Sphere(), tint = new THREE.Color();
  const wind = sampleEnvironmentWind(0, island.seed);
  return {
    group,
    update(time: number, tide: number, daylight: number, rain: number, camera: THREE.Vector3, frustum: THREE.Frustum) {
      const activity = ambientFlightActivity(daylight, rain, 'pollinator');
      material.opacity = activity;
      tideUniform.value = tide;
      for (const entry of entries) {
        let count = 0;
        if (activity > .001) for (const state of entry.flights) {
          const f = state.flight;
          if (f.center.y < tide + .6 * scale) continue;
          bounds.center.set(f.center.x, f.center.y, f.center.z);
          bounds.radius = f.radius + .7 * scale;
          state.inRange = ambientInRange(bounds.center.distanceTo(camera) - bounds.radius,
            state.inRange, 55 * scale, 4 * scale);
          if (!state.inRange || !frustum.intersectsSphere(bounds)) continue;
          const a = time * 2 * Math.PI / f.period + f.phase;
          sampleEnvironmentWind(time, island.seed, rain, f.center.x, f.center.z, wind);
          // Small wind loading remains inside the existing clearance margin.
          const x = f.center.x + Math.cos(a) * f.radius + wind.x * .04 * scale;
          const z = f.center.z + Math.sin(a) * f.radius * .8 + wind.z * .04 * scale;
          const y = f.center.y + .24 * scale * Math.sin(a * 2 + f.phase);
          const heading = Math.atan2(-Math.sin(a), .8 * Math.cos(a));
          const wingAngle = .15 + .93 * (.5 + .5 * Math.sin(time * 32 + f.phase * 3));
          yaw.setFromAxisAngle(yAxis, heading);
          dummy.position.set(x, y, z); dummy.scale.setScalar(f.size);
          for (const angle of [wingAngle, Math.PI - wingAngle]) {
            flap.setFromAxisAngle(zAxis, angle);
            dummy.quaternion.copy(yaw).multiply(flap); dummy.updateMatrix();
            entry.mesh.setMatrixAt(count, dummy.matrix);
            entry.mesh.setColorAt(count++, tint.setHex(f.color));
          }
        }
        entry.mesh.count = count; entry.mesh.visible = count > 0;
        entry.mesh.instanceMatrix.needsUpdate = true;
        if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      for (const entry of entries) entry.mesh.dispose();
    },
  };
}
