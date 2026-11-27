import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData, Vec3 } from './types';
import { ambientFlightActivity, ambientInRange, sampleEnvironmentWind } from './environment-wind';
import { type GardenPatch, type InsectSpecies, type PollinatorFlight, planPollinators } from './insect-habitats';
import { applyAmbientDistanceFade } from './visual-wind';

export { planPollinators } from './insect-habitats';

const speciesList = ['butterfly', 'bee', 'dragonfly'] as const;
const wingProfiles = {
  butterfly: [
    [[.03, -.17], [.41, -.43], [.81, -.40], [1, -.22], [.91, .034], [.55, .19], [.06, .13]],
    [[.06, .02], [.48, .02], [.74, .19], [.70, .38], [.43, .48], [.20, .36], [.06, .21]],
  ],
  bee: [[[.04, -.10], [.34, -.37], [.69, -.26], [.82, -.06], [.67, .19], [.33, .20], [.04, .10]]],
  dragonfly: [
    [[.06, .16], [.53, .15], [.98, .34], [1.10, .47], [.94, .53], [.52, .43], [.06, .26]],
    [[.06, -.18], [.53, -.32], [1.05, -.19], [1.06, -.06], [.92, .02], [.50, -.02], [.06, -.08]],
  ],
} as const;

/** Curved wings have a painted rim around the coloured panel. Each half is
 * reused on the opposite hinge with a rotation, including in software. */
function wings(species: InsectSpecies): THREE.BufferGeometry {
  const vertices: number[] = [], colors: number[] = [];
  const light = new THREE.Color(species === 'butterfly' ? 0xffefd9 : 0xe4f5f5);
  const mid = new THREE.Color(species === 'butterfly' ? 0xd6a276 : 0xaecbd0);
  const rim = new THREE.Color(species === 'butterfly' ? 0x403047 : 0x617982);
  const push = (x: number, z: number, color: THREE.Color): void => {
    vertices.push(x, x * (.13 - x * .075), species === 'butterfly' ? -z : z);
    colors.push(color.r, color.g, color.b);
  };
  for (const contour of wingProfiles[species]) {
    const x = contour.reduce((sum, point) => sum + point[0], 0) / contour.length;
    const z = contour.reduce((sum, point) => sum + point[1], 0) / contour.length;
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i]!, b = contour[(i + 1) % contour.length]!;
      const ax = THREE.MathUtils.lerp(x, a[0], .78), az = THREE.MathUtils.lerp(z, a[1], .78);
      const bx = THREE.MathUtils.lerp(x, b[0], .78), bz = THREE.MathUtils.lerp(z, b[1], .78);
      push(x, z, light); push(ax, az, i % 3 ? light : mid); push(bx, bz, mid);
      push(ax, az, mid); push(a[0], a[1], rim); push(b[0], b[1], rim);
      push(ax, az, mid); push(b[0], b[1], rim); push(bx, bz, mid);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function body(species: InsectSpecies): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const sphere = (color: number, width: number, height: number, length: number,
    x: number, y: number, z: number, striped = false): void => {
    const geometry = new THREE.SphereGeometry(1, 8, striped ? 8 : 4).rotateX(Math.PI / 2);
    const positions = geometry.getAttribute('position'), colors: number[] = [];
    const paint = new THREE.Color(color), dark = new THREE.Color(0x443144);
    for (let i = 0; i < positions.count; i++) {
      const p = positions.getZ(i);
      const shade = striped && (Math.abs(p) < .05 || (p > .58 && p < .83)) ? dark : paint;
      colors.push(shade.r, shade.g, shade.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.scale(width, height, length).translate(x, y, z);
    pieces.push(geometry);
  };
  if (species === 'bee') {
    sphere(0xe0a13c, .24, .21, .41, 0, -.055, -.23, true);
    sphere(0x684141, .22, .17, .22, 0, 0, .11);
    sphere(0x4b3340, .177, .15, .17, 0, .025, .31);
  } else if (species === 'dragonfly') {
    sphere(0x23847e, .083, .073, .63, 0, -.025, -.38);
    sphere(0x56a8a0, .13, .115, .27, 0, 0, .08);
    for (const x of [-.082, .082]) sphere(0x273942, .10, .092, .113, x, .036, .31);
  } else {
    sphere(0x503248, .093, .075, .43, 0, -.014, -.12);
    sphere(0x462f44, .104, .095, .17, 0, .034, .23);
    for (const x of [-.071, .071]) sphere(0x403247, .024, .03, .139, x, .057, .39);
  }
  const geometry = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

function petalGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, .18, -.05, -.24, 0, -.4, .24, 0, -.5,
    0, .18, -.05, .24, 0, -.5, .47, .025, .02,
    0, .18, -.05, .47, .025, .02, 0, 0, .49,
    0, .18, -.05, 0, 0, .49, -.47, .02, .02,
    0, .18, -.05, -.47, .02, .02, -.24, 0, -.4,
  ], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(45).fill(1), 3));
  geometry.computeVertexNormals();
  return geometry;
}

interface FlightState {
  flight: PollinatorFlight;
  inRange: boolean;
  approached: boolean;
  startledAt: number;
  awayX: number;
  awayZ: number;
}

function startle(state: FlightState, time: number, player: Vec3, scale: number): void {
  const at = state.flight.center, dx = at.x - player.x, dz = at.z - player.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 3.25 * scale || Math.abs(player.y - at.y) > 2.4 * scale) state.approached = false;
  if (state.approached || distance > 2.12 * scale || Math.abs(player.y - at.y) > 1.8 * scale) return;
  state.approached = true;
  if (time - state.startledAt < 3) return;
  state.startledAt = time;
  state.awayX = distance > .01 ? dx / distance : Math.cos(state.flight.phase);
  state.awayZ = distance > .01 ? dz / distance : Math.sin(state.flight.phase);
}

export function buildPollinators(island: IslandData, gardens?: readonly GardenPatch[]) {
  const group = new THREE.Group();
  group.name = 'daytime-pollinators';
  const flights = planPollinators(island, gardens);
  if (!flights.length) return { group,
    update(_time: number, _tide: number, _daylight: number, _rain: number, _camera: THREE.Vector3,
      _frustum: THREE.Frustum, _player?: Vec3) {}, dispose() {} };

  const scale = island.size / 600;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  applyAmbientDistanceFade(material, 36 * scale, 48 * scale);
  const createBatch = (name: string, geometry: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };
  const batches = speciesList.flatMap(species => {
    const local = flights.filter(flight => flight.species === species);
    if (!local.length) return [];
    return [{ species, bodies: createBatch('insect-bodies-' + species, body(species), local.length),
      wings: createBatch('insect-wings-' + species, wings(species), local.length * 2),
      states: local.map(flight => ({ flight, inRange: false, approached: false,
        startledAt: -Infinity, awayX: 0, awayZ: 0 })) }];
  });
  const petals = createBatch('startled-flower-petals', petalGeometry(), flights.length * 4);
  const pose = new THREE.Object3D(), yaw = new THREE.Quaternion(), flap = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1);
  const bounds = new THREE.Sphere(), tint = new THREE.Color(), petalLight = new THREE.Color(0xffeadb);
  const wind = sampleEnvironmentWind(0, island.seed);
  const updateBatch = (mesh: THREE.InstancedMesh, count: number): void => {
    mesh.count = count;
    mesh.visible = count > 0;
    if (!count) return;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  return {
    group,
    update(time: number, tide: number, daylight: number, rain: number, camera: THREE.Vector3,
      frustum: THREE.Frustum, player?: Vec3) {
      const activity = ambientFlightActivity(daylight, rain, 'pollinator');
      material.opacity = activity;
      let petalCount = 0;
      for (const batch of batches) {
        let bodies = 0, wings = 0;
        if (activity > .001) for (const state of batch.states) {
          const f = state.flight;
          if (f.center.y < tide + .45 * scale) continue;
          bounds.center.set(f.center.x, f.center.y, f.center.z);
          bounds.radius = f.radius + 1.2 * scale;
          state.inRange = ambientInRange(bounds.center.distanceTo(camera) - bounds.radius,
            state.inRange, 48 * scale, 4 * scale);
          if (player && activity > .18) startle(state, time, player, scale);
          if (!state.inRange || !frustum.intersectsSphere(bounds)) continue;
          const age = time - state.startledAt;
          const response = age >= 0 && age < 1.8 ? Math.sin(Math.PI * Math.sqrt(age / 1.8)) ** 2 : 0;
          const cycle = time * 2 * Math.PI / f.period + f.phase;
          const travel = f.species === 'dragonfly' ? cycle + .3 * Math.sin(2 * cycle) : cycle;
          const lift = f.species === 'bee' ? .04 * Math.sin(2 * cycle) - .12 * (.5 + .5 * Math.cos(cycle)) ** 4
            : (f.species === 'dragonfly' ? .05 : .14) * Math.sin(2 * cycle + f.phase);
          sampleEnvironmentWind(time, island.seed, rain, f.center.x, f.center.z, wind);
          const x = f.center.x + Math.cos(travel) * f.radius + (.34 * response * state.awayX + wind.x * .035) * scale;
          const z = f.center.z + Math.sin(travel) * f.radius * .79 + (.34 * response * state.awayZ + wind.z * .035) * scale;
          const y = f.center.y + (lift + .52 * response) * scale;
          const heading = Math.atan2(-Math.sin(travel) + response * state.awayX,
            .79 * Math.cos(travel) + response * state.awayZ);
          yaw.setFromAxisAngle(yAxis, heading);
          pose.position.set(x, y, z);
          pose.scale.setScalar(f.size * Math.sqrt(activity));
          pose.quaternion.copy(yaw);
          pose.updateMatrix();
          batch.bodies.setMatrixAt(bodies++, pose.matrix);
          const beat = batch.species === 'butterfly' ? 20 : batch.species === 'bee' ? 39 : 48;
          const arc = batch.species === 'butterfly' ? .99 : .47;
          const angle = .16 + arc * (.5 + .5 * Math.sin(time * beat + f.phase * 3));
          tint.setHex(batch.species === 'butterfly' ? f.color : 0xf4f4ec);
          for (const hinge of [angle, Math.PI - angle]) {
            flap.setFromAxisAngle(zAxis, hinge);
            pose.quaternion.copy(yaw).multiply(flap);
            pose.updateMatrix();
            batch.wings.setMatrixAt(wings, pose.matrix);
            batch.wings.setColorAt(wings++, tint);
          }
          if (f.bloom && age < 1.4) for (let i = 0; i < 4; i++) {
            const fraction = (age - i * .085) / 1.08;
            if (fraction <= 0 || fraction >= 1) continue;
            const side = (i - 1.5) * .26, displacement = fraction * scale;
            pose.position.set(f.bloom.x + displacement * (wind.x * .48 + state.awayX * .69 - state.awayZ * side),
              f.bloom.y + (.48 * Math.sin(fraction * Math.PI) - fraction * .24) * scale,
              f.bloom.z + displacement * (wind.z * .48 + state.awayZ * .69 + state.awayX * side));
            pose.rotation.set(fraction * Math.PI + f.phase, f.phase + i + fraction, fraction * 3);
            pose.scale.setScalar(.13 * scale * activity * (1 - fraction * .7));
            pose.updateMatrix();
            petals.setMatrixAt(petalCount, pose.matrix);
            petals.setColorAt(petalCount++, tint.setHex(f.color).lerp(petalLight, .33));
          }
        }
        updateBatch(batch.bodies, bodies);
        updateBatch(batch.wings, wings);
      }
      updateBatch(petals, petalCount);
    },
    dispose() {
      for (const object of group.children) {
        const mesh = object as THREE.InstancedMesh;
        mesh.dispose();
        mesh.geometry.dispose();
      }
      material.dispose();
      group.clear();
    },
  };
}
