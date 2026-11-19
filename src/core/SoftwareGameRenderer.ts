import * as THREE from 'three';
import type { IslandWeather } from '../world/island-weather';
import { SoftwareAtmosphere } from './SoftwareAtmosphere';
import { SoftwareFrame, pixel, type ClipVertex, type SoftwareTexture } from './SoftwareFrame';
import { softwareGeometry } from './software-geometry';
import { surfacePaintMaps } from '../world/surface-paint';
import type { SoftwareGeometry } from './software-geometry';
import type { SoftwareRaster } from './SoftwareRaster';

type Surface = THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null };
interface Paint {
  material: Surface; colour: THREE.Color; texture?: SoftwareTexture; unlit: boolean;
}
interface ShadedFaces {
  data: SoftwareGeometry; material: Surface; light: THREE.Vector3; tint: THREE.Color; colours: Uint32Array;
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
  private readonly points: (ClipVertex & { outside: number })[] = [];
  private readonly boneMatrix = new THREE.Matrix4();
  private bonePalette = new Float32Array(0);
  private readonly textures = new WeakMap<THREE.Texture, { version: number; image: SoftwareTexture }>();
  private groundTints = new WeakMap<SoftwareGeometry, Uint32Array>();
  private readonly faceTints = new WeakMap<THREE.Mesh, ShadedFaces[]>();
  private readonly diffuse = new THREE.Color();
  private readonly srgb = Uint8Array.from({ length: 4097 }, (_, i) =>
    Math.round(255 * THREE.ColorManagement.workingToColorSpace(
      new THREE.Color(i / 4096, 0, 0), THREE.SRGBColorSpace).r));
  private weather?: IslandWeather;
  private readonly air = new SoftwareAtmosphere();
  private lightStep = -1;
  private rain?: THREE.LineSegments;
  private near = .1;

  setEnvironment(weather: IslandWeather, key: THREE.Vector3, target: THREE.Vector3): void {
    this.weather = weather;
    const step = Math.floor(weather.phase * 96);
    if (step === this.lightStep) return;
    this.lightStep = step;
    this.sun.subVectors(key, target).normalize();
    this.groundTints = new WeakMap();
  }
  private focalPixels = 1;

  constructor(readonly domElement: HTMLCanvasElement, private readonly ctx: {
    createImageData(width: number, height: number): ImageData;
    putImageData(image: ImageData, x: number, y: number): void;
  }, private readonly raster?: SoftwareRaster) {}

  setClearColor(colour: THREE.Color): void { this.clearColour.copy(colour); }
  setPixelRatio(ratio: number): void { this.ratio = Math.min(1.25, Math.max(.4, ratio)); }
  getPixelRatio(): number { return this.actualRatio; }

  setSize(width: number, height: number, updateStyle = true): void {
    // Apply the chosen graphics scale exactly once. Budget by pixel count so
    // both wide and portrait displays can use their native CSS resolution.
    this.actualRatio = Math.min(this.ratio, Math.sqrt(1920 * 1080 / Math.max(1, width * height)));
    const w = Math.max(1, Math.round(width * this.actualRatio));
    const h = Math.max(1, Math.round(height * this.actualRatio));
    if (updateStyle) {
      this.domElement.style.width = width + 'px';
      this.domElement.style.height = height + 'px';
    }
    if (this.frame && this.domElement.width === w && this.domElement.height === h) return;
    this.domElement.width = w;
    this.domElement.height = h;
    const shared = this.raster?.resize(w, h);
    this.frame = shared ? new SoftwareFrame(new ImageData(shared.colour, w, h), shared.depth) :
      new SoftwareFrame(this.ctx.createImageData(w, h));
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
    this.rain = undefined;
    if (this.weather) this.air.sky(frame, camera, this.weather, horizon.getHex());
    scene.traverseVisible(object => {
      if (object instanceof THREE.LineSegments && object.name === 'island-rain') this.rain = object;
      if (object instanceof THREE.Mesh) this.drawMesh(object);
      else if (object instanceof THREE.Sprite) this.drawSprite(object);
    });
    if (this.weather) this.air.grade(frame, this.weather, horizon.getHex(),
      scene.fog instanceof THREE.FogExp2 ? scene.fog.density : .002);
    if (this.rain) this.air.drops(frame, this.rain, camera);
    this.ctx.putImageData(frame.image, 0, 0);
  }

  private texture(map: THREE.Texture): SoftwareTexture | undefined {
    const saved = this.textures.get(map);
    if (saved && saved.version === map.version) return saved.image;
    const source = map.image as CanvasImageSource & { width?: number; height?: number };
    if (!source?.width || !source.height) return;
    if ('data' in source) return;
    const ratio = Math.min(1, 1024 / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * ratio));
    canvas.height = Math.max(1, Math.round(source.height * ratio));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width, height: canvas.height, flipY: map.flipY,
      repeatU: map.wrapS !== THREE.ClampToEdgeWrapping, repeatV: map.wrapT !== THREE.ClampToEdgeWrapping };
    this.textures.set(map, { version: map.version, image });
    if (!saved) this.info.memory.textures++;
    return image;
  }

  private paint(mesh: THREE.Mesh, material: Surface): Paint | undefined {
    if (!material.visible || material.opacity < .12) return;
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
        this.drawInstance(mesh, this.world, mesh.instanceColor ? this.tint : this.white, paints, i);
      }
    } else this.drawInstance(mesh, mesh.matrixWorld, this.white, paints);
  }

  /** Fold both bind transforms into each bone once. The articulated goat shares
   * those bones across thousands of vertices in a single frame. */
  private prepareBones(mesh: THREE.SkinnedMesh): void {
    const { bones, boneInverses } = mesh.skeleton;
    if (this.bonePalette.length < bones.length * 16) this.bonePalette = new Float32Array(bones.length * 16);
    for (let i = 0; i < bones.length; i++) {
      this.boneMatrix.multiplyMatrices(bones[i]!.matrixWorld, boneInverses[i]!)
        .multiply(mesh.bindMatrix).premultiply(mesh.bindMatrixInverse).toArray(this.bonePalette, i * 16);
    }
  }

  private groundColours(mesh: THREE.Mesh, material: Surface, data: SoftwareGeometry): Uint32Array | undefined {
    const map = surfacePaintMaps.get(material);
    if (!map) return;
    const existing = this.groundTints.get(data);
    if (existing) return existing;
    const tint = new Uint32Array(data.sources.length);
    const colour = mesh.geometry.getAttribute('color'), normal = mesh.geometry.getAttribute('normal');
    const base = material.color ?? this.white;
    for (let i = 0; i < tint.length; i++) {
      const source = data.sources[i]!;
      const x = data.positions[3 * i]! + mesh.matrixWorld.elements[12];
      const z = data.positions[3 * i + 2]! + mesh.matrixWorld.elements[14];
      const u = (x - map.cx) / map.width + .5, v = (z - map.cz) / map.width + .5;
      let r = base.r * (colour ? colour.getX(source) : 1);
      let g = base.g * (colour ? colour.getY(source) : 1);
      let b = base.b * (colour ? colour.getZ(source) : 1);
      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        const at = Math.floor(v * map.samples) * map.samples + Math.floor(u * map.samples);
        if (map.kind === 'road') {
          const wear = .81 + .33 * map.data[at]! / 255;
          r *= wear; g *= wear; b *= wear;
        } else {
          const contact = map.data[at * 2]! / 255, lawn = map.data[at * 2 + 1]! / 255 - .5;
          r *= (1 + lawn * .26) * (1 - contact * .30);
          g *= (1 + lawn * .31) * (1 - contact * .27);
          b *= (1 + lawn * .21) * (1 - contact * .37);
        }
      }
      const light = normal ? this.position.fromBufferAttribute(normal, source).dot(this.sun) : 1;
      const shade = .75 + .27 * Math.max(-.6, light);
      tint[i] = pixel(this.channel(r, shade), this.channel(g, shade), this.channel(b, shade));
    }
    this.groundTints.set(data, tint);
    return tint;
  }

  private drawInstance(mesh: THREE.Mesh, matrix: THREE.Matrix4, tint: THREE.Color,
    paints: (Paint | undefined)[], slot = 0): void {
    const geometry = mesh.geometry;
    this.sphere.copy(geometry.boundingSphere!).applyMatrix4(matrix);
    if (this.sphere.radius <= 0 || !this.frustum.intersectsSphere(this.sphere)) return;
    const distance = this.cameraPosition.distanceTo(this.sphere.center);
    const sky = mesh.name === 'visible-sun' || mesh.name === 'island-moon' || mesh.name.startsWith('puffy-cloud-banks');
    if (!sky && distance - this.sphere.radius > 245) return;
    const radius = this.focalPixels * this.sphere.radius / Math.max(1, distance - this.sphere.radius);
    if (radius < 1.05) return;
    const position = geometry.getAttribute('position');
    const skinned = mesh instanceof THREE.SkinnedMesh;
    // Keep roads and terrain on their authored heights; their thin layers need exact depth.
    const fixed = mesh.userData.terrainChunk || mesh.name.startsWith('paths-');
    // The district's nearby architecture includes playable details such as ladder treads.
    const preserveSilhouette = geometry.userData.preserveSilhouette && distance - this.sphere.radius < 16;
    const detailRadius = radius * Math.min(1, 480 / this.frame!.image.height);
    const detail = fixed || preserveSilhouette || position.count < 250 ? 'full' :
      detailRadius < 32 || mesh.name === 'rising-sea' ? 'far' : position.count > 1500 ? 'near' : 'full';
    const data = softwareGeometry(geometry, detail);
    const ground = fixed && paints[0] ? this.groundColours(mesh, paints[0].material, data) : undefined;
    this.transform.multiplyMatrices(this.viewProjection, matrix);
    const m = this.transform.elements;
    const uv = data.uvs;
    const textured = uv && paints.some(p => p?.texture);
    const mirrored = matrix.determinant() < 0;
    const common = paints.length === 1 ? paints[0] : undefined;
    const batch = common && !textured && this.raster?.accepts(data.sources.length, data.materials.length)
      ? this.raster : undefined;
    const staticBatch = skinned ? undefined : batch;
    const halfWidth = this.frame!.image.width * .5, halfHeight = this.frame!.image.height * .5;
    const skinIndices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    const paletteSkin = skinned && skinIndices && weights && !mesh.morphTargetInfluences?.some(Boolean);
    if (paletteSkin) this.prepareBones(mesh);
    const coords = data.positions, palette = this.bonePalette;
    if (staticBatch) staticBatch.project(data.positions, m, this.near, ground);
    else for (let i = 0; i < data.sources.length; i++) {
      const source = data.sources[i]!;
      const p = this.points[i] ?? (this.points[i] = { x: 0, y: 0, w: 1, u: 0, v: 0, outside: 0 });
      let x = coords[3 * i]!, y = coords[3 * i + 1]!, z = coords[3 * i + 2]!;
      if (paletteSkin) {
        const bx = x, by = y, bz = z;
        x = y = z = 0;
        for (let component = 0; component < 4; component++) {
          const weight = weights.getComponent(source, component);
          if (!weight) continue;
          const j = skinIndices.getComponent(source, component) * 16;
          x += weight * (palette[j]! * bx + palette[j + 4]! * by + palette[j + 8]! * bz + palette[j + 12]!);
          y += weight * (palette[j + 1]! * bx + palette[j + 5]! * by + palette[j + 9]! * bz + palette[j + 13]!);
          z += weight * (palette[j + 2]! * bx + palette[j + 6]! * by + palette[j + 10]! * bz + palette[j + 14]!);
        }
      } else if (skinned) {
        mesh.getVertexPosition(source, this.position);
        ({ x, y, z } = this.position);
      }
      p.x = m[0] * x + m[4] * y + m[8] * z + m[12];
      p.y = m[1] * x + m[5] * y + m[9] * z + m[13];
      p.w = m[3] * x + m[7] * y + m[11] * z + m[15];
      p.outside = Number(p.x < -p.w) | Number(p.x > p.w) << 1 | Number(p.y < -p.w) << 2 |
        Number(p.y > p.w) << 3 | Number(p.w < this.near) << 4;
      if (textured) { p.u = uv[2 * i]!; p.v = uv[2 * i + 1]!; }
      p.tint = ground?.[i];
      if (batch) {
        const offset = i * 5;
        const iz = p.w >= this.near ? 1 / p.w : 0;
        batch.vertices[offset] = halfWidth * (1 + p.x * iz);
        batch.vertices[offset + 1] = halfHeight * (1 - p.y * iz);
        batch.vertices[offset + 2] = iz;
        batch.vertexBits[offset + 3] = p.outside;
        if (ground) batch.vertexBits[offset + 4] = ground[i]!;
        p.screen = undefined;
      } else if (p.w >= this.near) this.frame!.prepare(p);
      else p.screen = undefined;
    }
    this.normalMatrix.getNormalMatrix(matrix).transpose();
    this.localLight.copy(this.sun).applyMatrix3(this.normalMatrix).normalize();
    const light = this.localLight;
    const { corners, colours, normals } = data;
    const faceTints = !ground && common ? this.shadeFaces(mesh, slot, data, common, tint) : undefined;
    this.info.render.calls++;
    this.info.render.triangles += corners.length / 3;
    let clipped: Uint32Array | undefined;
    if (batch && common) {
      const side = common.material.side;
      clipped = batch.draw(corners, faceTints, mirrored && side !== THREE.DoubleSide ? 1 - side : side,
        common.material.polygonOffset ? 1.00005 : 1);
    }
    const count = clipped ? clipped.length : data.materials.length;
    for (let i = 0; i < count; i++) {
      const face = clipped ? clipped[i]! : i, k = face * 3;
      const paint = paints.length === 1 ? paints[0] : paints[data.materials[face]!];
      if (!paint) continue;
      const ia = corners[k]!, ib = corners[k + 1]!, ic = corners[k + 2]!;
      const a = staticBatch ? this.clippedPoint(staticBatch, ia, ground) : this.points[ia]!;
      const b = staticBatch ? this.clippedPoint(staticBatch, ib, ground) : this.points[ib]!;
      const c = staticBatch ? this.clippedPoint(staticBatch, ic, ground) : this.points[ic]!;
      if (a.outside & b.outside & c.outside) continue;
      const faceSide = paint.material.side;
      const side = mirrored && faceSide !== THREE.DoubleSide ? 1 - faceSide : faceSide;
      if (a.screen && b.screen && c.screen) {
        const det = (b.screen.x - a.screen.x) * (c.screen.y - a.screen.y) -
          (b.screen.y - a.screen.y) * (c.screen.x - a.screen.x);
        if (Math.abs(det) < .02 || (side === THREE.FrontSide && det > 0) ||
            (side === THREE.BackSide && det < 0)) continue;
      }
      let colour = ground ? 0 : faceTints?.[face];
      if (colour === undefined) {
        const shade = paint.unlit ? 1 : .75 + .27 * Math.max(-.6,
          normals[k]! * light.x + normals[k + 1]! * light.y + normals[k + 2]! * light.z);
        const vertex = paint.material.vertexColors ? colours : undefined;
        const base = paint.colour;
        colour = pixel(this.channel(base.r * tint.r * (vertex ? vertex[k]! : 1), shade),
          this.channel(base.g * tint.g * (vertex ? vertex[k + 1]! : 1), shade),
          this.channel(base.b * tint.b * (vertex ? vertex[k + 2]! : 1), shade));
      }
      this.frame!.triangle(a, b, c, this.near, colour, uv ? paint.texture : undefined,
        side, paint.material.polygonOffset ? 1.00005 : 1);
    }
  }

  private clippedPoint(batch: SoftwareRaster, i: number, ground?: Uint32Array) {
    const p = this.points[i] ?? (this.points[i] = { x: 0, y: 0, w: 1, u: 0, v: 0, outside: 0 });
    const v = batch.clipCoordinates;
    p.x = v[3 * i]!; p.y = v[3 * i + 1]!; p.w = v[3 * i + 2]!;
    p.outside = batch.vertexBits[i * 5 + 3]!;
    p.tint = ground?.[i]; p.screen = undefined;
    return p;
  }

  private shadeFaces(mesh: THREE.Mesh, slot: number, data: SoftwareGeometry,
    paint: Paint, instanceTint: THREE.Color): Uint32Array {
    let slots = this.faceTints.get(mesh);
    if (!slots) { slots = []; this.faceTints.set(mesh, slots); }
    const tint = this.diffuse.copy(paint.colour).multiply(instanceTint), light = this.localLight;
    let entry = slots[slot];
    if (entry?.data === data && entry.material === paint.material && entry.light.equals(light) &&
      entry.tint.equals(tint)) return entry.colours;
    if (!entry || entry.data !== data) {
      entry = { data, material: paint.material, light: new THREE.Vector3(), tint: new THREE.Color(),
        colours: new Uint32Array(data.materials.length) };
      slots[slot] = entry;
    }
    entry.material = paint.material; entry.light.copy(light); entry.tint.copy(tint);
    const normals = data.normals, vertex = paint.material.vertexColors ? data.colours : undefined;
    for (let i = 0; i < entry.colours.length; i++) {
      const k = i * 3;
      const shade = paint.unlit ? 1 : .75 + .27 * Math.max(-.6,
        normals[k]! * light.x + normals[k + 1]! * light.y + normals[k + 2]! * light.z);
      entry.colours[i] = pixel(this.channel(tint.r * (vertex ? vertex[k]! : 1), shade),
        this.channel(tint.g * (vertex ? vertex[k + 1]! : 1), shade),
        this.channel(tint.b * (vertex ? vertex[k + 2]! : 1), shade));
    }
    return entry.colours;
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
