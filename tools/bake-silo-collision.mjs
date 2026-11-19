import { readFile, writeFile } from 'node:fs/promises';
import { Box3, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Keep the static world available synchronously, before the district art loads.
// Re-run with node tools/bake-silo-collision.mjs when the shipped silo changes.
const source = new URL('../public/assets/library/custom/hoofington-props/silo.glb', import.meta.url);
const target = new URL('../src/world/silo-collision.json', import.meta.url);
const bytes = await readFile(source);
const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
scene.updateMatrixWorld(true);
const bounds = new Box3().setFromObject(scene);
const center = bounds.getCenter(new Vector3()), span = bounds.getSize(new Vector3());
const positions = [], triangles = [], indexByPosition = new Map();
const point = new Vector3();
const units = 32767;
scene.traverse(mesh => {
  if (!(mesh instanceof Mesh)) return;
  const { index } = mesh.geometry;
  const vertices = mesh.geometry.getAttribute('position');
  const count = index?.count ?? vertices.count;
  for (let i = 0; i < count; i++) {
    const vertex = index ? index.getX(i) : i;
    point.fromBufferAttribute(vertices, vertex).applyMatrix4(mesh.matrixWorld).sub(center).divide(span);
    const coords = [point.x, point.y, point.z].map(n => Math.round(n * units));
    const key = coords.join(',');
    let id = indexByPosition.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      indexByPosition.set(key, id);
      positions.push(...coords);
    }
    triangles.push(id);
  }
});
await writeFile(target, JSON.stringify({ units, positions, triangles }) + '\n');
