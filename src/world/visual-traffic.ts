import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GraphicsQuality } from '../core/GraphicsQuality';
import type { IslandTraffic, TrafficVehicle } from '../core/IslandTraffic';
import { angleDelta } from './traffic-lanes';
import { publicAssetUrl } from './public-assets';

const BRANDS = {
  post: { tile: 0, paint: 0x12646b },
  bakery: { tile: 1, paint: 0xe8bf86 },
  records: { tile: 2, paint: 0x3a3943 },
  express: { tile: 3, paint: 0x83c7ba },
};
const HEADLAMP = 0xffedb9,
  BRAKE = 0xff3927,
  AMBER = 0xffae37;

/** Print the local registration directly on the manufacturer's molded license plate. */
function registration(code: string): THREE.CanvasTexture | undefined {
  const sheet = document.createElement('canvas');
  sheet.width = 256;
  sheet.height = 128;
  const ink = sheet.getContext('2d');
  if (!ink) return;
  ink.fillStyle = '#fbebba';
  ink.fillRect(0, 0, 256, 128);
  ink.strokeStyle = '#244651';
  ink.lineWidth = 5;
  ink.strokeRect(7, 6, 242, 116);
  ink.textAlign = 'center';
  ink.fillStyle = '#245367';
  ink.font = 'bold 19px sans-serif';
  ink.fillText('B I L L Y   I S L E', 128, 31);
  ink.fillStyle = '#152f38';
  ink.font = 'bold 55px monospace';
  ink.fillText(code, 128, 93, 213);
  const texture = new THREE.CanvasTexture(sheet);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
type Finish = THREE.MeshStandardMaterial;
interface Rig {
  car: TrafficVehicle;
  root: THREE.Group;
  near: THREE.Object3D;
  far: THREE.Object3D;
  wheels: { node: THREE.Object3D; radius: number; front: boolean }[];
  lamps: Map<string, Finish>;
  finishes: THREE.Material[];
  shadow: THREE.Mesh;
  caster?: THREE.Object3D;
  hatch?: THREE.Object3D;
  arm?: THREE.Object3D;
}

/** The print follows the donor vehicle's sheet metal, including the shuttle's inclined rear quarter. */
function sidePanels(shuttle: boolean, tile: number): THREE.BufferGeometry {
  const verts: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const y0 = shuttle ? 0.81 : 0.66,
    y1 = shuttle ? 1.24 : 1.52;
  const z0 = shuttle ? -1.17 : -1.42,
    z1 = shuttle ? -0.29 : 0.33;
  const left = (tile % 2) * 0.5 + 0.003,
    right = left + 0.494,
    top = 1 - Math.floor(tile / 2) * 0.5 - 0.003,
    bottom = top - 0.494;
  for (const side of [-1, 1]) {
    const first = verts.length / 3;
    for (const [u, v, z, y] of [
      [left, bottom, side > 0 ? z1 : z0, y0],
      [right, bottom, side > 0 ? z0 : z1, y0],
      [right, top, side > 0 ? z0 : z1, y1],
      [left, top, side > 0 ? z1 : z0, y1],
    ]) {
      const x = shuttle ? 0.5525 - 0.2 * (y! - 0.8) : 0.6525;
      verts.push(side * x, y!, z!);
      uv.push(u!, v!);
    }
    index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function releaseScene(root: THREE.Object3D): void {
  const geometry = new Set<THREE.BufferGeometry>(),
    mats = new Set<THREE.Material>(),
    maps = new Set<THREE.Texture>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometry.add(node.geometry);
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
      mats.add(m);
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) maps.add(value);
    }
  });
  for (const g of geometry) g.dispose();
  for (const m of mats) m.dispose();
  for (const t of maps) t.dispose();
}

export class TrafficVisuals {
  readonly root = new THREE.Group();
  private readonly rigs: Rig[] = [];
  private readonly panels = new Map<number, THREE.BufferGeometry>();
  private readonly shadowShape = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
  private readonly shadowPaint = new THREE.MeshBasicMaterial({
    color: 0x273739,
    transparent: true,
    opacity: 0.21,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  private readonly assets: THREE.Object3D[] = [];
  private readonly plates: THREE.Texture[] = [];
  private atlas?: THREE.Texture;
  private readonly headlamps: THREE.SpotLight[] = [];
  private disposed = false;

  constructor(private readonly traffic: IslandTraffic) {
    this.root.name = 'island-road-traffic';
    for (let i = 0; i < 2; i++) {
      const lamp = new THREE.SpotLight(0xffe6b3, 0, 16 * traffic.scale, 0.4, 0.72, 1.8);
      this.root.add(lamp, lamp.target);
      this.headlamps.push(lamp);
    }
    this.root.userData.ready = false;
    if (typeof document !== 'undefined') {
      for (const car of traffic.vehicles) car.available = false;
      void this.load();
    }
  }
  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    const atlas = new THREE.TextureLoader()
      .loadAsync(publicAssetUrl('assets/island-traffic/service-liveries.webp'))
      .then(
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          if (this.disposed) texture.dispose();
          else {
            this.atlas = texture;
            for (const rig of this.rigs) this.paintService(rig);
          }
        },
        () => {}
      );
    try {
      const gltf = await loader.loadAsync(publicAssetUrl('assets/island-traffic/fleet.glb'));
      if (this.disposed) {
        releaseScene(gltf.scene);
        return;
      }
      this.assets.push(gltf.scene);
      for (const car of this.traffic.vehicles) {
        const prototype = gltf.scene.children.find((model) => model.userData.fleetModel === car.service.model);
        if (prototype) this.install(car, prototype);
      }
    } catch {
      // An unavailable optimized bundle can still use the original licensed models already shipped on Pages.
      await Promise.all(
        [...new Set(this.traffic.vehicles.map((c) => c.service.model))].map(async (model) => {
          if (this.disposed) return;
          try {
            const { scene } = await loader.loadAsync(
              publicAssetUrl('assets/library/kenney/car-kit/' + model + '.glb')
            );
            if (this.disposed) {
              releaseScene(scene);
              return;
            }
            this.assets.push(scene);
            for (const car of this.traffic.vehicles) if (car.service.model === model) this.install(car, scene);
          } catch {
            /* Other vehicles remain available if an individual donor asset is offline. */
          }
        })
      );
    }
    await atlas;
    if (!this.disposed) this.root.userData.ready = true;
  }
  private install(car: TrafficVehicle, template: THREE.Object3D): void {
    const root = new THREE.Group(),
      model = template.clone(true);
    const near = model.children.find((c) => c.userData.detail) ?? model;
    const far = model.children.find((c) => c.userData.distant) ?? near;
    const wheels: Rig['wheels'] = [],
      lamps: Rig['lamps'] = new Map();
    const materials = new Map<THREE.Material, Finish>();
    let distantGlass: Finish | undefined;
    const brand = car.service.livery && BRANDS[car.service.livery];
    const finish = (original: Finish): Finish => {
      let m = materials.get(original);
      if (m) return m;
      m = original.clone();
      materials.set(original, m);
      if (m.name === 'registration') {
        const fleet = { post: 'POST', bakery: 'EAP', records: 'AMP', express: 'CAPE' };
        const prefix = car.service.livery ? fleet[car.service.livery] : 'BI';
        const number = String(this.traffic.vehicles.indexOf(car) + 1).padStart(2, '0');
        const plate = registration(prefix + ' ' + number);
        m.map = plate ?? null;
        if (plate) this.plates.push(plate);
        m.roughness = 0.52;
      }
      if (m.name === 'coachwork' && brand) {
        m.map = null;
        m.color.setHex(brand.paint);
      }
      if (m.name === 'windscreen') {
        m.map = null;
        m.color.setHex(0x6c9ea9);
        m.roughness = 0.19;
        m.metalness = 0.08;
        m.transparent = true;
        m.opacity = 0.38;
        m.depthWrite = false;
        m.userData.trafficOpacity = 0.38;
      }
      if (/^(front|rear)-/.test(m.name)) lamps.set(m.name, m);
      return m;
    };
    let hatch: THREE.Object3D | undefined, arm: THREE.Object3D | undefined;
    model.traverse((node) => {
      const part = String(node.userData.part ?? node.name);
      if (/^wheel-(front|back)-(left|right)$/.test(part)) {
        const wheelMesh =
          node instanceof THREE.Mesh ? node : node.children.find((child) => child instanceof THREE.Mesh);
        if (wheelMesh instanceof THREE.Mesh) {
          wheelMesh.geometry.computeBoundingBox();
          const box = wheelMesh.geometry.boundingBox!;
          wheels.push({
            node,
            radius: (box.max.y - box.min.y) * 0.5 * car.scale,
            front: part.startsWith('wheel-front'),
          });
        }
      }
      if (part === 'door') hatch = node;
      if (part === 'arm') arm = node;
      if (node instanceof THREE.Mesh) {
        node.receiveShadow = true;
        node.material = Array.isArray(node.material)
          ? node.material.map((m) => finish(m))
          : finish(node.material);
      }
    });
    if (far !== near)
      far.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || node.material.name !== 'windscreen') return;
        if (!distantGlass) {
          distantGlass = node.material.clone();
          distantGlass!.color.setHex(0x385462);
          distantGlass!.opacity = 1;
          distantGlass!.transparent = false;
          distantGlass!.depthWrite = true;
          distantGlass!.userData.trafficOpacity = 1;
        }
        node.material = distantGlass;
      });
    root.add(model);
    const finishes: THREE.Material[] = [...materials.values()];
    if (distantGlass) finishes.push(distantGlass);
    const shadow = new THREE.Mesh(this.shadowShape, this.shadowPaint);
    shadow.scale.set((car.width / car.scale) * 0.52, 1, (car.length / car.scale) * 0.48);
    shadow.position.y = 0.021;
    root.add(shadow);
    root.scale.setScalar(car.scale);
    const caster = far !== near ? far.clone(true) : undefined;
    if (caster) {
      caster.traverse((n) => {
        n.layers.set(1);
        if (n instanceof THREE.Mesh) {
          n.castShadow = true;
          n.receiveShadow = false;
        }
      });
      root.add(caster);
    }
    root.rotation.order = 'YXZ';
    root.visible = false;
    root.name = car.service.name;
    this.root.add(root);
    const rig = { root, car, near, far, wheels, lamps, finishes, shadow, caster, hatch, arm };
    this.rigs.push(rig);
    this.paintService(rig);
    car.available = true;
  }

  private paintService({ car, root, finishes }: Rig): void {
    const brand = car.service.livery && BRANDS[car.service.livery];
    if (brand && this.atlas) {
      let geometry = this.panels.get(brand.tile);
      if (!geometry) {
        geometry = sidePanels(car.service.model === 'van', brand.tile);
        this.panels.set(brand.tile, geometry);
      }
      const material = new THREE.MeshStandardMaterial({
        map: this.atlas,
        roughness: 0.76,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      finishes.push(material);
      const print = new THREE.Mesh(geometry, material);
      print.name = 'painted-service-panels';
      print.receiveShadow = true;
      root.add(print);
    }
  }

  update(time: number, alpha: number, camera: THREE.Vector3, quality: GraphicsQuality, night: boolean): void {
    this.root.visible = this.traffic.enabled;
    if (!this.root.visible) return;
    for (const lamp of this.headlamps) lamp.intensity = 0;
    const distanceSq = ({ car: { pose } }: Rig) =>
      (camera.x - pose.x) ** 2 + (camera.y - pose.y) ** 2 + (camera.z - pose.z) ** 2;
    const closest =
      night && quality !== 'low'
        ? this.rigs
            .filter((rig) => distanceSq(rig) < (33 * this.traffic.scale) ** 2)
            .sort((a, b) => distanceSq(a) - distanceSq(b))
            .slice(0, 2)
        : [];
    for (const [i, rig] of closest.entries()) {
      const lamp = this.headlamps[i]!,
        p = rig.car.pose,
        dx = Math.sin(p.yaw),
        dz = Math.cos(p.yaw);
      const front = rig.car.length * 0.44,
        beam = 10 * this.traffic.scale;
      lamp.position.set(p.x + dx * front, p.y + 0.77 * rig.car.scale, p.z + dz * front);
      lamp.target.position.set(
        lamp.position.x + dx * beam,
        p.y - Math.tan(p.pitch) * beam - 0.18 * this.traffic.scale,
        lamp.position.z + dz * beam
      );
      lamp.intensity = 29 * this.traffic.scale ** 2;
    }
    const unit = this.traffic.scale,
      cutoff = (quality === 'low' ? 80 : quality === 'medium' ? 126 : 164) * unit;
    for (const rig of this.rigs) {
      const { car, root, near, far } = rig,
        p = car.pose,
        a = car.previous;
      const x = a.x + (p.x - a.x) * alpha,
        y = a.y + (p.y - a.y) * alpha,
        z = a.z + (p.z - a.z) * alpha;
      const distance = Math.hypot(camera.x - x, camera.y - y - car.height * 0.5, camera.z - z);
      root.visible = distance < cutoff;
      if (!root.visible) continue;
      root.position.set(x, y + 0.008 * unit, z);
      root.rotation.set(
        a.pitch + (p.pitch - a.pitch) * alpha,
        a.yaw + angleDelta(p.yaw - a.yaw) * alpha,
        0,
        'YXZ'
      );
      const detailed = distance < (quality === 'low' ? 17 : quality === 'medium' ? 28 : 39) * unit;
      if (near !== far) {
        near.visible = detailed;
        far.visible = !detailed;
      }
      if (detailed || near === far) {
        const travelled = car.odometer - car.lastStep * (1 - alpha);
        for (const wheel of rig.wheels) {
          const steer = wheel.front
            ? Math.max(-0.43, Math.min(0.43, Math.atan(p.curvature * car.length * 0.62)))
            : 0;
          wheel.node.rotation.set(travelled / wheel.radius, steer, 0, 'YXZ');
        }
        const delivery = car.dwell > 0 ? Math.min(1, car.dwell * 2, (3.5 - car.dwell) * 2) : 0;
        if (rig.hatch) rig.hatch.rotation.x = Math.max(0, delivery) * 1.18;
        if (rig.arm) rig.arm.rotation.x = car.dwell > 0 ? -0.54 * Math.sin((Math.PI * car.dwell) / 5) ** 2 : 0;
      }
      rig.shadow.visible = distance < 54 * unit;
      if (rig.caster) rig.caster.visible = quality !== 'low' && distance < 24 * unit;
      const blink = Math.floor(time * 2.6) % 2 === 0,
        since = time - car.answeredAt;
      const flash = since >= 0 && (since < 0.14 || (since > 0.28 && since < 0.43));
      const curve = car.pose.curvature;
      for (const [name, lamp] of rig.lamps) {
        const front = name.startsWith('front'),
          left = name.endsWith('left');
        const signal = blink && (car.dwell > 0 || (Math.abs(curve) > 0.066 / unit && curve > 0 === left));
        lamp.emissive.setHex(signal ? AMBER : front ? HEADLAMP : BRAKE);
        lamp.emissiveIntensity = signal
          ? 1.1
          : front
            ? night || flash
              ? 1.35
              : 0
            : car.braking
              ? 1.25
              : night
                ? 0.38
                : 0;
      }
      const dx = camera.x - x,
        dz = camera.z - z,
        cs = Math.cos(p.yaw),
        sn = Math.sin(p.yaw);
      const clearance = Math.hypot(
        Math.max(0, Math.abs(dx * cs - dz * sn) - car.width * 0.5),
        Math.max(0, Math.abs(dx * sn + dz * cs) - car.length * 0.5),
        Math.max(0, Math.abs(camera.y - y - car.height * 0.5) - car.height * 0.5)
      );
      const opacity =
        THREE.MathUtils.smoothstep(clearance, 0.08 * unit, 1.1 * unit) *
        THREE.MathUtils.smoothstep(cutoff - distance, 0, 13 * unit);
      for (const m of rig.finishes) {
        const value = opacity * (m.userData.trafficOpacity ?? 1);
        if (m.transparent !== value < 0.999) {
          m.transparent = value < 0.999;
          m.depthWrite = !m.transparent;
          m.needsUpdate = true;
        }
        m.opacity = value;
      }
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const rig of this.rigs) {
      rig.car.available = false;
      for (const m of rig.finishes) m.dispose();
    }
    for (const p of this.panels.values()) p.dispose();
    this.atlas?.dispose();
    for (const plate of this.plates) plate.dispose();
    this.shadowShape.dispose();
    this.shadowPaint.dispose();
    for (const asset of this.assets) releaseScene(asset);
    this.rigs.length = 0;
    this.root.clear();
  }
}
