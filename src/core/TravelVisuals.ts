import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gridSample } from '../world/terrain';
import type { IslandData, Vec3 } from '../world/types';
import { IslandTravel, rideIds, type Ride } from './IslandTravel';

const cream = 0xffe6b4,
  blue = 0x1b6875,
  dark = 0x293c43,
  brass = 0xd9a14d,
  wood = 0x9a6240,
  red = 0xc64640;
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

/** Bake each rigid assembly into one vertex-coloured draw. Wheels, burner and propeller move separately. */
class Assembly {
  private parts: T.BufferGeometry[] = [];
  add(g: T.BufferGeometry, color: number, x = 0, y = 0, z = 0, s = [1, 1, 1], rotation = new T.Quaternion()) {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    flat.deleteAttribute('uv');
    flat.applyMatrix4(new T.Matrix4().compose(v(x, y, z), rotation, v(s[0]!, s[1]!, s[2]!)));
    const col = new T.Color(color),
      colors = new Float32Array(flat.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = col.r;
      colors[i + 1] = col.g;
      colors[i + 2] = col.b;
    }
    flat.setAttribute('color', new T.BufferAttribute(colors, 3));
    this.parts.push(flat);
  }
  box(color: number, x: number, y: number, z: number, w: number, h: number, d: number) {
    this.add(new T.BoxGeometry(w, h, d), color, x, y, z);
  }
  oval(color: number, x: number, y: number, z: number, w: number, h: number, d: number) {
    this.add(new T.SphereGeometry(1, 18, 12), color, x, y, z, [w, h, d]);
  }
  rod(color: number, a: T.Vector3, b: T.Vector3, r: number) {
    const delta = b.clone().sub(a),
      mid = a.clone().lerp(b, 0.5);
    this.add(
      new T.CylinderGeometry(r, r, delta.length(), 8),
      color,
      mid.x,
      mid.y,
      mid.z,
      [1, 1, 1],
      new T.Quaternion().setFromUnitVectors(v(0, 1, 0), delta.normalize()),
    );
  }
  finish(mat: T.Material): T.Mesh {
    const geometry = mergeGeometries(this.parts)!;
    for (const g of this.parts) g.dispose();
    this.parts = [];
    const mesh = new T.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function boat(a: Assembly) {
  // Joined keel, chine, rubbing strake and narrow gunwales leave an open cockpit.
  const sections = [
    [-3.3, 0.05, 0.82],
    [-2.65, 0.82, 0.76],
    [-1.7, 1.15, 0.68],
    [-0.35, 1.25, 0.64],
    [1.35, 1.15, 0.6],
    [2.52, 0.92, 0.59],
  ];
  const points: number[] = [];
  function patch(p: number[], q: number[], r: number[], s: number[], color: number) {
    points.push(...p, ...q, ...r, ...p, ...r, ...s);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    g.computeVertexNormals();
    a.add(g, color);
    points.length = 0;
  }
  for (let i = 1; i < sections.length; i++) {
    const [z, w, h] = sections[i - 1]!,
      [zz, ww, hh] = sections[i]!;
    for (const side of [-1, 1]) {
      const ring = (s: number, width: number, height: number) => [
        [0, -0.37, s],
        [side * width * 0.74, -0.14, s],
        [side * width, height - 0.12, s],
        [side * width, height, s],
        [side * width * 0.8, height, s],
      ];
      const u = ring(z!, w!, h!),
        v = ring(zz!, ww!, hh!);
      for (let j = 0; j < 4; j++) patch(u[j]!, v[j]!, v[j + 1]!, u[j + 1]!, [dark, blue, cream, wood][j]!);
    }
  }
  a.box(blue, 0, 0.15, 2.5, 1.81, 0.85, 0.12);
  a.oval(wood, 0, 0.67, -1.95, 0.89, 0.11, 1.04);
  a.box(wood, 0, 0.31, 0.2, 1.7, 0.14, 3.4);
  a.box(cream, 0, 0.55, 1.23, 1.67, 0.28, 0.48);
  a.box(blue, 0, 0.76, 1.43, 1.72, 0.42, 0.16);
  a.box(cream, 0, 0.55, -0.1, 1.06, 0.23, 0.48);
  a.box(wood, 0, 0.83, -0.83, 1.65, 0.2, 0.37);
  a.rod(brass, v(-0.81, 0.86, -0.82), v(-0.72, 1.3, -0.9), 0.045);
  a.rod(brass, v(0.81, 0.86, -0.82), v(0.72, 1.3, -0.9), 0.045);
  a.rod(cream, v(-0.72, 1.3, -0.9), v(0.72, 1.3, -0.9), 0.041);
  a.oval(dark, 0, 0.39, 2.7, 0.31, 0.54, 0.36);
  a.oval(red, 0, 0.73, 2.7, 0.33, 0.22, 0.38);
  for (const x of [-1, 1]) {
    a.rod(brass, v(x * 0.7, 0.81, -2), v(x * 0.48, 0.94, -2.56), 0.04);
    a.oval(cream, x * 0.7, 0.66, 1.88, 0.1, 0.12, 0.17);
  }
}

function plane(a: Assembly) {
  a.oval(blue, 0, 1.33, 0, 0.65, 0.68, 2.83);
  a.oval(cream, 0, 1.55, -1.95, 0.66, 0.65, 0.85);
  a.oval(dark, 0, 1.51, -2.52, 0.58, 0.57, 0.37);
  a.oval(wood, 0, 1.84, 0.04, 0.54, 0.22, 0.78);
  a.oval(dark, 0, 1.94, 0.04, 0.42, 0.14, 0.56);
  for (const x of [-1, 1]) {
    a.oval(cream, x * 2.46, 1.02, -0.54, 2.58, 0.13, 0.92);
    a.oval(blue, x * 2.48, 3.03, -0.72, 2.71, 0.15, 0.94);
    a.oval(brass, x * 4.64, 3.04, -0.73, 0.54, 0.15, 0.86);
    a.rod(dark, v(x * 3.52, 1.1, -1.17), v(x * 3.7, 2.98, -0.15), 0.065);
    a.rod(dark, v(x * 3.52, 1.1, 0.01), v(x * 3.7, 2.98, -1.21), 0.065);
    a.rod(cream, v(x * 0.52, 1.65, -1.05), v(x * 1.06, 2.94, -0.83), 0.066);
    for (const z of [-0.95, 1.17]) a.rod(dark, v(x * 0.49, 1.03, z), v(x * 1.08, 0.04, z + 0.14), 0.07);
    a.oval(blue, x * 1.09, 0.02, 0.13, 0.34, 0.29, 2.35);
    a.oval(cream, x * 1.09, 0.14, 0.19, 0.32, 0.16, 2.21);
    a.oval(brass, x * 0.86, 1.5, 2.22, 0.95, 0.1, 0.47);
  }
  a.oval(red, 0, 2.03, 2.16, 0.12, 0.79, 0.65);
  a.oval(cream, 0, 1.54, -2.91, 0.22, 0.23, 0.28);
}

function balloon(a: Assembly) {
  // Tailored gores taper to a narrow throat above the four suspension lines.
  const profile = [
    [3.1, 0.68],
    [3.64, 1.14],
    [4.52, 2.12],
    [5.65, 2.86],
    [6.83, 3.18],
    [7.91, 3.06],
    [8.84, 2.62],
    [9.57, 1.87],
    [10.02, 0.93],
    [10.13, 0.03],
  ];
  for (let gore = 0; gore < 16; gore++) {
    const points: number[] = [];
    const vertex = (i: number, j: number) => {
      const [y, r] = profile[i]!,
        angle = ((gore + j / 3) * Math.PI) / 8,
        round = r! * (j % 3 === 0 ? 0.966 : 1);
      return [round * Math.sin(angle), y!, round * Math.cos(angle)];
    };
    for (let i = 0; i < profile.length - 1; i++)
      for (let j = 0; j < 3; j++)
        points.push(
          ...vertex(i, j),
          ...vertex(i, j + 1),
          ...vertex(i + 1, j + 1),
          ...vertex(i, j),
          ...vertex(i + 1, j + 1),
          ...vertex(i + 1, j),
        );
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    g.computeVertexNormals();
    a.add(g, [red, brass, cream, brass][gore % 4]!);
  }
  a.box(wood, 0, 0.14, 0, 2, 0.28, 1.64);
  for (const s of [-1, 1]) {
    for (let y = 0.28; y < 0.85; y += 0.14) {
      a.box(y < 0.5 ? wood : brass, s * 0.99, y, 0, 0.12, 0.13, 1.7);
      a.box(y < 0.5 ? wood : brass, 0, y, s * 0.81, 2, 0.13, 0.12);
    }
    for (const t of [-1, 1]) {
      a.rod(wood, v(s * 0.96, 0.16, t * 0.78), v(s * 0.96, 1, t * 0.78), 0.08);
      a.rod(dark, v(s * 0.96, 0.99, t * 0.78), v(s * 0.54, 3.4, t * 0.45), 0.04);
    }
  }
  a.box(dark, 0, 2.28, 0, 0.63, 0.21, 0.51);
}

function tram(a: Assembly) {
  a.box(dark, 0, 0.14, 0, 2.55, 0.28, 2.8);
  for (const x of [-1, 1]) {
    a.box(red, x * 1.21, 0.54, 0, 0.13, 0.72, 2.67);
    for (const z of [-1.29, 1.29]) a.rod(brass, v(x * 1.21, 0.19, z), v(x * 1.13, 2.55, z), 0.07);
    a.rod(cream, v(x * 1.21, 1.07, -1.29), v(x * 1.21, 1.07, 1.29), 0.045);
    a.box(wood, x * 0.91, 0.6, 0, 0.39, 0.14, 2.24);
  }
  a.box(cream, 0, 2.59, 0, 2.65, 0.18, 2.95);
  a.rod(dark, v(-0.7, 2.65, 0), v(0, 3.68, 0), 0.09);
  a.rod(dark, v(0.7, 2.65, 0), v(0, 3.68, 0), 0.09);
  a.box(dark, 0, 3.69, 0, 0.35, 0.36, 1.1);
}

export class TravelVisuals {
  readonly root = new T.Group();
  private readonly rigs = {} as Record<Ride, T.Group>;
  private readonly paint = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    side: T.DoubleSide,
  });
  private readonly glow = new T.MeshBasicMaterial({ color: 0xffb244 });
  private readonly foam = new T.MeshBasicMaterial({
    color: 0xe1ffff,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    side: T.DoubleSide,
  });
  private readonly propeller: T.Mesh;
  private readonly flame: T.Mesh;
  private readonly wake: T.Mesh;
  private readonly stationSigns: T.SpriteMaterial[] = [];
  constructor(
    private readonly travel: IslandTravel,
    island: IslandData,
  ) {
    this.root.name = 'Billy Isle travel';
    for (const id of rideIds) {
      const a = new Assembly();
      ({ boat, plane, balloon, tram })[id](a);
      const rig = new T.Group();
      rig.name = id;
      rig.add(a.finish(this.paint));
      this.root.add(rig);
      this.rigs[id] = rig;
    }
    const prop = new Assembly();
    for (const s of [-1, 1]) prop.oval(wood, 0, s * 0.56, 0, 0.12, 0.62, 0.065);
    this.propeller = prop.finish(this.paint);
    this.propeller.position.set(0, 1.54, -2.8);
    this.rigs.plane.add(this.propeller);
    this.flame = new T.Mesh(new T.ConeGeometry(0.23, 0.95, 10), this.glow);
    this.flame.position.y = 2.8;
    this.rigs.balloon.add(this.flame);
    const wg = new T.BufferGeometry(),
      foamVerts: number[] = [],
      colors: number[] = [];
    // Small broken crests peel off both chines and dissolve down the wake.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 11; i++) {
        const t = i / 11,
          end = (i + 0.78) / 11;
        const point = (u: number, edge: number) => [
          side * (0.65 + 2.6 * u + edge * (0.24 * (1 - u) + 0.06)),
          0,
          1.4 + u * 7.4 + edge * 0.28,
        ];
        for (const [u, edge] of [
          [t, 0],
          [t, 1],
          [end, 1],
          [t, 0],
          [end, 1],
          [end, 0],
        ] as const) {
          foamVerts.push(...point(u, edge));
          colors.push(1, 1, 1, (1 - u) * (0.48 + 0.42 * edge));
        }
      }
    }
    wg.setAttribute('position', new T.Float32BufferAttribute(foamVerts, 3));
    wg.setAttribute('color', new T.Float32BufferAttribute(colors, 4));
    this.foam.vertexColors = true;
    this.wake = new T.Mesh(wg, this.foam);
    this.wake.renderOrder = 4;
    this.root.add(this.wake);
    const cable = new Assembly();
    for (let i = 0; i <= 32; i++) {
      const p = travel.cablePoint(i / 32),
        top = v(p.x, p.y + 3.84, p.z);
      if (i) {
        const prev = travel.cablePoint((i - 1) / 32);
        cable.rod(dark, v(prev.x, prev.y + 3.84, prev.z), top, 0.057);
      }
      if (i % 8 === 0) {
        const yaw = travel.craft.tram.homeHeading,
          dx = Math.cos(yaw) * 2.12,
          dz = Math.sin(yaw) * 2.12;
        for (const s of [-1, 1]) {
          const x = p.x + s * dx,
            z = p.z + s * dz;
          cable.rod(wood, v(x, gridSample(island, x, z) - 0.5, z), v(x, top.y + 0.23, z), 0.16);
        }
        cable.rod(dark, v(p.x - dx, top.y + 0.23, p.z - dz), v(p.x + dx, top.y + 0.23, p.z + dz), 0.16);
      }
    }
    this.root.add(cable.finish(this.paint));
    for (const id of rideIds)
      this.sign(
        travel.craft[id].stop,
        { boat: 'MARINA', plane: 'SEAPLANES', balloon: 'BALLOON FIELD', tram: 'SUMMIT LINE' }[id],
      );
    this.sign(travel.summit, 'SUMMIT LINE');
  }
  private sign(p: Vec3, title: string) {
    const a = new Assembly();
    a.box(wood, 0, 0.92, 0, 0.15, 1.88, 0.15);
    const post = a.finish(this.paint);
    post.position.set(p.x + 2.1, p.y, p.z);
    this.root.add(post);
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 92;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#264952';
    ctx.fillRect(0, 0, 384, 92);
    ctx.strokeStyle = '#e3bd71';
    ctx.lineWidth = 5;
    ctx.strokeRect(5, 5, 374, 82);
    ctx.fillStyle = '#fff1d3';
    ctx.font = 'bold 40px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 192, 48, 345);
    const map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    const mat = new T.SpriteMaterial({ map });
    this.stationSigns.push(mat);
    const placard = new T.Sprite(mat);
    placard.scale.set(2.55, 0.61, 1);
    placard.position.copy(post.position);
    placard.position.y += 1.66;
    this.root.add(placard);
  }
  update(time: number, camera: T.Vector3) {
    for (const id of rideIds) {
      const c = this.travel.craft[id],
        rig = this.rigs[id];
      rig.position.copy(c.position);
      rig.visible = rig.position.distanceToSquared(camera) < 240 ** 2 || this.travel.active === id;
      const rocking = id === 'boat' ? Math.sin(time * 1.7) * 0.025 : 0;
      rig.rotation.set(c.pitch, -c.heading, -c.bank + rocking, 'YXZ');
      if (id === 'boat') rig.position.y += Math.sin(time * 1.7) * 0.06;
    }
    this.propeller.rotation.z =
      time * (this.travel.active === 'plane' ? 25 + this.travel.craft.plane.speed * 2 : 0);
    this.flame.visible = this.travel.active === 'balloon' && this.travel.craft.balloon.vertical > 0.15;
    this.flame.scale.y = 0.82 + 0.13 * Math.sin(time * 34);
    this.wake.visible = this.travel.active === 'boat' && this.travel.craft.boat.speed > 2;
    const boat = this.travel.craft.boat;
    this.wake.position.set(boat.position.x, boat.position.y + 0.16, boat.position.z);
    this.wake.rotation.y = -boat.heading;
    this.wake.scale.z = 0.55 + boat.speed * 0.035 + 0.04 * Math.sin(time * 7);
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    for (const s of this.stationSigns) {
      s.map?.dispose();
      s.dispose();
    }
    this.paint.dispose();
    this.glow.dispose();
    this.foam.dispose();
    this.root.removeFromParent();
  }
}
