import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SoftwareFrame, pixel } from './SoftwareFrame';
import { SoftwareGameRenderer } from './SoftwareGameRenderer';

function imageData(width: number, height: number): ImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
}

describe('software 3D rendering', () => {
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
});
