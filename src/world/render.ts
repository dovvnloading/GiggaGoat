import * as THREE from 'three';
import type { Biome, IslandData, PropDescriptor, PropKind } from './types';
import { BIOMES } from './types';
import { clamp } from './random';
import { gridCoordinate, gridIndex } from './terrain';

export interface WorldSceneOptions {
  /** Grid segments per independently culled terrain mesh; default 32. */
  chunkSegments?: number;
  /** Furthest chunk distance in metres. */
  cullingDistance?: number;
}
export interface WorldScene {
  group: THREE.Group;
  chunks: THREE.Mesh[];
  water: THREE.Mesh;
  sun: THREE.DirectionalLight;
  /** Day progresses 0..1; 0.25 is sunrise and 0.5 is midday. */
  setDayNight(phase: number): void;
  setTideLevel(level: number): void;
  updateCulling(camera: THREE.Camera): void;
  dispose(): void;
}

const PALETTE: Record<Biome, number> = {
  ocean: 0x50a7bf, beach: 0xf4dc94, meadow: 0x8fd266,
  farmland: 0xc2cf73, town: 0xcbd8bc, industrial: 0xc0bbae,
  'pine-forest': 0x4f9f75, highlands: 0x96ae79, cliff: 0x9da1a9,
  freshwater: 0x55b7cf,
};
const PROP_COLORS: Record<PropKind, number> = {
  barn: 0xe66b64, house: 0xf5d889, shop: 0x96d4e7, tower: 0xabb7ca,
  windmill: 0xf9f1d7, lighthouse: 0xf4e7cc, 'ferris-wheel': 0xf9a1bc,
  crane: 0xffd051, scaffold: 0xd4ad65, beam: 0xffc44e,
  pier: 0xa57f5a, deck: 0xb68a66, bumper: 0xe38ce2,
  booth: 0xf7a07e, 'satellite-dish': 0xdce5e8, 'dam-wall': 0xabb3bb,
  fence: 0xe5c587, 'hay-bale': 0xf5d15c, crate: 0xc4915f,
  barrel: 0xe67d5d, 'tree-pine': 0x438d5d, 'tree-oak': 0x72af54,
  rock: 0x969ba7, log: 0x8f6b4b, lamp: 0xffe5b7,
  ramp: 0xe5b974, ledge: 0xbbb5aa, bridge: 0xb28f6a,
  bench: 0x8c714e, sign: 0xf6e3c2, flag: 0xf66e95, buoy: 0xf79a4e,
  platform: 0xc9b08c,
};

function rampGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
    -0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([
    0, 2, 1, 1, 2, 3, // base
    2, 4, 3, 3, 4, 5, // high end
    0, 1, 4, 1, 5, 4, // slope
    0, 4, 2, 1, 3, 5, // sides
  ]);
  geometry.computeVertexNormals();
  return geometry;
}
function primitiveFor(kind: PropKind): THREE.BufferGeometry {
  if (kind === 'ramp') return rampGeometry();
  if (kind === 'ferris-wheel') return new THREE.TorusGeometry(0.5, 0.033, 5, 28);
  if (kind === 'rock') return new THREE.IcosahedronGeometry(0.67, 0);
  if (kind === 'tree-pine') return new THREE.ConeGeometry(0.5, 1, 5);
  if (kind === 'tree-oak') return new THREE.DodecahedronGeometry(0.62, 0);
  if (kind === 'flag') return new THREE.ConeGeometry(0.5, 1, 3);
  if (['windmill', 'lighthouse', 'crane', 'lamp', 'scaffold', 'satellite-dish',
    'hay-bale', 'barrel', 'bumper', 'log', 'buoy'].includes(kind)) {
    return new THREE.CylinderGeometry(0.5, 0.5, 1, 7, 1);
  }
  return new THREE.BoxGeometry(1, 1, 1);
}

interface Chunk {
  mesh: THREE.Mesh;
  sphere: THREE.Sphere;
}

function buildTerrain(island: IslandData, chunkSegments: number): Chunk[] {
  const n = island.resolution;
  const chunks: Chunk[] = [];
  const color = new THREE.Color();
  for (let startZ = 0; startZ < n - 1; startZ += chunkSegments) {
    for (let startX = 0; startX < n - 1; startX += chunkSegments) {
      const countX = Math.min(chunkSegments, n - 1 - startX);
      const countZ = Math.min(chunkSegments, n - 1 - startZ);
      const cx = gridCoordinate(island.size, n, startX + countX / 2);
      const cz = gridCoordinate(island.size, n, startZ + countZ / 2);
      const positions: number[] = [], colors: number[] = [], indices: number[] = [];
      let lowest = Infinity, highest = -Infinity;
      for (let z = 0; z <= countZ; z++) for (let x = 0; x <= countX; x++) {
        const ix = startX + x, iz = startZ + z;
        const index = gridIndex(n, ix, iz);
        const h = island.heights[index]!;
        lowest = Math.min(lowest, h); highest = Math.max(highest, h);
        positions.push(gridCoordinate(island.size, n, ix) - cx, h,
          gridCoordinate(island.size, n, iz) - cz);
        const biome = BIOMES[island.biomeMap[index]!] ?? 'meadow';
        color.setHex(PALETTE[biome]);
        // Small height tint keeps steep faces legible from a distance.
        const tint = 0.88 + clamp(h / 250, 0, 0.13);
        colors.push(color.r * tint, color.g * tint, color.b * tint);
      }
      const stride = countX + 1;
      for (let z = 0; z < countZ; z++) for (let x = 0; x < countX; x++) {
        const a = z * stride + x, b = a + 1, c = a + stride, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
        vertexColors: true, side: THREE.FrontSide, flatShading: true,
      }));
      mesh.position.set(cx, 0, cz);
      mesh.receiveShadow = true;
      mesh.userData['terrainChunk'] = true;
      const spanX = countX * island.size / (n - 1), spanZ = countZ * island.size / (n - 1);
      const sphere = new THREE.Sphere(new THREE.Vector3(cx, (lowest + highest) / 2, cz),
        Math.hypot(spanX / 2, spanZ / 2, (highest - lowest) / 2) + 4);
      chunks.push({ mesh, sphere });
    }
  }
  return chunks;
}

function addInstances(group: THREE.Group, props: readonly PropDescriptor[]): void {
  const sets = new Map<PropKind, PropDescriptor[]>();
  for (const p of props) {
    const list = sets.get(p.kind) ?? [];
    list.push(p);
    sets.set(p.kind, list);
  }
  const dummy = new THREE.Object3D();
  for (const [kind, entries] of sets) {
    const geometry = primitiveFor(kind);
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff, flatShading: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    const color = new THREE.Color();
    mesh.name = 'props-' + kind;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const { position, rotationY } = entry.transform;
      dummy.position.set(position.x, position.y, position.z);
      dummy.rotation.set(0, rotationY, 0);
      dummy.scale.set(entry.size.x, entry.size.y,
        kind === 'ferris-wheel' ? 1 : entry.size.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.setHex(entry.color ?? PROP_COLORS[kind]);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Bright, flat, walkable roof caps make the urban parkour language immediately clear.
  const roofs = props.filter(p => ['barn', 'house', 'shop', 'tower', 'booth'].includes(p.kind));
  if (roofs.length) {
    const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), roofs.length);
    for (let i = 0; i < roofs.length; i++) {
      const p = roofs[i]!;
      dummy.position.set(p.transform.position.x,
        p.transform.position.y + p.size.y / 2 + 0.09, p.transform.position.z);
      dummy.rotation.set(0, p.transform.rotationY, 0);
      dummy.scale.set(p.size.x + 0.22, 0.18, p.size.z + 0.22);
      dummy.updateMatrix();
      cap.setMatrixAt(i, dummy.matrix);
      cap.setColorAt(i, new THREE.Color(p.kind === 'barn' ? 0x8c4850 : 0xedeadf));
    }
    cap.name = 'walkable-roof-accents';
    cap.instanceMatrix.needsUpdate = true;
    group.add(cap);
  }
}

function buildRoads(island: IslandData): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  const base = new THREE.Vector3(0, 0, 1);
  const direction = new THREE.Vector3(), midpoint = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), matrix = new THREE.Matrix4(), size = new THREE.Vector3();
  for (const type of ['road', 'trail'] as const) {
    const segments = island.roads.filter(r => r.type === type)
      .flatMap(r => r.points.slice(1).map((b, i) => ({ a: r.points[i]!, b, width: r.width })));
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: type === 'road' ? 0x6f8094 : 0xc3a577 }),
      segments.length);
    for (let i = 0; i < segments.length; i++) {
      const { a, b, width } = segments[i]!;
      direction.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const length = direction.length();
      if (length < 1e-7) continue;
      quaternion.setFromUnitVectors(base, direction.normalize());
      midpoint.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.12, (a.z + b.z) / 2);
      size.set(width, 0.15, length + 0.25);
      matrix.compose(midpoint, quaternion, size);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.name = 'paths-' + type;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return meshes;
}

function buildRivers(island: IslandData): THREE.Group {
  const water = new THREE.Group();
  const vertices: number[] = [], indices: number[] = [];
  for (let i = 0; i < island.river.length; i++) {
    const p = island.river[i]!;
    const before = island.river[Math.max(0, i - 1)]!;
    const after = island.river[Math.min(island.river.length - 1, i + 1)]!;
    const dx = after.x - before.x, dz = after.z - before.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length, nz = dx / length;
    vertices.push(p.x - nx * p.width / 2, p.level + 0.08, p.z - nz * p.width / 2);
    vertices.push(p.x + nx * p.width / 2, p.level + 0.08, p.z + nz * p.width / 2);
    if (i > 0) {
      const offset = i * 2;
      indices.push(offset - 2, offset - 1, offset, offset - 1, offset + 1, offset);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  water.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0x59c7db, transparent: true, opacity: 0.87, side: THREE.DoubleSide,
  })));
  const reservoir = island.reservoir;
  const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ color: 0x62c5de, transparent: true, opacity: 0.84, side: THREE.DoubleSide }));
  lake.position.set(reservoir.center.x, reservoir.level + 0.09, reservoir.center.z);
  lake.rotation.x = -Math.PI / 2;
  lake.scale.set(reservoir.radiusX, reservoir.radiusZ, 1);
  water.add(lake);
  return water;
}

function buildSky(): { mesh: THREE.Mesh; uniforms: { uDay: { value: number }; uSun: { value: THREE.Vector3 } } } {
  const uniforms = { uDay: { value: 1 }, uSun: { value: new THREE.Vector3(0, 1, 0) } };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide, depthWrite: false,
      vertexShader: [
        'varying vec3 vDirection;',
        'void main() { vDirection = normalize(position);',
        'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      ].join('\n'),
      fragmentShader: [
        'uniform float uDay; uniform vec3 uSun; varying vec3 vDirection;',
        'void main() {',
        '  float h = smoothstep(-0.18, 0.83, normalize(vDirection).y);',
        '  vec3 day = mix(vec3(0.98, 0.77, 0.54), vec3(0.24, 0.61, 0.92), h);',
        '  vec3 night = mix(vec3(0.17, 0.18, 0.35), vec3(0.019, 0.042, 0.13), h);',
        '  float halo = pow(max(dot(normalize(vDirection), normalize(uSun)), 0.0), 160.0);',
        '  gl_FragColor = vec4(mix(night, day, uDay) + vec3(1.0, 0.84, 0.53) * halo * uDay, 1.0);',
        '}',
      ].join('\n'),
    }));
  mesh.frustumCulled = false;
  mesh.name = 'gradient-sky';
  return { mesh, uniforms };
}

/** Renderer-only scene construction; never creates a Rapier body or requires WebGL until rendered. */
export function createWorldScene(island: IslandData, options: WorldSceneOptions = {}): WorldScene {
  const group = new THREE.Group();
  group.name = 'Billy Isle';
  const chunks = buildTerrain(island, Math.max(4, Math.floor(options.chunkSegments ?? 32)));
  for (const chunk of chunks) group.add(chunk.mesh);
  const roads = buildRoads(island);
  roads.forEach(mesh => group.add(mesh));
  addInstances(group, island.props);
  const river = buildRivers(island);
  group.add(river);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(island.size * 1.65, island.size * 1.65),
    new THREE.MeshPhongMaterial({
      color: 0x43b8d4, shininess: 62, transparent: true, opacity: 0.73,
      depthWrite: false, side: THREE.DoubleSide,
    }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = island.seaLevel;
  water.name = 'rising-sea';
  group.add(water);

  const { mesh: sky, uniforms } = buildSky();
  group.add(sky);
  const sun = new THREE.DirectionalLight(0xfff6d7, 1.5);
  sun.position.set(230, 400, -140);
  sun.castShadow = false;
  group.add(sun);
  const hemisphere = new THREE.HemisphereLight(0xd8efff, 0x61764a, 1.2);
  group.add(hemisphere);
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
  const cullingDistance = options.cullingDistance ?? island.size * 0.82;
  const renderChunks = chunks.map(c => c.mesh);

  function setDayNight(phase: number): void {
    const angle = phase * Math.PI * 2 - Math.PI / 2;
    const altitude = Math.sin(angle);
    const day = clamp(altitude * 1.6 + 0.36, 0.04, 1);
    sun.position.set(Math.cos(angle) * 500, altitude * 500, -180);
    sun.intensity = 0.08 + day * 1.6;
    hemisphere.intensity = 0.23 + day * 1.08;
    uniforms.uDay.value = day;
    uniforms.uSun.value.copy(sun.position).normalize();
  }
  function setTideLevel(level: number): void {
    water.position.y = level;
    river.visible = level < island.reservoir.level + 2;
  }
  function updateCulling(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    for (const chunk of chunks) {
      chunk.mesh.visible = frustum.intersectsSphere(chunk.sphere) &&
        chunk.sphere.center.distanceTo(camera.position) < cullingDistance + chunk.sphere.radius;
    }
  }
  function dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.forEach(m => materials.add(m));
      }
    });
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    group.removeFromParent();
  }
  setDayNight(0.5);
  return { group, chunks: renderChunks, water, sun, setDayNight, setTideLevel, updateCulling, dispose };
}
