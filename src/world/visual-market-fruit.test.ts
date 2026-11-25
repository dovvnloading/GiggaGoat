import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { buildMarketFruitVisuals, MARKET_FRUIT_MODELS, marketFruitGeometry, type MarketFruitVisualState } from './visual-market-fruit';

async function load(model: 'apple' | 'orange'): Promise<GLTF> {
  return new GLTFLoader().register(() => ({ name: 'test-texture',
    loadTexture: () => Promise.resolve(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)),
  })).parseAsync(Uint8Array.from(readFileSync('public/' + MARKET_FRUIT_MODELS[model])).buffer, '');
}
const fruit = (model: 'apple' | 'orange', index: number): MarketFruitVisualState => ({
  id: model + index, model, radius: .12, position: { x: index, y: 3, z: 4 },
  rotation: { x: 0, y: 0, z: 0, w: 1 }, visible: true,
});

it.each(['apple', 'orange'] as const)('fits native %s art uniformly around its physical centre', async model => {
  const geometry = marketFruitGeometry(await load(model))!;
  try {
    const box = geometry.boundingBox!, size = box.getSize(new THREE.Vector3());
    expect(box.getCenter(new THREE.Vector3()).length()).toBeLessThan(.00001);
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(1, 5);
    expect(Math.min(size.x, size.y, size.z)).toBeGreaterThan(.5);
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
  } finally { geometry.dispose(); }
});

it('renders six moving fruits in two bounded batches and never invents extra instances', async () => {
  const apples = await load('apple'), oranges = await load('orange');
  const items = [fruit('apple', 0), fruit('orange', 1), fruit('apple', 2), fruit('orange', 3), fruit('apple', 4), fruit('orange', 5)];
  const visuals = buildMarketFruitVisuals(items, { loadAsset: async url => url.includes('/apple.') ? apples : oranges });
  await visuals.ready;
  try {
    visuals.update(items);
    expect(visuals.root.children).toHaveLength(2);
    for (const batch of visuals.root.children as THREE.InstancedMesh[]) expect(batch.count).toBe(3);
    items[0]!.position.y = 9;
    visuals.update([...items, fruit('apple', 6)]);
    const apple = visuals.root.getObjectByName('market-apple') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); apple.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBe(9);
    expect(apple.count).toBe(3);
    visuals.update(items.map(item => ({ ...item, visible: false })));
    expect(apple.visible).toBe(false);
    expect(apple.count).toBe(0);
  } finally { visuals.dispose(); visuals.dispose(); }
});

it('does not attach late assets after the market view is disposed', async () => {
  let resolve!: (value: GLTF) => void;
  const pending = new Promise<GLTF>(done => { resolve = done; });
  const visuals = buildMarketFruitVisuals([fruit('apple', 0)], { loadAsset: () => pending });
  visuals.dispose(); resolve(await load('apple'));
  await visuals.ready;
  expect(visuals.root.children).toHaveLength(0);
});

it('finishes a shared opaque distance fade before culling and recovers on approach', async () => {
  const asset = await load('apple'), item = fruit('apple', 0);
  const visuals = buildMarketFruitVisuals([item], { loadAsset: async () => asset });
  await visuals.ready;
  try {
    const batch = visuals.root.getObjectByName('market-apple') as THREE.InstancedMesh;
    const material = batch.material as THREE.MeshToonMaterial;
    const toon = THREE.ShaderLib['toon']!;
    const shader = { uniforms: {}, vertexShader: toon.vertexShader,
      fragmentShader: toon.fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(material.transparent).toBe(false);
    expect(material.alphaHash).toBe(true);
    expect(shader.uniforms['uLifeFadeRange']!.value.toArray()).toEqual([55, 80]);
    expect(shader.fragmentShader).toContain('diffuseColor.a *= 1.0 - smoothstep');
    const camera = new THREE.Vector3(79, 3, 4);
    visuals.update([item], camera);
    expect(batch.count).toBe(1);
    camera.x = 85;
    visuals.update([item], camera);
    expect(batch.count).toBe(0);
    camera.x = 20;
    visuals.update([item], camera);
    expect(batch.count).toBe(1);
    expect(batch.instanceMatrix.count).toBe(1);
  } finally { visuals.dispose(); }
});
