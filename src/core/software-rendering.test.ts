import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { softwareGeometry } from './software-geometry';
import { islandWeather } from '../world/island-weather';
import { SoftwareAtmosphere } from './SoftwareAtmosphere';
import { softwareSea } from './software-sea';
import { SoftwareFrame, pixel } from './SoftwareFrame';
import { SoftwareGameRenderer } from './SoftwareGameRenderer';
import { SoftwareRaster } from './SoftwareRaster';

function imageData(width: number, height: number): ImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
}

describe('software 3D rendering', () => {
  it('blends sky colours inside each coarse cloud sample', () => {
    const frame = new SoftwareFrame(imageData(157, 73));
    const camera = new THREE.PerspectiveCamera(58, 157 / 73, .1, 600);
    camera.lookAt(0, .6, -1);
    camera.updateMatrixWorld();
    new SoftwareAtmosphere().sky(frame, camera, islandWeather(130), 0xa4d6ed);
    let blended = 0;
    for (let y = 1; y < 73; y += 3) {
      for (let x = 1; x < 157; x += 5) {
        const i = y * 157 + x;
        if (frame.pixels[i] !== frame.pixels[i - 1] && frame.pixels[i] !== frame.pixels[i - 157]) blended++;
      }
    }
    expect(blended).toBeGreaterThan(20);
  });

  it('uses tide and shelf depth to shade the sea without rebuilding its mesh', () => {
    const atlas = new THREE.DataTexture(new Float32Array(9).fill(-1), 3, 3, THREE.RedFormat, THREE.FloatType);
    const level = { value: 0 };
    const material = new THREE.ShaderMaterial({ uniforms: {
      uTerrain: { value: atlas }, uLevel: level, uSize: { value: 600 }, uSeaDatum: { value: 0 },
      uShallow: { value: new THREE.Color(0x48c9c9) }, uDeep: { value: new THREE.Color(0x2a8fc0) },
    } });
    const shore = softwareSea(material)!;
    expect(new Set(shore.colours).size).toBeGreaterThan(1);
    level.value = 60;
    const flooded = softwareSea(material)!;
    expect(flooded.geometry).toBe(shore.geometry);
    expect(new Set(flooded.colours)).toEqual(new Set([pixel(42, 143, 192) >>> 0]));
    atlas.dispose();
    material.dispose();
  });

  it('renders High at display resolution and applies a lower preset only once', () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const renderer = new SoftwareGameRenderer(canvas, { createImageData: imageData, putImageData() {} });
    for (const [w, h] of [[1454, 883], [1024, 576], [540, 360], [1920, 1080]] as const) {
      renderer.setSize(w, h, false);
      expect([canvas.width, canvas.height]).toEqual([w, h]);
    }
    renderer.setPixelRatio(.8);
    renderer.setSize(1280, 720, false);
    expect([canvas.width, canvas.height]).toEqual([1024, 576]);
    renderer.dispose();
  });

  it('draws the terrain horizon beyond the ordinary scenery range', () => {
    const renderer = new SoftwareGameRenderer({} as HTMLCanvasElement, { createImageData: imageData, putImageData() {} });
    const geometry = new THREE.PlaneGeometry(80, 45);
    const material = new THREE.MeshBasicMaterial({ color: 0x719d62 });
    try {
      renderer.setSize(160, 90, false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, .1, 2200);
      camera.position.z = 405;
      const slope = new THREE.Mesh(geometry, material);
      scene.add(slope);
      renderer.render(scene, camera);
      expect(renderer.info.render.triangles).toBe(0);
      slope.userData.terrainChunk = true;
      renderer.render(scene, camera);
      expect(renderer.info.render.triangles).toBe(2);
    } finally {
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    }
  });

  it('keeps the shaft of a tall thin prop connected in its distant mesh', async () => {
    await MeshoptSimplifier.ready;
    const geometry = new THREE.CylinderGeometry(.045, .045, 6, 32, 8);
    const position = geometry.getAttribute('position');
    const data = softwareGeometry(geometry, 'far');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let crossingArea = 0;
    for (let k = 0; k < data.corners.length; k += 3) {
      a.fromBufferAttribute(position, data.sources[data.corners[k]!]!);
      b.fromBufferAttribute(position, data.sources[data.corners[k + 1]!]!);
      c.fromBufferAttribute(position, data.sources[data.corners[k + 2]!]!);
      if (Math.min(a.y, b.y, c.y) < .17 && Math.max(a.y, b.y, c.y) > .17) {
        crossingArea += b.sub(a).cross(c.sub(a)).length() / 2;
      }
    }
    expect(crossingArea).toBeGreaterThan(.02);
    geometry.dispose();
  });

  it('interpolates painted ground colours between vertices', () => {
    const frame = new SoftwareFrame(imageData(64, 64));
    const vertex = (x: number, y: number, tint: number) => ({ x, y, w: 1, u: 0, v: 0, tint });
    frame.clear(0, 0);
    frame.triangle(vertex(-1, -1, pixel(30, 160, 45)), vertex(1, -1, pixel(180, 140, 70)),
      vertex(0, 1, pixel(60, 180, 90)), .1, 0, undefined, THREE.DoubleSide, 1);
    expect(new Set(frame.pixels.subarray(48 * 64 + 16, 48 * 64 + 48)).size).toBeGreaterThan(20);
  });

  it('leaves holes in both colour and depth on a faded foreground mesh', () => {
    const frame = new SoftwareFrame(imageData(16, 16));
    const vertex = (x: number, y: number, depth: number) => ({ x: x * depth, y: y * depth, w: depth, u: 0, v: 0 });
    const fill = (depth: number, color: number, opacity = 1) => {
      const a = vertex(-1, -1, depth), b = vertex(1, -1, depth), c = vertex(1, 1, depth), d = vertex(-1, 1, depth);
      frame.triangle(a, b, c, .1, color, undefined, THREE.DoubleSide, 1, opacity);
      frame.triangle(a, c, d, .1, color, undefined, THREE.DoubleSide, 1, opacity);
    };
    frame.clear(0, 0);
    const near = pixel(255, 0, 0) >>> 0, far = pixel(0, 255, 0) >>> 0;
    fill(1, near, .5);
    fill(2, far);
    expect(frame.pixels.filter(color => color === near)).toHaveLength(128);
    expect(frame.pixels.filter(color => color === far)).toHaveLength(128);
  });

  it('blends untextured wake coverage when the software SIMD raster is active', async () => {
    const bytes = await readFile(new URL('./software-raster.wasm', import.meta.url));
    const memory = new WebAssembly.Memory({ initial: 1 });
    const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes), { env: { memory } });
    const raster = new SoftwareRaster(memory, instance.exports.drawBatch as ConstructorParameters<typeof SoftwareRaster>[1],
      instance.exports.projectBatch as ConstructorParameters<typeof SoftwareRaster>[2]);
    vi.stubGlobal('ImageData', class {
      constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
    });
    let captured!: ImageData;
    const renderer = new SoftwareGameRenderer({} as HTMLCanvasElement, {
      createImageData: imageData, putImageData(image) { captured = image; },
    }, raster);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 20);
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from(
      { length: 4 }, () => [1, 1, 1, .5]).flat(), 4));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    const wake = new THREE.Mesh(geometry, material);
    wake.position.z = -3;
    scene.background = new THREE.Color(0x0000ff);
    renderer.setClearColor(scene.background);
    scene.add(wake);
    try {
      renderer.setSize(64, 64, false);
      renderer.render(scene, camera);
      const center = (25 * 64 + 30) * 4;
      const [r, g, b] = captured.data.subarray(center, center + 3);
      expect(r).toBeCloseTo(127, -1);
      expect(g).toBeCloseTo(127, -1);
      expect(b).toBe(255);
    } finally {
      vi.unstubAllGlobals();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    }
  });

  it('clips triangles at the camera and resolves crossing surfaces by pixel depth', () => {
    const frame = new SoftwareFrame(imageData(32, 32));
    const vertex = (x: number, y: number, w: number) => ({ x, y, w, u: 0, v: 0 });
    const red = pixel(230, 10, 5), green = pixel(10, 200, 30);
    const foreground = () => frame.triangle(vertex(-.8, -.8, 1), vertex(.8, -.8, 1),
      vertex(0, .9, -.01), .1, red, undefined, THREE.DoubleSide, 1);
    const background = () => frame.triangle(vertex(-2, -2, 2), vertex(2, -2, 2),
      vertex(0, 2, 2), .1, green, undefined, THREE.DoubleSide, 1);
    for (const draws of [[foreground, background], [background, foreground]]) {
      frame.clear(0, 0);
      for (const draw of draws) draw!();
      expect(frame.pixels[16 * 32 + 16]).toBe(red >>> 0);
      expect(frame.pixels).toContain(green >>> 0);
    }
  });

  it('projects instanced scene geometry through the moving game camera', () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    let captured: ImageData;
    const ctx = { createImageData: imageData, putImageData: (image: ImageData) => { captured = image; } };
    const renderer = new SoftwareGameRenderer(canvas, ctx);
    renderer.setSize(96, 64, false);
    const scene = new THREE.Scene();
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
    boxes.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-1, 0, -4));
    boxes.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1, 0, -4));
    boxes.setColorAt(0, new THREE.Color(0xff0000));
    boxes.setColorAt(1, new THREE.Color(0x00ff00));
    scene.add(boxes);
    const camera = new THREE.PerspectiveCamera(55, 1.5, .1, 100);
    renderer.render(scene, camera);
    const first = Uint32Array.from(new Uint32Array(captured!.data.buffer));
    expect(first).toContain(pixel(255, 0, 0) >>> 0);
    expect(first).toContain(pixel(0, 255, 0) >>> 0);
    camera.position.x = .8;
    renderer.render(scene, camera);
    expect(new Uint32Array(captured!.data.buffer)).not.toEqual(first);
    renderer.dispose();
  });

  it('renders weighted bone motion at the same position as the equivalent rigid mesh', () => {
    let captured!: ImageData;
    const renderer = new SoftwareGameRenderer({} as HTMLCanvasElement, {
      createImageData: imageData, putImageData(image) { captured = image; },
    });
    renderer.setSize(96, 64, false);
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial({ color: 0xff9944 });
    const count = geometry.getAttribute('position').count;
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      indices[i * 4 + 1] = 1;
      weights[i * 4] = .25; weights[i * 4 + 1] = .75;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const skin = new THREE.SkinnedMesh(geometry, material);
    const root = new THREE.Bone(), child = new THREE.Bone();
    root.add(child); skin.add(root);
    skin.bind(new THREE.Skeleton([root, child]));
    child.position.x = 1;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1.5, .1, 100);
    camera.position.z = 4;
    scene.add(skin);
    renderer.render(scene, camera);
    const animated = Uint32Array.from(new Uint32Array(captured.data.buffer));
    const rigid = new THREE.Mesh(geometry, material);
    rigid.position.x = .75;
    scene.remove(skin); scene.add(rigid);
    renderer.render(scene, camera);
    expect(animated).toEqual(new Uint32Array(captured.data.buffer));
    expect(animated).toContain(pixel(255, 153, 68) >>> 0);
    renderer.dispose(); geometry.dispose(); material.dispose();
  });
});
