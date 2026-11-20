import * as THREE from 'three';
import { kitShape } from './kit-preview';
import { gridSample } from './terrain';
import type { IslandData, Vec2 } from './types';

const TURN = Math.PI * 2;
type BoatModel = 'harborSailboat' | 'harborFishingBoat';
interface Passage extends Vec2 {
  model: BoatModel;
  length: number;
  radiusX: number;
  radiusZ: number;
  period: number;
  phase: number;
}

/** Keep boats out of the swim routes, timber piles and offshore wreck. */
export function harborPassages(island: IslandData): Passage[] {
  const scale = island.size / 600;
  const pier = island.props.find(p => p.kind === 'pier' && p.poiId === 'baa-ardwalk');
  const cape = island.pois.find(p => p.id === 'old-lighthouse');
  const obstacles = island.props.filter(p => ['pier', 'dock', 'platform', 'shipwreck', 'scaffold'].includes(p.kind));
  const passages: Passage[] = [];
  const add = (center: Vec2, model: BoatModel, side: number,
    dx: number, dz: number, rx: number, rz: number, period: number, phase: number) => {
    const length = (model === 'harborSailboat' ? 7.4 : 7) * scale;
    for (const shift of [0, 7, 15, 24, 34]) {
      const x = center.x + (dx + side * shift) * scale, z = center.z + dz * scale;
      const radiusX = rx * scale, radiusZ = rz * scale;
      const clear = Array.from({ length: 32 }, (_, i) => i / 32 * TURN).every(angle => {
        const atX = x + Math.cos(angle) * radiusX, atZ = z + Math.sin(angle) * radiusZ;
        const room = length * .64;
        if (gridSample(island, atX, atZ) > island.seaLevel - 1.15 * scale) return false;
        return obstacles.every(p => {
          const { position, rotationY } = p.transform;
          const c = Math.cos(rotationY), s = Math.sin(rotationY);
          const u = atX - position.x, v = atZ - position.z;
          return Math.abs(u * c - v * s) > p.size.x / 2 + room ||
            Math.abs(u * s + v * c) > p.size.z / 2 + room;
        });
      });
      if (clear) { passages.push({ model, x, z, length, radiusX, radiusZ, period, phase }); return; }
    }
  };
  if (pier) {
    add(pier.transform.position, 'harborSailboat', -1, -34, 5, 7, 24, 86, .8);
    add(pier.transform.position, 'harborSailboat', 1, 35, 23, 8, 27, 105, 3.4);
  }
  if (cape) add(cape.center, 'harborFishingBoat', -1, -45, 30, 13, 17, 72, 4.8);
  return passages;
}

function boatWake(length: number): THREE.BufferGeometry {
  const points: number[] = [], colours: number[] = [];
  // Two thinning trails and a short wash immediately behind the stern.
  for (const side of [-1, 1]) {
    const a = [.09, -.38, .60], b = [.18, -.55, .47];
    const c = [.29, -.98, .22], d = [.37, -1.35, .04];
    for (const [x, z, alpha] of [a, b, c, b, d, c]) {
      points.push(side * x! * length, 0, z! * length);
      colours.push(.78, .92, .94, alpha!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  return geometry;
}

function gullWing(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const root = [0, 0, .17], elbow = [.43, .025, .14], trailing = [.36, -.035, -.23];
  const tip = [.77, -.015, -.13], shoulder = [.56, 0, .045];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    [...root, ...elbow, ...trailing, ...elbow, ...shoulder, ...trailing,
      ...shoulder, ...tip, ...trailing], 3));
  const light = new THREE.Color(0xdce5e6), dark = new THREE.Color(0x44586a);
  const colours = [...Array.from({ length: 6 }, () => light.toArray()).flat(),
    ...dark.toArray(), ...dark.toArray(), ...light.toArray()];
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

export function buildHarborLife(island: IslandData) {
  const group = new THREE.Group();
  group.name = 'harbor-life';
  const scale = island.size / 600;
  const boatMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const wakeMaterial = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, vertexColors: true, side: THREE.DoubleSide,
  });
  const boatGeometries = new Map<BoatModel, THREE.BufferGeometry>();
  const boats = harborPassages(island).map((route, i) => {
    let geometry = boatGeometries.get(route.model);
    if (!geometry) {
      geometry = kitShape(route.model);
      boatGeometries.set(route.model, geometry);
    }
    const boat = new THREE.Mesh(geometry, boatMaterial);
    boat.name = 'harbor-boat-' + i;
    boat.scale.setScalar(route.length);
    const wake = new THREE.Mesh(boatWake(route.length), wakeMaterial);
    wake.name = 'harbor-wake-' + i;
    wake.renderOrder = 4;
    const vessel = new THREE.Group();
    vessel.add(boat, wake);
    group.add(vessel);
    return { route, vessel, boat, wake };
  });

  const bodyGeometry = new THREE.SphereGeometry(1, 6, 4).scale(.12, .11, .32);
  const wingGeometry = gullWing();
  const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0xf0ede1 });
  const wingMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const flights = [
    { district: 'baa-ardwalk', x: -14, z: 64, radius: 29, height: 13, count: 5, period: 29 },
    { district: 'old-lighthouse', x: -20, z: 14, radius: 24, height: 23, count: 5, period: 33 },
  ] as const;
  const flocks = flights.flatMap(flight => {
    const shore = island.pois.find(p => p.id === flight.district);
    if (!shore) return [];
    // Follow the actual pier when the generator moves it out to meet the water.
    const pier = island.props.find(p => p.kind === 'pier' && p.poiId === flight.district);
    const at = pier?.transform.position ?? shore.center;
    const center = new THREE.Vector3(at.x + flight.x * scale,
      island.seaLevel + flight.height * scale, pier ? at.z + 8 * scale : at.z + flight.z * scale);
    const root = new THREE.Group();
    root.position.copy(center);
    root.name = flight.district + '-gulls';
    const body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, flight.count);
    const wing = new THREE.InstancedMesh(wingGeometry, wingMaterial, flight.count * 2);
    for (const mesh of [body, wing]) {
      mesh.frustumCulled = false; // One conservative flight-volume test below.
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(mesh);
    }
    group.add(root);
    return [{ root, body, wing, flight, bounds: new THREE.Sphere(center.clone(), (flight.radius + 15) * scale) }];
  });
  const bird = new THREE.Object3D(), feather = new THREE.Object3D(), matrix = new THREE.Matrix4();

  return {
    group,
    update(time: number, tide: number, daylight: number, rain: number,
      camera: THREE.Vector3, frustum: THREE.Frustum) {
      wakeMaterial.opacity = .22 + daylight * .56;
      for (const { route, vessel, boat, wake } of boats) {
        const theta = route.phase + time * TURN / route.period;
        vessel.position.set(route.x + route.radiusX * Math.cos(theta), tide,
          route.z + route.radiusZ * Math.sin(theta));
        vessel.visible = camera.distanceToSquared(vessel.position) < (215 * scale) ** 2;
        if (!vessel.visible) continue;
        const yaw = Math.atan2(-route.radiusX * Math.sin(theta), route.radiusZ * Math.cos(theta));
        vessel.rotation.y = yaw;
        boat.position.y = (-.30 + .105 * Math.sin(time * 1.85 + route.phase)) * scale;
        boat.rotation.set(.04 * Math.sin(time * 1.45), 0, .062 * Math.cos(time * 1.67 + route.phase));
        wake.position.y = .065 * scale;
      }
      for (const { root, body, wing, flight, bounds } of flocks) {
        root.position.y = Math.max(island.seaLevel + flight.height * scale, tide + 7 * scale);
        bounds.center.copy(root.position);
        root.visible = daylight > .20 && rain < .8 && camera.distanceToSquared(bounds.center) < (163 * scale) ** 2 &&
          frustum.intersectsSphere(bounds);
        if (!root.visible) continue;
        for (let i = 0; i < flight.count; i++) {
          const angle = time * TURN / flight.period + .21 * i + flight.height;
          const radius = (flight.radius + (i % 2 ? 2.1 : -1.8) * i) * scale;
          bird.position.set(radius * Math.cos(angle), (i * .49 + 1.8 * Math.sin(angle * 2 + i)) * scale,
            radius * .68 * Math.sin(angle));
          bird.scale.setScalar(scale * (.88 + i * .078));
          bird.rotation.set(.06 * Math.sin(angle * 2), Math.atan2(-Math.sin(angle), .68 * Math.cos(angle)), -.18);
          bird.updateMatrix();
          body.setMatrixAt(i, bird.matrix);
          const glide = THREE.MathUtils.smoothstep(Math.sin(angle + i * .81), -.2, .75);
          const flap = (.15 + .68 * glide) * Math.sin(time * 10.6 + i * .81);
          for (let side = 0; side < 2; side++) {
            feather.position.x = side === 0 ? .09 : -.09;
            feather.rotation.set(0, side * Math.PI, flap + .12);
            feather.updateMatrix();
            wing.setMatrixAt(i * 2 + side, matrix.multiplyMatrices(bird.matrix, feather.matrix));
          }
        }
        body.instanceMatrix.needsUpdate = true;
        wing.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const { body, wing } of flocks) { body.dispose(); wing.dispose(); }
    },
  };
}
