// Repack the existing CC0 Car Kit. Preserve moving parts up close and bake a
// single simplified silhouette for each distant vehicle. Run from the repo root.
import fs from 'node:fs';
import { AnimationMixer, Matrix4, Quaternion, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptSimplifier } from 'meshoptimizer';

const source = 'public/assets/library/kenney/car-kit/';
const output = 'public/assets/island-traffic/fleet.glb';
const models = [
  'delivery',
  'van',
  'taxi',
  'tractor',
  'firetruck',
  'garbage-truck',
  'ambulance',
  'sedan-sports',
  'hatchback-sports',
  'suv',
  'truck',
];
const slots = [
  'base',
  'coachwork',
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'windscreen',
  'driver',
];
const gltf = {
  asset: { version: '2.0', generator: 'GiggaGoat Car Kit fleet' },
  scene: 0,
  scenes: [{ nodes: [] }],
  nodes: [],
  meshes: [],
  materials: slots.map((name) => ({
    name,
    pbrMetallicRoughness: {
      baseColorTexture: { index: name === 'driver' ? 1 : 0 },
      metallicFactor: 0,
      roughnessFactor: 0.79,
    },
  })),
  textures: [{ source: 0 }, { source: 1 }],
  images: ['car-kit', 'mini-characters'].map((kit) => ({
    uri: '../library/kenney/' + kit + '/Textures/colormap.png',
  })),
  accessors: [],
  bufferViews: [],
  buffers: [],
};
const chunks = [];
let size = 0;
function accessor(array, type, components, componentType, extra = {}) {
  const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  gltf.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: data.length });
  const padding = Buffer.alloc((4 - (data.length % 4)) % 4);
  chunks.push(data, padding);
  size += data.length + padding.length;
  return (
    gltf.accessors.push({
      type,
      componentType,
      count: array.length / components,
      bufferView: gltf.bufferViews.length - 1,
      ...extra,
    }) - 1
  );
}
const sourceMeshes = new Map();
function geometry(positions, normals, uv, groups) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((n, i) => {
    const axis = i % 3;
    min[axis] = Math.min(min[axis], n);
    max[axis] = Math.max(max[axis], n);
  });
  const attributes = {
    POSITION: accessor(new Float32Array(positions), 'VEC3', 3, 5126, { min, max }),
    NORMAL: accessor(new Float32Array(normals), 'VEC3', 3, 5126),
    TEXCOORD_0: accessor(
      Uint16Array.from(uv, (n) => Math.round(Math.max(0, Math.min(1, n)) * 65535)),
      'VEC2',
      2,
      5123,
      { normalized: true }
    ),
  };
  return (
    gltf.meshes.push({
      primitives: groups.flatMap((faces, material) =>
        faces.length
          ? [{ attributes, indices: accessor(new Uint16Array(faces), 'SCALAR', 1, 5123), material }]
          : []
      ),
    }) - 1
  );
}
function parse(bytes) {
  const n = bytes.readUInt32LE(12),
    doc = JSON.parse(bytes.subarray(20, 20 + n)),
    bin = bytes.subarray(28 + n);
  function read(index) {
    const a = doc.accessors[index],
      view = doc.bufferViews[a.bufferView];
    const channels = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
    const bytes = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4,
      stride = view.byteStride ?? channels * bytes;
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return Array.from({ length: a.count * channels }, (_, i) => {
      const offset = start + Math.floor(i / channels) * stride + (i % channels) * bytes;
      return a.componentType === 5126
        ? bin.readFloatLE(offset)
        : bytes === 1
          ? bin.readUInt8(offset)
          : bytes === 2
            ? bin.readUInt16LE(offset)
            : bin.readUInt32LE(offset);
    });
  }
  return { doc, read };
}
function classify(model, part, u, v, x, y, z) {
  if (part !== 'body') return 0;
  // These palette swatches belong to the manufacturer's actual moulded lamp faces.
  if (v > 0.73 && z > 0.45 && Math.abs(u - 0.219) < 0.008) return x > 0 ? 2 : 3;
  if (v > 0.73 && z < -0.45 && Math.abs(u - 0.344) < 0.008) return x > 0 ? 4 : 5;
  if (model === 'tractor' && v > 0.74 && Math.abs(u - 0.094) < 0.008 && y < 0.67 && z > 0.77)
    return x > 0 ? 2 : 3;
  if (Math.abs(u - 0.094) < 0.008 && v > 0.74 && y > 0.55) return 6;
  if (
    model === 'delivery' &&
    ((Math.abs(u - 0.844) < 0.008 && v >= 0.5 && v < 0.75) ||
      (Math.abs(u - 0.469) < 0.008 && v >= 0.25 && v < 0.5))
  )
    return 1;
  if (model === 'van' && Math.abs(u - 0.969) < 0.008 && v < 0.52) return 1;
  return 0;
}
await MeshoptSimplifier.ready;
const drivers = new Map();
async function driverMesh(model) {
  if (drivers.has(model)) return drivers.get(model);
  const loader = new GLTFLoader().register(() => ({
    name: 'offline-palette',
    loadTexture: () => Promise.resolve(new Texture()),
  }));
  const file = fs.readFileSync('public/assets/library/kenney/mini-characters/character-' + model + '.glb');
  const asset = await loader.parseAsync(Uint8Array.from(file).buffer, '');
  const mixer = new AnimationMixer(asset.scene);
  mixer.clipAction(asset.animations.find((clip) => clip.name === 'sit')).play();
  mixer.update(0.6);
  asset.scene.updateMatrixWorld(true);
  const positions = [],
    normals = [],
    uv = [],
    indices = [],
    point = new Vector3(),
    normal = new Vector3();
  asset.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geom = mesh.geometry,
      offset = positions.length / 3;
    for (let i = 0; i < geom.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      point.toArray(positions, positions.length);
      normal
        .fromBufferAttribute(geom.attributes.position, i)
        .add(new Vector3().fromBufferAttribute(geom.attributes.normal, i));
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, normal);
      normal.applyMatrix4(mesh.matrixWorld).sub(point).normalize().toArray(normals, normals.length);
      uv.push(geom.attributes.uv.getX(i), geom.attributes.uv.getY(i));
    }
    for (const i of geom.index.array) indices.push(i + offset);
  });
  const [faces] = MeshoptSimplifier.simplifyWithAttributes(
    Uint32Array.from(indices),
    Float32Array.from(positions),
    3,
    Float32Array.from(uv),
    2,
    [1, 0.3],
    null,
    Math.floor((indices.length * 0.43) / 3) * 3,
    0.009,
    ['ErrorAbsolute', 'Permissive']
  );
  const groups = slots.map(() => []);
  groups[7] = Array.from(faces);
  const id = geometry(positions, normals, uv, groups);
  drivers.set(model, id);
  return id;
}
// Seat heights are measured against the actual front window and dashboard of each donor.
const cabins = {
  delivery: ['worker', 0.7, 0.6],
  van: ['female-b', 0.71, 0.32],
  taxi: ['male-a', 0.73, 0.01],
  tractor: ['worker', 0.94, -0.2],
  firetruck: ['worker', 0.93, 0.98],
  'garbage-truck': ['worker', 0.7, 0.78],
  ambulance: ['female-b', 0.72, 0.6],
  'sedan-sports': ['male-a', 0.61, -0.05],
  'hatchback-sports': ['female-b', 0.59, -0.03],
  suv: ['worker', 0.67, 0.08],
  truck: ['male-a', 0.73, 0.14],
};
for (const model of models) {
  const { doc, read } = parse(fs.readFileSync(source + model + '.glb'));
  const distant = { positions: [], normals: [], uv: [], groups: slots.map(() => []) };
  const root = { name: model, extras: { fleetModel: model }, children: [] };
  gltf.scenes[0].nodes.push(gltf.nodes.push(root) - 1);
  const near = { name: model + '-detail', extras: { detail: true }, children: [] };
  root.children.push(gltf.nodes.push(near) - 1);
  function visit(index, parent, world) {
    const node = doc.nodes[index];
    const transform = new Matrix4().compose(
      new Vector3(...(node.translation ?? [0, 0, 0])),
      new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
      new Vector3(...(node.scale ?? [1, 1, 1]))
    );
    const matrix = new Matrix4().multiplyMatrices(world, transform);
    const result = { name: model + '-' + node.name, extras: { part: node.name }, children: [] };
    for (const key of ['translation', 'rotation', 'scale']) if (node[key]) result[key] = node[key];
    parent.children.push(gltf.nodes.push(result) - 1);
    if (node.mesh !== undefined) {
      const primitive = doc.meshes[node.mesh].primitives[0];
      const positions = read(primitive.attributes.POSITION),
        normals = read(primitive.attributes.NORMAL),
        uv = read(primitive.attributes.TEXCOORD_0),
        faces = read(primitive.indices);
      const p = [],
        n = [],
        t = [],
        groups = slots.map(() => []),
        vertexMap = new Map();
      function vertex(source) {
        const values = [
          ...positions.slice(source * 3, source * 3 + 3),
          ...normals.slice(source * 3, source * 3 + 3),
          ...uv.slice(source * 2, source * 2 + 2),
        ];
        const key = values.map((x) => Math.round(x * 1e5)).join(',');
        if (vertexMap.has(key)) return vertexMap.get(key);
        const id = p.length / 3;
        p.push(...values.slice(0, 3));
        n.push(...values.slice(3, 6));
        t.push(...values.slice(6));
        vertexMap.set(key, id);
        return id;
      }
      for (let i = 0; i < faces.length; i += 3) {
        const a = faces[i],
          b = faces[i + 1],
          c = faces[i + 2];
        const mean = (values, stride, axis) =>
          (values[a * stride + axis] + values[b * stride + axis] + values[c * stride + axis]) / 3;
        const group = classify(
          model,
          node.name,
          mean(uv, 2, 0),
          mean(uv, 2, 1),
          mean(positions, 3, 0),
          mean(positions, 3, 1),
          mean(positions, 3, 2)
        );
        groups[group].push(vertex(a), vertex(faces[i + 1]), vertex(faces[i + 2]));
      }
      // Tires and matching trims are identical across multiple models.
      const key = JSON.stringify([p, n, t, groups]);
      if (!sourceMeshes.has(key)) sourceMeshes.set(key, geometry(p, n, t, groups));
      result.mesh = sourceMeshes.get(key);
      const fp = new Float32Array(p),
        attrs = new Float32Array(t),
        reused = new Map(),
        point = new Vector3();
      for (let group = 0; group < groups.length; group++) {
        const original = groups[group];
        if (!original.length) continue;
        const [indices] = MeshoptSimplifier.simplifyWithAttributes(
          Uint32Array.from(original),
          fp,
          3,
          attrs,
          2,
          [1, 0.15],
          null,
          Math.max(3, Math.floor((original.length * 0.2) / 3) * 3),
          0.065,
          ['Permissive', 'ErrorAbsolute']
        );
        for (const id of indices) {
          if (!reused.has(id)) {
            reused.set(id, distant.positions.length / 3);
            point
              .fromArray(p, id * 3)
              .applyMatrix4(matrix)
              .toArray(distant.positions, distant.positions.length);
            point
              .fromArray(n, id * 3)
              .transformDirection(matrix)
              .toArray(distant.normals, distant.normals.length);
            distant.uv.push(t[id * 2], t[id * 2 + 1]);
          }
          distant.groups[group].push(reused.get(id));
        }
      }
    }
    for (const child of node.children ?? []) visit(child, result, matrix);
    if (!result.children.length) delete result.children;
  }
  for (const id of doc.scenes[doc.scene ?? 0].nodes) visit(id, near, new Matrix4());
  const [person, y, z] = cabins[model];
  near.children.push(
    gltf.nodes.push({
      name: model + '-driver',
      mesh: await driverMesh(person),
      translation: [model === 'tractor' ? 0 : 0.22, y, z],
      scale: [0.84, 0.84, 0.84],
    }) - 1
  );
  const far = {
    name: model + '-distance',
    extras: { distant: true },
    mesh: geometry(distant.positions, distant.normals, distant.uv, distant.groups),
  };
  root.children.push(gltf.nodes.push(far) - 1);
}
gltf.buffers.push({ byteLength: size });
const json = Buffer.from(JSON.stringify(gltf)),
  jsonLength = Math.ceil(json.length / 4) * 4;
const header = Buffer.alloc(20);
header.write('glTF');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonLength + size, 8);
header.writeUInt32LE(jsonLength, 12);
header.write('JSON', 16);
const bin = Buffer.alloc(8);
bin.writeUInt32LE(size);
bin.write('BIN\0', 4);
fs.writeFileSync(
  output,
  Buffer.concat([header, json, Buffer.alloc(jsonLength - json.length, 32), bin, ...chunks])
);
