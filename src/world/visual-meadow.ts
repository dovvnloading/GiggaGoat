import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData } from './types';
import { BIOMES } from './types';
import { hashString, SeededRandom } from './random';
import { gridIndex, gridSample } from './terrain';
import { makeLocalStreets } from './roads';
import { CRANE_YARD_PLAN } from './crane-yard';
import { bakeLibraryCloudGeometry } from './library-props';
import { publicAssetUrl } from './public-assets';
import { TOON_RAMP } from './visual-props';

const GRASS_CLUMP_PATH = 'assets/library/custom/hoofington-props/grass-clump.glb';

interface Sprig {
  x: number;
  y: number;
  z: number;
  size: number;
  color: number;
}

/**
 * The sculpted terrain supplies broad colour; these small, non-interactive
 * tufts and daisies supply the readable foreground detail of the paintings.
 * Already collidable grass, flowers, crates and hay remain in island.props.
 * No extra rigid bodies are created for tiny cosmetic details.
 */
export function buildMeadowScatter(island: IslandData): THREE.Group {
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
  const craneYard = island.pois.find(p => p.id === 'crane-yard')?.center;
  const roadSamples = [...island.roads, ...makeLocalStreets(island)].flatMap(road =>
    road.points.map(point => ({
      x: point.x, z: point.z, margin: road.width * 0.5 + 3.4 * scale,
    })));

  function outsideObstacles(x: number, z: number): boolean {
    for (const road of roadSamples) {
      const dx = x - road.x, dz = z - road.z;
      if (dx * dx + dz * dz < road.margin * road.margin) return false;
    }
    if (downtown) {
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
    const color = [0x84bf59, 0x9bcc6b, 0xb5d681, 0x6eac54][
      Math.floor(rng.next() * 4)]!;
    const sample: Sprig = {
      x, y: y + 0.03 * scale, z,
      size: rng.range(0.52, 1.25) * scale, color,
    };
    grasses.push(sample);
    if (rng.next() < (biome === 'farmland' || biome === 'meadow' ? 0.22 : 0.09)) {
      flowers.push({ ...sample, size: sample.size * 0.8 });
    }
  }

  // Preserve the original two-octahedron tuft, its RNG transforms and tints
  // while the painted grass-clump GLB loads. Flowers remain unchanged.
  const leafParts: THREE.BufferGeometry[] = [
    new THREE.OctahedronGeometry(0.2, 0),
    new THREE.OctahedronGeometry(0.15, 0),
  ];
  leafParts[0]!.scale(1.35, 0.5, 1.35);
  leafParts[0]!.translate(0, 0.1, 0);
  leafParts[1]!.scale(1.3, 0.55, 1.3);
  leafParts[1]!.translate(0.14, 0.08, -0.06);
  const tuft = mergeGeometries(leafParts, false);
  leafParts.forEach(p => p.dispose());
  if (!tuft) throw new Error('Failed to assemble meadow tufts');

  const flowerParts: THREE.BufferGeometry[] = [];
  const petals: number[] = [];
  function flowerPart(geometry: THREE.BufferGeometry, color: number): void {
    // Cylinders are indexed, icosahedra are not. Merge requires one topology.
    const unpacked = geometry.index ? geometry.toNonIndexed() : geometry;
    if (unpacked !== geometry) geometry.dispose();
    const vertices = unpacked.getAttribute('position').count;
    const tint = new THREE.Color(color);
    for (let i = 0; i < vertices; i++) petals.push(tint.r, tint.g, tint.b);
    flowerParts.push(unpacked);
  }
  const stalk = new THREE.CylinderGeometry(0.021, 0.035, 0.63, 5);
  stalk.translate(0, 0.31, 0);
  flowerPart(stalk, 0x4a9b56);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * i / 3;
    const petal = new THREE.IcosahedronGeometry(0.12, 0);
    petal.scale(1, 0.63, 0.9);
    petal.translate(Math.cos(a) * 0.13, 0.67, Math.sin(a) * 0.13);
    flowerPart(petal, i % 2 ? 0xfff9e5 : 0xffcfdf);
  }
  const centre = new THREE.IcosahedronGeometry(0.105, 0);
  centre.translate(0, 0.68, 0);
  flowerPart(centre, 0xffd64c);
  const blossom = mergeGeometries(flowerParts, false);
  flowerParts.forEach(p => p.dispose());
  if (!blossom) throw new Error('Failed to assemble wildflowers');
  blossom.setAttribute('color', new THREE.Float32BufferAttribute(petals, 3));

  const transform = new THREE.Matrix4(), position = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), scaling = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  function instances(geometry: THREE.BufferGeometry, samples: Sprig[],
    name: string, material: THREE.MeshToonMaterial, instanceTint: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    for (let i = 0; i < samples.length; i++) {
      const item = samples[i]!;
      position.set(item.x, item.y, item.z);
      scaling.setScalar(item.size);
      rotation.setFromAxisAngle(axis, rng.range(0, Math.PI * 2));
      transform.compose(position, rotation, scaling);
      mesh.setMatrixAt(i, transform);
      if (instanceTint) mesh.setColorAt(i, new THREE.Color(item.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  }
  const grassMesh = instances(tuft, grasses, 'meadow-grass-sprigs',
    new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: TOON_RAMP }), true);
  instances(blossom, flowers, 'meadow-daisy-flowers',
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_RAMP }), false);

  // Use the library's native-metre colour baker (also used for clouds), not
  // the prop baker's normalized 0.98-m envelope. The GLB already has nine
  // painted closed blades and must remain one draw with no per-instance tint.
  if (typeof document !== 'undefined') {
    const loader = new GLTFLoader();
    void loader.loadAsync(publicAssetUrl(GRASS_CLUMP_PATH)).then(gltf => {
      let clump: THREE.BufferGeometry | null = null;
      try {
        clump = bakeLibraryCloudGeometry(gltf.scene);
      } finally {
        // The baked geometry owns its vertices/paint, not the transient GLTF.
        gltf.scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        });
      }
      if (!clump) return; // Invalid model: retain the visible procedural tufts.

      const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
      const turn = new THREE.Quaternion(), uniform = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < grasses.length; i++) {
        const sprig = grasses[i]!;
        const key = sprig.x.toFixed(4) + ':' + sprig.z.toFixed(4);
        // Two independent position hashes; never advance the placement RNG.
        const size = 0.8 + 0.5 * (hashString(key + ':size') / 4294967296);
        const yaw = Math.PI * 2 * (hashString(key + ':yaw') / 4294967296);
        point.set(sprig.x, sprig.y, sprig.z);
        turn.setFromAxisAngle(up, yaw);
        uniform.setScalar(size);
        matrix.compose(point, turn, uniform);
        grassMesh.setMatrixAt(i, matrix);
      }
      grassMesh.geometry = clump;
      grassMesh.instanceColor = null;
      const material = grassMesh.material as THREE.MeshToonMaterial;
      material.vertexColors = true;
      material.needsUpdate = true;
      grassMesh.instanceMatrix.needsUpdate = true;
      grassMesh.computeBoundingSphere();
      tuft.dispose();
    }).catch(() => {
      // A missing/corrupt GLB must never break the scene or hide its fallback.
    });
  }
  return group;
}
