import * as THREE from 'three';
import { SoftwareFrame, pixel, type ClipVertex, type SoftwareTexture } from './SoftwareFrame';
import { softwareGeometry } from './software-geometry';

type Surface = THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null };
interface Paint {
  material: Surface; colour: THREE.Color; texture?: SoftwareTexture; unlit: boolean;
}

/** Draw the existing perspective scene when the browser cannot create a GPU context. */
export class SoftwareGameRenderer {
  readonly isSoftwareRenderer = true;
  readonly shadowMap = { enabled: false, type: THREE.PCFSoftShadowMap as THREE.ShadowMapType,
    autoUpdate: false, needsUpdate: false };
  readonly info = { render: { calls: 0, triangles: 0 }, memory: { textures: 0 } };
  outputColorSpace = THREE.SRGBColorSpace;
  private frame?: SoftwareFrame;
  private animation = 0;
  private ratio = 1;
  private actualRatio = 1;
  private clearColour = new THREE.Color(0xb3d8e8);
  private readonly viewProjection = new THREE.Matrix4();
  private readonly transform = new THREE.Matrix4();
  private readonly instance = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere();
  private readonly position = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraRotation = new THREE.Quaternion();
  private readonly spriteScale = new THREE.Vector3();
  private readonly spriteTransform = new THREE.Matrix4();
  private readonly spriteQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  private readonly normalMatrix = new THREE.Matrix3();
  private readonly sun = new THREE.Vector3(.48, .86, -.36).normalize();
  private readonly localLight = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly white = new THREE.Color(0xffffff);
  private readonly water = new THREE.Color(0x53aeb9);
  private readonly points: ClipVertex[] = [];
  private readonly textures = new WeakMap<THREE.Texture, { version: number; image: SoftwareTexture }>();
  private readonly srgb = Uint8Array.from({ length: 4097 }, (_, i) =>
    Math.round(255 * THREE.ColorManagement.workingToColorSpace(
      new THREE.Color(i / 4096, 0, 0), THREE.SRGBColorSpace).r));
  private near = .1;
  private focalPixels = 1;

  constructor(readonly domElement: HTMLCanvasElement, private readonly ctx: {
    createImageData(width: number, height: number): ImageData;
    putImageData(image: ImageData, x: number, y: number): void;
  }) {}

  setClearColor(colour: THREE.Color): void { this.clearColour.copy(colour); }
  setPixelRatio(ratio: number): void { this.ratio = Math.min(1, Math.max(.4, ratio)); }
  getPixelRatio(): number { return this.actualRatio; }

  setSize(width: number, height: number, updateStyle = true): void {
    this.actualRatio = Math.min(1, 640 / Math.max(1, width), 384 / Math.max(1, height)) * this.ratio;
    const w = Math.max(1, Math.round(width * this.actualRatio));
    const h = Math.max(1, Math.round(height * this.actualRatio));
    if (updateStyle) {
      this.domElement.style.width = width + 'px';
      this.domElement.style.height = height + 'px';
    }
    if (this.frame && this.domElement.width === w && this.domElement.height === h) return;
    this.domElement.width = w;
    this.domElement.height = h;
    this.frame = new SoftwareFrame(this.ctx.createImageData(w, h));
  }

  setAnimationLoop(callback: ((time: number) => void) | null): void {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = 0;
    if (!callback) return;
    let last = -Infinity;
    const loop = (time: number): void => {
      this.animation = requestAnimationFrame(loop);
      if (time - last < 1000 / 30 - 1) return;
      last = time;
      callback(time);
    };
    this.animation = requestAnimationFrame(loop);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.frame) this.setSize(this.domElement.width, this.domElement.height, false);
    const frame = this.frame!;
    this.info.render.calls = this.info.render.triangles = 0;
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraRotation);
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    this.near = camera instanceof THREE.PerspectiveCamera ? camera.near : .01;
    this.focalPixels = frame.image.height * camera.projectionMatrix.elements[5] * .5;
    const horizon = scene.fog?.color ?? this.clearColour;
    frame.clear(horizon.getHex(), scene.background instanceof THREE.Color
      ? scene.background.getHex() : horizon.getHex());
    scene.traverseVisible(object => {
      if (object instanceof THREE.Mesh) this.drawMesh(object);
      else if (object instanceof THREE.Sprite) this.drawSprite(object);
    });
    this.ctx.putImageData(frame.image, 0, 0);
  }

  private texture(map: THREE.Texture): SoftwareTexture | undefined {
    const saved = this.textures.get(map);
    if (saved && saved.version === map.version) return saved.image;
    const source = map.image as CanvasImageSource & { width?: number; height?: number };
    if (!source?.width || !source.height) return;
    if ('data' in source) return;
    const ratio = Math.min(1, 512 / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * ratio));
    canvas.height = Math.max(1, Math.round(source.height * ratio));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width, height: canvas.height };
    this.textures.set(map, { version: map.version, image });
    if (!saved) this.info.memory.textures++;
    return image;
  }

  private paint(mesh: THREE.Mesh, material: Surface): Paint | undefined {
    if (!material.visible || material.opacity < .12 || material.side === THREE.BackSide) return;
    let colour = material.color ?? this.white;
    if (material instanceof THREE.ShaderMaterial) {
      if (!/sea|river|reservoir|plunge-pool|terrace-water/.test(mesh.name)) return;
      colour = this.water;
    }
    return { material, colour, texture: material.map ? this.texture(material.map) : undefined,
      unlit: material instanceof THREE.MeshBasicMaterial };
  }

  private drawSprite(sprite: THREE.Sprite): void {
    const material = sprite.material;
    if (!material.visible || material.opacity < .12 || !material.map) return;
    const texture = this.texture(material.map);
    if (!texture) return;
    this.position.setFromMatrixPosition(sprite.matrixWorld);
    this.spriteScale.setFromMatrixScale(sprite.matrixWorld);
    this.spriteTransform.compose(this.position, this.cameraRotation, this.spriteScale);
    if (!this.spriteQuad.geometry.boundingSphere) this.spriteQuad.geometry.computeBoundingSphere();
    this.drawInstance(this.spriteQuad, this.spriteTransform, this.white,
      [{ material, colour: material.color, texture, unlit: true }]);
  }

  private drawMesh(mesh: THREE.Mesh): void {
    const geometry = mesh.geometry;
    if (!geometry.getAttribute('position')) return;
    const paints = Array.isArray(mesh.material)
      ? mesh.material.map(m => this.paint(mesh, m)) : [this.paint(mesh, mesh.material)];
    if (!paints.some(Boolean)) return;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (mesh instanceof THREE.InstancedMesh) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, this.instance);
        this.world.multiplyMatrices(mesh.matrixWorld, this.instance);
        if (mesh.instanceColor) mesh.getColorAt(i, this.tint);
        this.drawInstance(mesh, this.world, mesh.instanceColor ? this.tint : this.white, paints);
      }
    } else this.drawInstance(mesh, mesh.matrixWorld, this.white, paints);
  }

  private drawInstance(mesh: THREE.Mesh, matrix: THREE.Matrix4, tint: THREE.Color,
    paints: (Paint | undefined)[]): void {
    const geometry = mesh.geometry;
    this.sphere.copy(geometry.boundingSphere!).applyMatrix4(matrix);
    if (this.sphere.radius <= 0 || !this.frustum.intersectsSphere(this.sphere)) return;
    const distance = this.cameraPosition.distanceTo(this.sphere.center);
    const sky = mesh.name === 'visible-sun' || mesh.name.startsWith('puffy-cloud-banks');
    if (!sky && distance - this.sphere.radius > 245) return;
    const radius = this.focalPixels * this.sphere.radius / Math.max(1, distance - this.sphere.radius);
    if (radius < 1.05) return;
    const position = geometry.getAttribute('position');
    const skinned = mesh instanceof THREE.SkinnedMesh;
    // Keep roads and terrain on their authored heights; their thin layers need exact depth.
    const fixed = mesh.userData.terrainChunk || mesh.name.startsWith('paths-');
    const cells = fixed || position.count < 160 ? 0 : mesh.name === 'rising-sea' ? 32 :
      radius < 8 ? 5 : radius < 22 ? 9 : radius < 65 ? 16 : skinned ? 36 :
      position.count > 2300 ? 32 : 0;
    const data = softwareGeometry(geometry, cells);
    this.transform.multiplyMatrices(this.viewProjection, matrix);
    const m = this.transform.elements;
    for (let i = 0; i < data.sources.length; i++) {
      const source = data.sources[i]!;
      const p = this.points[i] ?? (this.points[i] = { x: 0, y: 0, w: 1, u: 0, v: 0 });
      if (skinned) mesh.getVertexPosition(source, this.position);
      else this.position.fromBufferAttribute(position, source);
      const { x, y, z } = this.position;
      p.x = m[0] * x + m[4] * y + m[8] * z + m[12];
      p.y = m[1] * x + m[5] * y + m[9] * z + m[13];
      p.w = m[3] * x + m[7] * y + m[11] * z + m[15];
    }
    this.normalMatrix.getNormalMatrix(matrix).transpose();
    this.localLight.copy(this.sun).applyMatrix3(this.normalMatrix).normalize();
    const light = this.localLight, uv = geometry.getAttribute('uv');
    const { corners, colours, normals } = data;
    this.info.render.calls++;
    this.info.render.triangles += corners.length / 3;
    for (let k = 0; k < corners.length; k += 3) {
      const face = k / 3;
      const paint = paints.length === 1 ? paints[0] : paints[data.materials[face]!];
      if (!paint) continue;
      const a = this.points[corners[k]!]!, b = this.points[corners[k + 1]!]!,
        c = this.points[corners[k + 2]!]!;
      if (a.w < this.near && b.w < this.near && c.w < this.near) continue;
      const shade = paint.unlit ? 1 : .79 + .21 * Math.max(-.6,
        normals[k]! * light.x + normals[k + 1]! * light.y + normals[k + 2]! * light.z);
      const vertex = paint.material.vertexColors ? colours : undefined;
      const base = paint.colour;
      const r = this.channel(base.r * tint.r * (vertex ? vertex[k]! : 1), shade);
      const g = this.channel(base.g * tint.g * (vertex ? vertex[k + 1]! : 1), shade);
      const blue = this.channel(base.b * tint.b * (vertex ? vertex[k + 2]! : 1), shade);
      if (paint.texture && uv) {
        const flip = paint.material.map!.flipY;
        this.uv(a, uv, data.originals[k]!, flip);
        this.uv(b, uv, data.originals[k + 1]!, flip);
        this.uv(c, uv, data.originals[k + 2]!, flip);
      }
      this.frame!.triangle(a, b, c, this.near, pixel(r, g, blue), uv ? paint.texture : undefined,
        paint.material.side, paint.material.polygonOffset ? 1.00005 : 1);
    }
  }

  private uv(p: ClipVertex, uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    i: number, flip: boolean): void {
    p.u = uv.getX(i);
    p.v = flip ? 1 - uv.getY(i) : uv.getY(i);
  }

  private channel(linear: number, shade: number): number {
    return this.srgb[Math.max(0, Math.min(4096, Math.round(linear * 4096)))]! * shade;
  }

  dispose(): void {
    this.setAnimationLoop(null);
    this.frame = undefined;
    this.points.length = 0;
    this.spriteQuad.geometry.dispose();
    this.spriteQuad.material.dispose();
  }
}
