import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData, PropDescriptor } from './types';
import { gridSample } from './terrain';
import { publicAssetUrl } from './public-assets';
import { buildArchitecture } from './visual-architecture';
import { TOON_RAMP } from './visual-props';

export interface LighthouseVisuals {
  group: THREE.Group;
  update(seconds: number): void;
  dispose(): void;
}

interface Placement {
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  yaw?: number; pitch?: number; roll?: number;
}

const STONE = 0xa7a8af;
const WOOD = 0x97603d;
const DARK_WOOD = 0x63432e;
const CREAM = 0xf6e6c5;
const GOLD = 0xffcf56;

/** Merge all painted parts into one vertex-coloured mesh per landmark. */
function makePainter() {
  const painted: THREE.BufferGeometry[] = [];
  function add(geometry: THREE.BufferGeometry, color: number, at: Placement): void {
    const unpacked = geometry.index ? geometry.toNonIndexed() : geometry;
    if (unpacked !== geometry) geometry.dispose();
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(at.x, at.y, at.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        at.pitch ?? 0, at.yaw ?? 0, at.roll ?? 0, 'YXZ',
      )),
      new THREE.Vector3(at.width, at.height, at.depth),
    );
    unpacked.applyMatrix4(transform);
    unpacked.computeVertexNormals();
    const paint = new THREE.Color(color);
    const count = unpacked.getAttribute('position').count;
    const vertexColors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      vertexColors[i * 3] = paint.r;
      vertexColors[i * 3 + 1] = paint.g;
      vertexColors[i * 3 + 2] = paint.b;
    }
    unpacked.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
    painted.push(unpacked);
  }
  function box(color: number, x: number, y: number, z: number,
    width: number, height: number, depth: number,
    yaw = 0, roll = 0): void {
    add(new THREE.BoxGeometry(1, 1, 1), color,
      { x, y, z, width, height, depth, yaw, roll });
  }
  function beam(color: number, from: THREE.Vector3, to: THREE.Vector3,
    radius: number): void {
    const direction = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 6);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), direction.normalize(),
    ));
    add(geometry, color, {
      x: (from.x + to.x) / 2, y: (from.y + to.y) / 2,
      z: (from.z + to.z) / 2, width: 1, height: 1, depth: 1,
    });
  }
  function finish(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const geometry = mergeGeometries(painted, false);
    painted.forEach(part => part.dispose());
    if (!geometry) throw new Error('Cannot batch lighthouse landmark ' + name);
    const material = new THREE.MeshToonMaterial({
      color: 0xffffff, side: THREE.DoubleSide, vertexColors: true,
      gradientMap: TOON_RAMP,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name + '-merged-colours';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    return group;
  }
  return { add, box, beam, finish };
}

/** A strip conforming to the heightfield: decorative, not a false flat collider. */
function makeWindingFootpath(island: IslandData, center: { x: number; z: number }): THREE.Mesh {
  const scale = island.size / 600;
  const knots = [
    [-30, 21], [-23, 25], [-15, 23], [-8, 18],
    [1, 15], [5, 9], [-1, 5],
  ];
  const curve = new THREE.CatmullRomCurve3(knots.map(([dx, dz]) =>
    new THREE.Vector3(center.x + dx! * scale, 0, center.z + dz! * scale)), false, 'centripetal');
  const vertices: number[] = [], indices: number[] = [];
  for (let i = 0; i <= 72; i++) {
    const t = i / 72;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const nx = tangent.z, nz = -tangent.x;
    const width = (1.7 + Math.sin(t * Math.PI) * 0.35) * scale;
    for (const side of [-1, 1]) {
      const x = point.x + side * nx * width;
      const z = point.z + side * nz * width;
      vertices.push(x, gridSample(island, x, z) + 0.16 * scale, z);
    }
    if (i > 0) {
      const k = i * 2;
      indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: 0xbe9864, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'lighthouse-winding-dirt-path';
  return mesh;
}

function makeCottage(prop: PropDescriptor): THREE.Group {
  const architecture = buildArchitecture('cottage');
  // Recolour the cottage's baked roof-vertex colours without changing the
  // shared Hoofington cottage or compromising the architectural detail mesh.
  const color = architecture.details.getAttribute('color') as THREE.BufferAttribute;
  const oldRoof = new THREE.Color(0xcf7056);
  const oldHighlight = new THREE.Color(0xe5916f);
  const red = new THREE.Color(0xbc483b), tile = new THREE.Color(0xe36c51);
  for (let i = 0; i < color.count; i++) {
    const actual = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i));
    const roofDelta = Math.abs(actual.r - oldRoof.r) +
      Math.abs(actual.g - oldRoof.g) + Math.abs(actual.b - oldRoof.b);
    const tileDelta = Math.abs(actual.r - oldHighlight.r) +
      Math.abs(actual.g - oldHighlight.g) + Math.abs(actual.b - oldHighlight.b);
    if (roofDelta < 0.004) color.setXYZ(i, red.r, red.g, red.b);
    if (tileDelta < 0.004) color.setXYZ(i, tile.r, tile.g, tile.b);
  }
  color.needsUpdate = true;
  const cottage = new THREE.Group();
  cottage.name = 'lighthouse-keeper-cottage';
  cottage.position.set(prop.transform.position.x,
    prop.transform.position.y, prop.transform.position.z);
  cottage.rotation.y = prop.transform.rotationY;
  cottage.scale.set(prop.size.x, prop.size.y, prop.size.z);
  const walls = new THREE.Mesh(architecture.shell, new THREE.MeshToonMaterial({
    color: prop.color ?? CREAM, vertexColors: true, gradientMap: TOON_RAMP,
  }));
  const details = new THREE.Mesh(architecture.details, new THREE.MeshToonMaterial({
    color: 0xffffff, vertexColors: true, gradientMap: TOON_RAMP,
  }));
  walls.name = 'keeper-cottage-plaster';
  details.name = 'keeper-cottage-red-tiled-gable';
  // The shared instanced cottage already participates in the cached shadow pass.
  walls.castShadow = false;
  details.receiveShadow = true;
  cottage.add(walls, details);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.37, 0.033),
    new THREE.MeshToonMaterial({ color: 0x4382a1 }));
  door.name = 'keeper-cottage-blue-door';
  door.position.set(0, -0.305, 0.44);
  cottage.add(door);
  // Emissive panes are unlit surfaces, so no expensive point lights or shadows.
  const windows = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.135, 0.19, 0.011),
    new THREE.MeshBasicMaterial({ color: 0xffd77b }), 2);
  windows.name = 'keeper-cottage-lit-windows';
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 2; i++) {
    dummy.position.set(i ? 0.286 : -0.286, -0.08, 0.455);
    dummy.updateMatrix();
    windows.setMatrixAt(i, dummy.matrix);
  }
  windows.instanceMatrix.needsUpdate = true;
  windows.computeBoundingSphere();
  cottage.add(windows);
  return cottage;
}

function makeSeaCave(island: IslandData, cave: PropDescriptor): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighthouse-recessed-sea-cave';
  const p = cave.transform.position, s = cave.size;
  const floor = p.y - s.y / 2;
  group.position.set(p.x, floor, p.z);
  group.rotation.y = cave.transform.rotationY;
  const stone = makePainter();
  const wall = STONE, roof = 0x92949c, interior = 0x48505d;
  // Local +Z is the open sea-facing entrance, local -Z the Rapier back wall.
  // The two deeply extending jambs and a roof make an actual recess rather
  // than a painted black slab closing the mouth.
  stone.box(wall, -s.x * 0.41, s.y * 0.36, 0,
    s.x * 0.20, s.y * 0.72, s.z * 1.07);
  stone.box(wall, s.x * 0.41, s.y * 0.36, 0,
    s.x * 0.20, s.y * 0.72, s.z * 1.07);
  stone.box(roof, 0, s.y * 0.84, 0, s.x * 1.08, s.y * 0.32, s.z * 1.12);
  stone.box(interior, 0, s.y * 0.34, -s.z * 0.46,
    s.x * 0.65, s.y * 0.68, s.z * 0.11);
  // Side walls recede into the cliff; only the rear is dark.
  stone.box(0x737780, -s.x * 0.30, s.y * 0.34, -s.z * 0.18,
    s.x * 0.07, s.y * 0.62, s.z * 0.50);
  stone.box(0x737780, s.x * 0.30, s.y * 0.34, -s.z * 0.18,
    s.x * 0.07, s.y * 0.62, s.z * 0.50);
  group.add(stone.finish('sea-cave-stone-arch'));

  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({
      color: 0xa8a8b0, flatShading: true, side: THREE.DoubleSide,
      emissive: 0x33353b, emissiveIntensity: 0.35,
    }), 13);
  rocks.name = 'lighthouse-cave-sunlit-arch-boulders';
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 13; i++) {
    const a = (i / 12) * Math.PI;
    dummy.position.set(
      Math.cos(a) * s.x * 0.47,
      s.y * (0.47 + Math.sin(a) * 0.47),
      s.z * 0.47 + Math.sin(i * 2.3) * 0.25,
    );
    dummy.rotation.set(0.12 * i, i * 0.63, 0.1 * Math.sin(i));
    dummy.scale.set(s.x * 0.145, s.y * 0.15, s.z * 0.24);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  const secret = island.relics.find(relic =>
    relic.poiId === 'old-lighthouse' && relic.hint.includes('Inside the sea cave'));
  if (secret) {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 1.1, 0.48, 10),
      new THREE.MeshToonMaterial({ color: 0x99959b, gradientMap: TOON_RAMP }));
    pedestal.name = 'lighthouse-relic-plinth';
    pedestal.position.set(secret.position.x, secret.position.y - 0.7,
      secret.position.z);
    group.parent?.add(pedestal);
    // This object is attached in world coordinates after group placement.
    const statue = makePainter();
    const x = secret.position.x, y = secret.position.y - 0.38, z = secret.position.z;
    statue.add(new THREE.DodecahedronGeometry(1, 0), GOLD,
      { x, y: y + 0.57, z, width: 0.88, height: 0.53, depth: 0.49 });
    statue.add(new THREE.DodecahedronGeometry(1, 0), GOLD,
      { x: x + 0.36, y: y + 0.91, z, width: 0.36, height: 0.39, depth: 0.36 });
    for (const dx of [-0.26, 0.25]) for (const dz of [-0.18, 0.18]) {
      statue.box(GOLD, x + dx, y + 0.20, z + dz, 0.12, 0.42, 0.12);
    }
    for (const dz of [-0.14, 0.14]) {
      statue.add(new THREE.ConeGeometry(0.09, 0.32, 6), GOLD,
        { x: x + 0.41, y: y + 1.24, z: z + dz,
          width: 1, height: 1, depth: 1, roll: dz > 0 ? -0.28 : 0.28 });
    }
    const gold = statue.finish('lighthouse-golden-goat-relic');
    gold.traverse(part => {
      if (part instanceof THREE.Mesh) {
        part.material = new THREE.MeshBasicMaterial({ color: GOLD });
      }
    });
    // The world builder lifts these out to world space below.
    gold.userData['worldSpaceRelic'] = true;
    pedestal.userData['worldSpaceRelic'] = true;
    group.add(gold, pedestal);
  }
  return group;
}

/** The library's static GLBs are normalized once and repeated as GPU instances. */
function instantiateLibraryModel(root: THREE.Object3D, placements: readonly Placement[],
  name: string, rock: boolean): THREE.Group {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const span = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(span.x) || Math.min(span.x, span.y, span.z) < 0.0001) {
    throw new Error('Empty or degenerate library model: ' + name);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const normalize = new THREE.Matrix4()
    .makeScale(1 / span.x, 1 / span.y, 1 / span.z)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const group = new THREE.Group();
  group.name = name;
  const dummy = new THREE.Object3D();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(normalize.clone().multiply(object.matrixWorld));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const material = rock
      ? new THREE.MeshLambertMaterial({
        color: STONE, side: THREE.DoubleSide, flatShading: true,
        emissive: 0x303238, emissiveIntensity: 0.33,
      }) : object.material;
    const instanced = new THREE.InstancedMesh(geometry, material, placements.length);
    instanced.name = name + '-instanced-part';
    instanced.castShadow = false;
    instanced.receiveShadow = false;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]!;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0, 'YXZ');
      dummy.scale.set(p.width, p.height, p.depth);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    group.add(instanced);
  });
  return group;
}

function makeFallbackRocks(placements: readonly Placement[]): THREE.InstancedMesh {
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  geometry.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({
    color: 0xadb0b4, side: THREE.DoubleSide, flatShading: true,
    emissive: 0x36383b, emissiveIntensity: 0.4,
  }), placements.length);
  mesh.name = 'lighthouse-fallback-grey-rocks';
  const dummy = new THREE.Object3D();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.y + p.height * 0.5, p.z);
    dummy.rotation.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
    dummy.scale.set(p.width * 0.52, p.height * 0.52, p.depth * 0.52);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function makeFlowers(island: IslandData, center: { x: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighthouse-grass-and-wildflowers';
  const scale = island.size / 600;
  const dummy = new THREE.Object3D();
  const grass = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.6, 1.5, 5),
    new THREE.MeshToonMaterial({ color: 0x619b40, gradientMap: TOON_RAMP }), 32);
  const flowers = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.28, 0),
    new THREE.MeshBasicMaterial({ color: 0xffe7c0 }), 32);
  for (let i = 0; i < 32; i++) {
    const angle = i * 2.399963 + 0.2;
    const r = (10 + (i % 4) * 2.9) * scale;
    const x = center.x + Math.cos(angle) * r;
    const z = center.z + Math.sin(angle) * r;
    const ground = gridSample(island, x, z);
    dummy.position.set(x, ground + 0.45 * scale, z);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.setScalar(0.63 * scale);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + 0.4 * scale, ground + 0.7 * scale, z);
    dummy.scale.setScalar((i % 3 === 0 ? 1 : 0.7) * scale);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
  }
  for (const mesh of [grass, flowers]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

export function buildLighthouseVisuals(island: IslandData): LighthouseVisuals {
  const group = new THREE.Group();
  group.name = 'old-lighthouse-hero';
  const center = island.pois.find(p => p.id === 'old-lighthouse')!.center;
  const scale = island.size / 600;
  const local = (dx: number, dz: number): { x: number; z: number } =>
    ({ x: center.x + dx * scale, z: center.z + dz * scale });
  const get = (kind: string): PropDescriptor | undefined =>
    island.props.find(prop => prop.poiId === 'old-lighthouse' && prop.kind === kind);

  group.add(makeWindingFootpath(island, center));
  const cottage = get('cottage');
  if (cottage) group.add(makeCottage(cottage));
  group.add(makeFlowers(island, center));

  const lighthouse = get('lighthouse');
  if (lighthouse) {
    const base = lighthouse.transform.position.y - lighthouse.size.y / 2;
    const y = base + lighthouse.size.y * 0.765;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(
      1.7 * scale, 1.7 * scale, 3.6 * scale, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffd776, transparent: true, opacity: 0.88, depthWrite: false,
    }));
    glass.name = 'lighthouse-glowing-lantern-room';
    glass.position.set(lighthouse.transform.position.x, y, lighthouse.transform.position.z);
    group.add(glass);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(5.6 * scale, 19 * scale, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffdd7e, transparent: true, opacity: 0.085,
        side: THREE.DoubleSide, depthWrite: false,
      }));
    beam.name = 'lighthouse-soft-beacon-glow';
    beam.rotation.z = Math.PI / 2;
    beam.position.set(glass.position.x + 9 * scale, y, glass.position.z);
    group.add(beam);
  }

  const cave = get('cave-mouth');
  if (cave) {
    const seaCave = makeSeaCave(island, cave);
    // Cave masonry is in cave-local coordinates; treasure is in world space.
    for (const item of [...seaCave.children]) {
      if (item.userData['worldSpaceRelic']) {
        seaCave.remove(item);
        group.add(item);
      }
    }
    group.add(seaCave);
  }

  const dock = island.props.filter(prop =>
    prop.poiId === 'old-lighthouse' && prop.kind === 'dock');
  const dockFallback = makePainter();
  const pierDetails = makePainter();
  const docks: Placement[] = [];
  for (const prop of dock) {
    const { x, y, z } = prop.transform.position;
    const { x: sx, y: sy, z: sz } = prop.size;
    const top = y + sy / 2;
    docks.push({
      x, y: y - sy / 2, z, width: sx, height: sy, depth: sz,
      yaw: prop.transform.rotationY,
    });
    dockFallback.box(WOOD, x, y, z, sx, sy * 0.72, sz);
    for (let i = 0; i < 8; i++) {
      dockFallback.box(i % 3 ? WOOD : 0xb58057,
        x - sx * 0.42 + i * sx * 0.12, top + 0.08 * scale, z,
        sx * 0.11, 0.14 * scale, sz * 0.97);
    }
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const px = x + side * sx * 0.44, pz = z + end * sz * 0.44;
      pierDetails.box(DARK_WOOD, px, 0.83 * scale, pz,
        0.65 * scale, 4.3 * scale, 0.65 * scale);
      pierDetails.box(WOOD, px, top + 0.53 * scale, pz,
        0.78 * scale, 1.35 * scale, 0.78 * scale);
    }
  }
  const pierFallbackGroup = dockFallback.finish('lighthouse-planked-dock-fallback');
  group.add(pierFallbackGroup, pierDetails.finish('lighthouse-dock-piles'));
  const bollards = makePainter();
  const lanterns: Placement[] = [];
  for (const [dx, dz] of [[19, 24], [31, 34], [-11, 13]]) {
    const p = local(dx!, dz!);
    const onDock = dx! > 0;
    const ground = onDock ? 2.7 * scale : gridSample(island, p.x, p.z);
    bollards.box(DARK_WOOD, p.x, ground + 1.25 * scale, p.z,
      0.26 * scale, 2.5 * scale, 0.26 * scale);
    bollards.box(0xffd989, p.x, ground + 2.67 * scale, p.z,
      0.76 * scale, 0.84 * scale, 0.76 * scale);
    bollards.box(DARK_WOOD, p.x, ground + 3.11 * scale, p.z,
      1.0 * scale, 0.15 * scale, 1.0 * scale);
    lanterns.push({
      x: p.x, y: ground + 2.20 * scale, z: p.z,
      width: 1.25 * scale, height: 1.5 * scale, depth: 1.25 * scale,
    });
  }
  group.add(bollards.finish('lighthouse-warm-pier-lantern-posts'));

  // The life ring is a separate silhouette mounted to the outer pier rail.
  const ringPos = local(32, 32);
  const ring = new THREE.Group();
  ring.name = 'lighthouse-red-white-life-ring';
  ring.position.set(ringPos.x, 3.95 * scale, ringPos.z);
  ring.rotation.y = 0.45;
  const redMat = new THREE.MeshToonMaterial({ color: 0xcf554a });
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(0.65 * scale, 0.13 * scale, 8, 28), redMat));
  const striped = makePainter();
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    const arc = new THREE.TorusGeometry(0.65 * scale, 0.145 * scale,
      6, 5, Math.PI / 5);
    arc.rotateZ(angle - Math.PI / 10);
    striped.add(arc, CREAM, { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 });
  }
  ring.add(striped.finish('lighthouse-life-ring-white-stripes'));
  group.add(ring);

  const row = local(37, 37);
  const rowY = -0.30 * scale;
  const boatPlacement: Placement[] = [{
    x: row.x, y: rowY, z: row.z,
    width: 7.5 * scale, height: 2.3 * scale, depth: 3.8 * scale,
    yaw: -0.55,
  }];
  const boatFallback = makePainter();
  boatFallback.box(WOOD, row.x, rowY + 0.55 * scale, row.z,
    6.6 * scale, 1.2 * scale, 3.3 * scale, -0.55);
  boatFallback.box(DARK_WOOD, row.x, rowY + 1.16 * scale, row.z,
    6.3 * scale, 0.16 * scale, 3.4 * scale, -0.55);
  const boatFallbackGroup = boatFallback.finish('lighthouse-rowboat-fallback');
  group.add(boatFallbackGroup);

  const wreck = get('shipwreck');
  const wreckFallback = makePainter();
  const wreckPlacement: Placement[] = [];
  const mastPlacement: Placement[] = [];
  if (wreck) {
    const p = wreck.transform.position;
    const base = Math.max(-1.5 * scale, p.y - wreck.size.y / 2);
    wreckPlacement.push({
      x: p.x, y: base, z: p.z,
      width: wreck.size.x, height: wreck.size.y * 1.45,
      depth: wreck.size.z, yaw: wreck.transform.rotationY,
      roll: -0.22,
    });
    wreckFallback.box(DARK_WOOD, p.x, base + 1.0 * scale, p.z,
      19 * scale, 2.5 * scale, 6.9 * scale, wreck.transform.rotationY, -0.16);
    for (let i = 0; i < 7; i++) {
      const xx = p.x + (i - 3) * 2.3 * scale;
      wreckFallback.box(i % 2 ? WOOD : 0xba8658, xx, base + 2.0 * scale,
        p.z, 0.25 * scale, 3.5 * scale, 7.3 * scale,
        wreck.transform.rotationY, -0.12);
    }
    const mast = local(-35, 7);
    mastPlacement.push({
      x: mast.x + 2.8 * scale, y: base + 2 * scale, z: mast.z,
      width: 2.7 * scale, height: 15 * scale, depth: 2.7 * scale,
      yaw: -0.18, roll: 0.44,
    });
    wreckFallback.beam(DARK_WOOD,
      new THREE.Vector3(p.x + 3 * scale, base + 1.8 * scale, p.z),
      new THREE.Vector3(p.x - 1 * scale, base + 15 * scale, p.z + 0.7 * scale),
      0.25 * scale);
    wreckFallback.add(new THREE.PlaneGeometry(6.2 * scale, 6.6 * scale), CREAM, {
      x: p.x + 0.7 * scale, y: base + 9 * scale, z: p.z,
      width: 1, height: 1, depth: 1, roll: -0.34,
    });
  }
  const wreckFallbackGroup = wreckFallback.finish('lighthouse-leaning-shipwreck-fallback');
  group.add(wreckFallbackGroup);

  const rocksFromProps = island.props.filter(p =>
    p.poiId === 'old-lighthouse' && p.kind === 'rock');
  const rocks: Placement[] = rocksFromProps.map(p => ({
    x: p.transform.position.x,
    y: p.transform.position.y - p.size.y / 2,
    z: p.transform.position.z,
    width: p.size.x * 1.18, height: p.size.y,
    depth: p.size.z * 1.18, yaw: p.transform.rotationY,
  }));
  // Shore boulders below the grass line, excluding the accessible cave floor.
  for (let i = 0; i < 16; i++) {
    const angle = i * 2.399963 + 0.65;
    const r = (28.0 + (i % 4) * 2.5) * scale;
    const x = center.x + Math.cos(angle) * r;
    const z = center.z + Math.sin(angle) * r;
    if (Math.hypot(x - (center.x + 2 * scale),
      z - (center.z + 23 * scale)) < 8 * scale) continue;
    const size = (3.2 + (i % 3) * 1.15) * scale;
    const ground = gridSample(island, x, z);
    rocks.push({
      x, y: Math.max(-1.8 * scale, ground - size * 0.12), z,
      width: size * 1.3, height: size, depth: size,
      yaw: angle, roll: Math.sin(i) * 0.18,
    });
  }
  const rockFallback = makeFallbackRocks(rocks);
  group.add(rockFallback);

  let disposed = false;
  const importedTextures = new Set<THREE.Texture>();
  function load(path: string, placements: readonly Placement[], name: string,
    hide?: THREE.Object3D, isRock = false): void {
    if (typeof document === 'undefined' || placements.length === 0) return;
    const url = publicAssetUrl('assets/library/' + path);
    try {
      new GLTFLoader().load(url, gltf => {
        if (disposed) return;
        try {
          const model = instantiateLibraryModel(gltf.scene, placements, name, isRock);
          if (model.children.length === 0) throw new Error('Empty GLB');
          model.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            const mats = Array.isArray(object.material) ? object.material : [object.material];
            for (const mat of mats) {
              const textured = mat as THREE.MeshStandardMaterial;
              if (textured.map) importedTextures.add(textured.map);
            }
          });
          group.add(model);
          if (hide) hide.visible = false;
        } catch (error) {
          console.warn('Lighthouse asset could not be prepared: ' + url, error);
        }
      }, undefined, error => {
        if (!disposed) console.warn('Lighthouse asset unavailable, using fallback: ' + url, error);
      });
    } catch (error) {
      console.warn('Lighthouse asset unavailable, using fallback: ' + url, error);
    }
  }

  // Use the packs named in the library README. Instancing prevents a draw call
  // for each rock, pier segment, pile or lantern across the hero composition.
  load('kenney/pirate-kit/ship-wreck.glb', wreckPlacement,
    'lighthouse-pirate-kit-shipwreck', wreckFallbackGroup);
  load('kenney/pirate-kit/mast-ropes.glb', mastPlacement,
    'lighthouse-broken-ship-mast');
  load('kenney/pirate-kit/structure-platform-dock.glb', docks,
    'lighthouse-pirate-kit-dock', pierFallbackGroup);
  load('kenney/watercraft-kit/boat-row-small.glb', boatPlacement,
    'lighthouse-watercraft-kit-rowboat', boatFallbackGroup);
  load('kenney/fantasy-town-kit/lantern.glb', lanterns,
    'lighthouse-library-lanterns');
  const even = rocks.filter((_, i) => i % 2 === 0);
  const odd = rocks.filter((_, i) => i % 2 !== 0);
  let rocksLoaded = 0;
  // Keep the grey procedural rocks if either source model is unavailable.
  function loadRock(path: string, positions: Placement[], name: string): void {
    if (typeof document === 'undefined') return;
    const url = publicAssetUrl('assets/library/' + path);
    try {
      new GLTFLoader().load(url, gltf => {
        if (disposed) return;
        try {
          const model = instantiateLibraryModel(gltf.scene, positions, name, true);
          if (!model.children.length) throw new Error('Empty rock GLB');
          group.add(model);
          if (++rocksLoaded === 2) rockFallback.visible = false;
        } catch (error) {
          console.warn('Rock GLB could not be prepared: ' + url, error);
        }
      }, undefined, error => {
        if (!disposed) console.warn('Rock GLB unavailable: ' + url, error);
      });
    } catch (error) {
      console.warn('Rock GLB unavailable: ' + url, error);
    }
  }
  loadRock('kenney/pirate-kit/rocks-a.glb', even, 'lighthouse-pirate-kit-grey-rocks-a');
  loadRock('kenney/nature-kit/rock_largeA.glb', odd, 'lighthouse-nature-kit-grey-rocks-b');

  return {
    group,
    update(seconds: number): void {
      // The warm lantern lens is a static emissive volume, never a shadow pass.
      const beacon = group.getObjectByName('lighthouse-soft-beacon-glow');
      if (beacon) beacon.rotation.y = Math.max(0, seconds) * 0.12;
    },
    dispose(): void {
      disposed = true;
      importedTextures.forEach(texture => texture.dispose());
      // All geometry/materials are released by WorldScene.dispose's traversal.
    },
  };
}
