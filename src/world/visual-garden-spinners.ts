import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleEnvironmentWind } from './environment-wind';
import type { GardenPatch } from './insect-habitats';
import { capeSurface } from './lighthouse-access';
import { SeededRandom } from './random';
import type { IslandData, PoiId, Vec3 } from './types';
import { applyAmbientDistanceFade } from './visual-wind';

interface SpinnerSite {
  base: Vec3;
  height: number;
  yaw: number;
  phase: number;
}

function planSpinners(island: IslandData, gardens: readonly GardenPatch[]): SpinnerSite[] {
  const scale = island.size / 600;
  const rng = new SeededRandom(String(island.seed) + ':garden-spinners');
  const sites: SpinnerSite[] = [];
  const mount = (base: Vec3, height: number, facing: { x: number; z: number }): void => {
    sites.push({ base, height: height * scale, yaw: Math.atan2(facing.x - base.x, facing.z - base.z),
      phase: rng.range(0, Math.PI * 2) });
  };
  const farm = island.pois.find(poi => poi.id === 'hoofington');
  if (farm) for (const { position, radius } of gardens) {
    const x = position.x + Math.sign(position.x - farm.center.x) * radius * .48;
    const z = position.z + radius * .16;
    mount({ x, y: capeSurface(island, x, z) - .045 * scale, z },
      rng.range(1.06, 1.22), { x: farm.center.x, z: z + 2 * scale });
  }

  // A few planted accents by the café and court, and beside the promenade seating.
  const planterSites: [PoiId, number, number][] = [
    ['downtown-bleatsville', 12, -28], ['downtown-bleatsville', -17, -47],
    ['baa-ardwalk', 10, -18], ['baa-ardwalk', -10, 30],
  ];
  for (const [district, dx, dz] of planterSites) {
    const poi = island.pois.find(p => p.id === district);
    if (!poi) continue;
    const targetX = poi.center.x + dx * scale, targetZ = poi.center.z + dz * scale;
    let nearest = 14 * scale;
    let base: Vec3 | undefined;
    for (const planter of island.props) {
      if (planter.poiId !== district || planter.kind !== 'planter' || planter.body.type !== 'static') continue;
      const p = planter.transform.position;
      const distance = Math.hypot(p.x - targetX, p.z - targetZ);
      if (distance >= nearest || sites.some(site => Math.hypot(site.base.x - p.x, site.base.z - p.z) < 6 * scale)) continue;
      nearest = distance;
      base = { x: p.x, y: p.y + planter.size.y * .2, z: p.z };
    }
    if (base) mount(base, .94, { x: poi.center.x, z: base.z + 2 * scale });
  }
  return sites;
}

function rotorGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const cream = new THREE.Color(0xffedd5), shade = new THREE.Color(0x775657);
  const paint = new THREE.Color();
  const panels = [0xe67758, 0xf1bd60, 0x75b7a5, 0x8095c3];
  for (const [blade, hex] of panels.entries()) {
    const first = positions.length / 3;
    for (let step = 0; step <= 6; step++) {
      const t = step / 6, radius = .042 + .36 * t;
      const turn = blade * Math.PI / 2 + .71 * t;
      const halfWidth = .11 + .39 * Math.sin(Math.PI * t) + .15 * t;
      for (const side of [-1, 0, 1]) {
        const angle = turn + side * halfWidth;
        positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius,
          .039 * Math.sin(Math.PI * t) + side * .086 * t);
        paint.setHex(hex).lerp(side < 0 ? shade : cream, Math.abs(side) * .19 + t * .08);
        colors.push(paint.r, paint.g, paint.b);
      }
      if (!step) continue;
      for (let strip = 0; strip < 2; strip++) {
        const a = first + (step - 1) * 3 + strip;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
  }
  const panelsGeometry = new THREE.BufferGeometry();
  panelsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  panelsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  panelsGeometry.setIndex(indices);
  panelsGeometry.computeVertexNormals();
  const cap = new THREE.SphereGeometry(1, 10, 6).scale(.074, .074, .053).translate(0, 0, .028);
  cap.deleteAttribute('uv');
  const capColors = [];
  for (let i = 0; i < cap.getAttribute('position').count; i++) capColors.push(cream.r, cream.g, cream.b);
  cap.setAttribute('color', new THREE.Float32BufferAttribute(capColors, 3));
  const geometry = mergeGeometries([panelsGeometry, cap])!;
  panelsGeometry.dispose();
  cap.dispose();
  return geometry;
}

export function buildGardenSpinners(island: IslandData, gardens: readonly GardenPatch[]) {
  const group = new THREE.Group();
  group.name = 'garden-spinners';
  const sites = planSpinners(island, gardens);
  if (!sites.length) return { group,
    update(_time: number, _tide: number, _rain: number, _camera: THREE.Vector3, _frustum: THREE.Frustum) {},
    dispose() {} };
  const scale = island.size / 600;
  const wood = new THREE.MeshLambertMaterial({ color: 0x986448 });
  const painted = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  applyAmbientDistanceFade(wood, 41 * scale, 54 * scale);
  applyAmbientDistanceFade(painted, 41 * scale, 54 * scale);
  const stem = new THREE.CylinderGeometry(.025, .036, 1, 7).translate(0, .5, 0);
  const poles = new THREE.InstancedMesh(stem, wood, sites.length);
  const wheels = new THREE.InstancedMesh(rotorGeometry(), painted, sites.length);
  poles.name = 'pinwheel-stakes';
  wheels.name = 'pinwheel-rotors';
  for (const mesh of [poles, wheels]) {
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }
  const pose = new THREE.Object3D(), bounds = new THREE.Sphere();
  const wind = sampleEnvironmentWind(0, island.seed);
  return {
    group,
    update(time: number, tide: number, rain: number, camera: THREE.Vector3, frustum: THREE.Frustum) {
      let count = 0;
      for (const { base, yaw, height, phase } of sites) {
        const axle = base.y + height;
        if (axle <= tide + .42 * scale) continue;
        bounds.center.set(base.x, base.y + height * .6, base.z);
        bounds.radius = height * .7 + .45 * scale;
        if (camera.distanceTo(bounds.center) > 54 * scale + bounds.radius || !frustum.intersectsSphere(bounds)) continue;
        pose.position.copy(base);
        pose.rotation.set(0, 0, 0, 'YXZ');
        pose.scale.set(scale, height, scale);
        pose.updateMatrix();
        poles.setMatrixAt(count, pose.matrix);
        sampleEnvironmentWind(time, island.seed, rain, base.x, base.z, wind);
        // Integrate a periodic gust so the motion speeds up and eases continuously.
        const angle = phase + 2.6 * time - (1.1 * wind.strength / .73) *
          Math.cos(.73 * time + wind.phase * 1.7 + base.x * .047 - base.z * .033);
        pose.position.set(base.x + Math.sin(yaw) * .049 * scale, axle, base.z + Math.cos(yaw) * .049 * scale);
        pose.rotation.set(.08, yaw, -angle, 'YXZ');
        pose.scale.setScalar(scale);
        pose.updateMatrix();
        wheels.setMatrixAt(count++, pose.matrix);
      }
      for (const mesh of [poles, wheels]) {
        mesh.count = count;
        mesh.visible = count > 0;
        if (count) mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const mesh of [poles, wheels]) {
        mesh.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      group.clear();
    },
  };
}
