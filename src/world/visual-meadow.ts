import { downtownPublicSpaceAt, downtownPublicSpaces } from './downtown-public-space';
import { roadsideGravelAt, roadsideStops } from './roadside-stops';
import * as THREE from 'three';
import { paintNatureKit } from './plant-palette';
import type { skyUniforms } from './visual-sky';
import { kitShape } from './kit-preview';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData } from './types';
import { BIOMES } from './types';
import { hashString, SeededRandom } from './random';
import { gridIndex, gridSample, segmentProjection } from './terrain';
import { makeLocalStreets } from './roads';
import { CRANE_YARD_PLAN } from './crane-yard';
import { loadGroundedKitGeometry } from './library-props';
import { TOON_RAMP } from './visual-props';

const GRASS_CLUMP_PATH = 'assets/library/custom/hoofington-props/grass-clump.glb';

interface Sprig {
  x: number;
  y: number;
  z: number;
  size: number;
}

/**
 * The sculpted terrain supplies broad colour; these small, non-interactive
 * tufts and daisies supply the readable foreground detail of the paintings.
 * Already collidable grass, flowers, crates and hay remain in island.props.
 * No extra rigid bodies are created for tiny cosmetic details.
 */
export function buildMeadowScatter(island: IslandData, sky?: ReturnType<typeof skyUniforms>,
  pavedAt?: (x: number, z: number) => boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-meadow-and-wildflowers';
  const rng = new SeededRandom(String(island.seed) + ':storybook-meadow');
  const scale = island.size / 600;
  const grasses: Sprig[] = [], flowers: Sprig[] = [];
  const limit = Math.min(3500, Math.round(1900 * scale));
  const sites = island.pois.filter(p => p.id !== 'mt-gigga' && p.id !== 'the-dam');
  const architecture = island.props.filter(p =>
    ['house', 'barn', 'shop', 'booth', 'kiosk-icecream', 'kiosk-popcorn',
      'kiosk-games', 'kiosk-prizes', 'kiosk-candy',
      'cottage', 'control-house', 'windmill'].includes(p.kind));
  const downtown = island.pois.find(p => p.id === 'downtown-bleatsville')?.center;
  const downtownPaving = downtown ? downtownPublicSpaces(island) : [];
  const craneYard = island.pois.find(p => p.id === 'crane-yard')?.center;
  const roadSamples = [...island.roads, ...makeLocalStreets(island)].flatMap(road =>
    road.points.map(point => ({
      x: point.x, z: point.z, margin: road.width * 0.5 + 3.4 * scale,
    })));

  // Keep the working surfaces and access aisles of the placed scenery clear.
  const yardClearings = (island.districtSets ?? []).flatMap(set => set.pieces.map(piece => ({
    x: piece.bottom.x, z: piece.bottom.z, radius: (piece.length * .72 + .5 * scale) ** 2,
  })));
  const approaches = (island.districtSets ?? []).map(set => set.approach);
  const roadside = roadsideStops(island);
  function outsideObstacles(x: number, z: number): boolean {
    if (pavedAt?.(x, z) || roadsideGravelAt(roadside, x, z)) return false;
    if (approaches.some(path => segmentProjection({ x, z }, path.from, path.to).distance < 1.25 * scale)) return false;
    if (yardClearings.some(yard => (x - yard.x) ** 2 + (z - yard.z) ** 2 < yard.radius)) return false;
    for (const road of roadSamples) {
      const dx = x - road.x, dz = z - road.z;
      if (dx * dx + dz * dz < road.margin * road.margin) return false;
    }
    if (downtown) {
      if (downtownPublicSpaceAt(downtownPaving, x, z, .45 * scale)) return false;
      const dx = x - downtown.x, dz = z - downtown.z;
      if (dx * dx + dz * dz < (38 * scale) ** 2) return false;
    }
    if (craneYard &&
        Math.abs(x - craneYard.x) < CRANE_YARD_PLAN.halfWidth * scale &&
        Math.abs(z - craneYard.z) < CRANE_YARD_PLAN.halfDepth * scale) return false;
    for (const building of architecture) {
      const p = building.transform.position;
      const dx = x - p.x, dz = z - p.z;
      const radius = Math.hypot(building.size.x, building.size.z) * 0.53 + 1.5 * scale;
      if (dx * dx + dz * dz < radius * radius) return false;
    }
    return true;
  }

  for (let attempt = 0; attempt < limit * 15 &&
      grasses.length < limit; attempt++) {
    let x: number, z: number;
    if (rng.next() < 0.42) {
      // More flowers around farmyards and homes, with plenty of greenery
      // beyond Hoofington: each district remains visibly part of the island.
      const site = sites[Math.floor(rng.next() * sites.length)]!;
      const radius = Math.sqrt(rng.next()) * site.radius * 1.65;
      const angle = rng.range(0, Math.PI * 2);
      x = site.center.x + Math.cos(angle) * radius;
      z = site.center.z + Math.sin(angle) * radius;
    } else {
      x = rng.range(-island.size * 0.46, island.size * 0.46);
      z = rng.range(-island.size * 0.46, island.size * 0.46);
    }
    const ix = Math.min(island.resolution - 1, Math.max(0,
      Math.round((x / island.size + 0.5) * (island.resolution - 1))));
    const iz = Math.min(island.resolution - 1, Math.max(0,
      Math.round((z / island.size + 0.5) * (island.resolution - 1))));
    const biome = BIOMES[island.biomeMap[gridIndex(island.resolution, ix, iz)]!]!;
    if (!['meadow', 'farmland', 'town', 'pine-forest', 'highlands'].includes(biome)) continue;
    const y = gridSample(island, x, z);
    if (y < 2.5 * scale || y > 89 * scale) continue;
    const dx = gridSample(island, x + 0.75 * scale, z) -
      gridSample(island, x - 0.75 * scale, z);
    const dz = gridSample(island, x, z + 0.75 * scale) -
      gridSample(island, x, z - 0.75 * scale);
    if (Math.hypot(dx, dz) > 0.83 * scale) continue;
    if (!outsideObstacles(x, z)) continue;
    // Advance the old tint draw so existing seeds keep the same placements.
    rng.next();
    const sample: Sprig = {
      x, y: y + 0.03 * scale, z,
      size: rng.range(0.52, 1.25) * scale,
    };
    grasses.push(sample);
    if (rng.next() < (biome === 'farmland' || biome === 'meadow' ? 0.22 : 0.09)) {
      flowers.push({ ...sample, size: sample.size * 0.8 });
    }
  }

  // Wildflowers grow in drifts along the clear meadow, not at identical
  // intervals. Keep the original budget and check each offshoot on the ground.
  const seeds = flowers.splice(0);
  for (let i = 0; i < seeds.length; i += 3) {
    const root = seeds[i]!;
    flowers.push(root);
    for (let j = 1; j <= 3 && flowers.length < seeds.length; j++) {
      const angle = hashString(root.x + ':petal:' + j) / 4294967296 * Math.PI * 2;
      const offset = (.58 + j * .43) * scale;
      const x = root.x + Math.sin(angle) * offset, z = root.z + Math.cos(angle) * offset;
      const y = gridSample(island, x, z) + .03 * scale;
      if (Math.abs(y - root.y) < offset * .38 && y > island.seaLevel + .4 && outsideObstacles(x,z))
        flowers.push({ x, y, z, size: root.size * (1 - .08 * j) });
    }
    if (flowers.length >= seeds.length) break;
  }
  const tuft = kitShape('grassClump', true);
  const blossom = kitShape('meadowFlower');
  paintNatureKit(blossom);
  const flowerScale = .74 / blossom.boundingBox!.getSize(new THREE.Vector3()).y;
  blossom.scale(flowerScale, flowerScale, flowerScale);

  const transform = new THREE.Matrix4(), position = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), scaling = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  function instances(geometry: THREE.BufferGeometry, samples: Sprig[],
    name: string, material: THREE.MeshToonMaterial, clumps = false): THREE.InstancedMesh {
    if (sky) material.onBeforeCompile = shader => {
      shader.uniforms['uWind'] = sky.uWind;
      shader.uniforms['uCover'] = sky.uCover;
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nuniform vec2 uWind; uniform float uCover;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 base = instanceMatrix[3].xz;
        float gust = sin(dot(base,vec2(.14,.08)) + uWind.x*2200.0);
        vec2 wind = vec2(.84,-.36) * (.12 + .19*uCover) * (.55+.45*gust);
        transformed.xz += vec2(dot(normalize(instanceMatrix[0].xz),wind),
          dot(normalize(instanceMatrix[2].xz),wind)) * position.y*position.y;`);
    };
    const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    for (let i = 0; i < samples.length; i++) {
      const item = samples[i]!;
      position.set(item.x, item.y, item.z);
      const seedYaw = rng.range(0, Math.PI * 2);
      const key = item.x.toFixed(4) + ':' + item.z.toFixed(4);
      scaling.setScalar(clumps ? .8 + .5 * hashString(key + ':size') / 4294967296 : item.size);
      rotation.setFromAxisAngle(axis, clumps ? Math.PI * 2 * hashString(key + ':yaw') / 4294967296 : seedYaw);
      transform.compose(position, rotation, scaling);
      mesh.setMatrixAt(i, transform);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  }
  const grassMesh = instances(tuft, grasses, 'meadow-grass-sprigs',
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_RAMP, side: THREE.DoubleSide }), true);
  const flowersMesh = instances(blossom, flowers, 'meadow-daisy-flowers',
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_RAMP }));

  // Use the library's native-metre colour baker (also used for clouds), not
  // the prop baker's normalized 0.98-m envelope. The GLB already has nine
  // painted closed blades and must remain one draw with no per-instance tint.
  if (typeof document !== 'undefined') {
    const loader = new GLTFLoader();
    let disposed = false;
    (grassMesh.material as THREE.Material).addEventListener('dispose', () => { disposed = true; });
    void loadGroundedKitGeometry(GRASS_CLUMP_PATH, loader).then(clump => {
      if (disposed) { clump.dispose(); return; }
      grassMesh.geometry = clump;
      grassMesh.instanceMatrix.needsUpdate = true;
      grassMesh.computeBoundingSphere();
      tuft.dispose();
    }).catch(() => {
      // A missing/corrupt GLB must never break the scene or hide its fallback.
    });
    void loadGroundedKitGeometry('assets/library/kenney/nature-kit/flower_yellowA.glb', loader).then(geometry => {
      if (disposed) { geometry.dispose(); return; }
      paintNatureKit(geometry);
      const h = geometry.boundingBox!.max.y - geometry.boundingBox!.min.y;
      geometry.scale(.74 / h, .74 / h, .74 / h);
      flowersMesh.geometry = geometry;
      flowersMesh.computeBoundingSphere();
      blossom.dispose();
    }).catch(() => { /* Retain the small blossom if the kit is unavailable. */ });
  }
  return group;
}
