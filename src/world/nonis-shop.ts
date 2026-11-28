import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import sleevesUrl from './assets/nonis/sleeves.webp?url';
import type { NoniSession } from '../core/NoniSession';

const ink = 0x232435,
  steel = 0x55616b,
  copper = 0xb46d50,
  timber = 0x81503c;
const vermilion = 0xef6357,
  bone = 0xffdbad,
  teal = 0x57c8be;

/** The signed listening window is fitted to an existing, collidable shop shell. */
export function buildNoniShop(width: number) {
  const group = new T.Group(),
    pieces: T.BufferGeometry[] = [];
  const materials: T.Material[] = [],
    textures: T.Texture[] = [];
  const white = new T.MeshLambertMaterial({ vertexColors: true });
  materials.push(white);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number) => {
    const geo = new T.BoxGeometry(w, h, d);
    bake(geo.translate(x, y, z), color);
  };
  function bake(geo: T.BufferGeometry, tint: number) {
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    const c = new T.Color(tint),
      rgb = new Float32Array(flat.getAttribute('position').count * 3);
    for (let i = 0; i < rgb.length; i += 3) {
      rgb[i] = c.r;
      rgb[i + 1] = c.g;
      rgb[i + 2] = c.b;
    }
    flat.setAttribute('color', new T.BufferAttribute(rgb, 3));
    flat.deleteAttribute('uv');
    pieces.push(flat);
  }
  const disc = (x: number, y: number, z: number, r: number, d: number, color: number, vertical = false) => {
    const geo = new T.CylinderGeometry(r, r, d, 32);
    if (vertical) geo.rotateX(Math.PI / 2);
    bake(geo.translate(x, y, z), color);
  };
  const half = Math.min(4.85, width / 2 - 0.18),
    cabinet = half - 0.55;
  // The recessed back wall and deep fascia meet the street-facing wall at local z=-1.05.
  box(0, 1.75, -0.9, half * 2, 3.5, 0.45, ink);
  box(0, 0.12, -0.32, half * 2, 0.24, 1.52, steel);
  box(0, 3.53, -0.37, half * 2 + 0.16, 0.92, 1.52, ink);
  box(0, 3.04, -0.35, half * 2 + 0.22, 0.09, 1.64, copper);
  box(0, 4.01, -0.4, half * 2 + 0.24, 0.11, 1.63, steel);
  for (const sign of [-1, 1]) {
    box(sign * (half - 0.09), 1.57, -0.28, 0.18, 3.12, 1.47, copper);
    box(sign * cabinet, 1.06, -0.04, 0.7, 1.87, 0.67, ink);
    box(sign * cabinet, 1.06, 0.297, 0.61, 1.76, 0.035, steel);
    for (const [y, r] of [
      [0.65, 0.235],
      [1.43, 0.15],
    ] as const) {
      disc(sign * cabinet, y, 0.34, r + 0.038, 0.08, ink, true);
      disc(sign * cabinet, y, 0.388, r, 0.035, 0x454657, true);
      disc(sign * cabinet, y, 0.416, r * 0.37, 0.043, ink, true);
    }
    // Real jackets sit behind a raised lip in each flip bin.
    const x = sign * (half * 0.53);
    box(x, 0.6, -0.05, 1.08, 0.92, 0.78, timber);
    box(x, 0.96, 0.31, 1.11, 0.2, 0.11, copper);
    for (let i = 0; i < 4; i++) {
      const jacket = new T.BoxGeometry(0.83, 0.82, 0.048).rotateX(-0.15 - i * 0.035);
      bake(jacket.translate(x, 1.13 + i * 0.047, 0.17 - i * 0.095), [teal, ink, vermilion, bone][i]!);
    }
    box(x, 2.15, -0.62, 1.34, 1.34, 0.12, copper);
  }
  // Slatted oak and a framed house pressing behind the listening counter.
  for (let i = -6; i <= 6; i++) box(i * 0.215, 2.06, -0.625, 0.105, 1.38, 0.1, 0x614543);
  disc(0, 2.1, -0.527, 0.56, 0.095, copper, true);
  disc(0, 2.1, -0.47, 0.515, 0.04, 0x313640, true);
  for (const r of [0.4, 0.46]) {
    const groove = new T.TorusGeometry(r, 0.009, 5, 48).translate(0, 2.1, -0.443);
    bake(groove, steel);
  }
  disc(0, 2.1, -0.437, 0.161, 0.028, bone, true);
  disc(0, 2.1, -0.418, 0.026, 0.018, ink, true);
  for (const x of [-1, 1]) box(x * (half * 0.54), 2.9, -0.42, 1.52, 0.045, 0.14, bone);
  // A belt-drive platter, counterweight and cartridge sit within bleating reach.
  box(0, 0.67, 0.02, 1.75, 1.12, 0.8, timber);
  box(0, 1.24, 0.06, 1.86, 0.13, 1.02, bone);
  box(0, 1.35, 0.08, 1.32, 0.13, 0.76, ink);
  disc(-0.17, 1.435, 0.09, 0.335, 0.058, steel);
  disc(-0.17, 1.471, 0.09, 0.312, 0.023, 0x1f2030);
  disc(-0.17, 1.49, 0.09, 0.108, 0.018, vermilion);
  disc(-0.17, 1.507, 0.09, 0.02, 0.03, bone);
  box(0.38, 1.44, -0.1, 0.12, 0.08, 0.15, steel);
  bake(new T.BoxGeometry(0.045, 0.045, 0.38).rotateY(-0.6).translate(0.27, 1.48, 0.04), bone);
  box(0.17, 1.472, 0.2, 0.1, 0.05, 0.1, vermilion);
  const batch = mergeGeometries(pieces)!;
  for (const p of pieces) p.dispose();
  const shell = new T.Mesh(batch, white);
  shell.receiveShadow = true;
  group.add(shell);

  function plaque(map: T.Texture, x: number, y: number, z: number, w: number, h: number, side?: number) {
    map.colorSpace = T.SRGBColorSpace;
    const geo = new T.PlaneGeometry(w, h);
    if (side !== undefined) {
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, (side + 0.004 + uv.getX(i) * 0.992) / 2);
    }
    const mat = new T.MeshBasicMaterial({ map, toneMapped: false });
    materials.push(mat);
    const face = new T.Mesh(geo, mat);
    face.position.set(x, y, z);
    group.add(face);
    return face;
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 156;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#201e2a';
      ctx.fillRect(0, 0, 1024, 156);
      ctx.strokeStyle = '#b47054';
      ctx.lineWidth = 4;
      ctx.strokeRect(8, 7, 1008, 142);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'italic bold 116px Georgia';
      ctx.fillStyle = '#b94149';
      ctx.fillText('NONI’S', 374, 88);
      ctx.fillStyle = '#ffe4b5';
      ctx.fillText('NONI’S', 370, 82);
      ctx.fillStyle = '#ff7466';
      ctx.font = 'bold 53px Georgia';
      ctx.fillText('METAL', 789, 54);
      ctx.fillText('RECORDS', 789, 110);
      for (const x of [50, 954]) {
        ctx.fillStyle = '#edac79';
        ctx.beginPath();
        ctx.moveTo(x + 19, 28);
        ctx.lineTo(x - 9, 85);
        ctx.lineTo(x + 5, 81);
        ctx.lineTo(x - 10, 129);
        ctx.lineTo(x + 28, 64);
        ctx.lineTo(x + 13, 68);
        ctx.closePath();
        ctx.fill();
      }
      const map = new T.CanvasTexture(canvas);
      textures.push(map);
      plaque(map, 0, 3.53, 0.398, half * 2 - 0.16, 0.79);
    }
    const covers = new T.TextureLoader().load(sleevesUrl);
    textures.push(covers);
    for (const [index, sign] of [
      [0, -1],
      [1, 1],
    ] as const) {
      plaque(covers, sign * half * 0.53, 2.15, -0.552, 1.23, 1.23, index);
      const jacket = plaque(covers, sign * half * 0.53, 1.13, 0.204, 0.79, 0.79, index);
      jacket.rotation.x = -0.15;
    }
  }

  const lamps: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>[] = [];
  for (let i = 0; i < 4; i++) {
    const mat = new T.MeshBasicMaterial({ color: 0x593e42 }),
      lamp = new T.Mesh(new T.SphereGeometry(0.083, 12, 8), mat);
    materials.push(mat);
    lamp.position.set((i - 1.5) * 0.3, 2.83, -0.55);
    group.add(lamp);
    lamps.push(lamp);
  }
  const labelMat = new T.MeshBasicMaterial({ color: bone });
  materials.push(labelMat);
  const spindle = new T.Group();
  spindle.position.set(-0.17, 1.503, 0.09);
  group.add(spindle);
  const mark = new T.Mesh(new T.BoxGeometry(0.045, 0.008, 0.025), labelMat);
  mark.position.x = 0.074;
  spindle.add(mark);
  return {
    group,
    update(set: NoniSession, time: number) {
      const age = set.age(time),
        lit = age === undefined ? 0 : set.side === 1 ? 4 : set.lights(age);
      lamps.forEach((lamp, i) =>
        lamp.material.color.setHex(i < lit ? (set.side === 1 ? teal : vermilion) : 0x59404b),
      );
      if (age !== undefined) spindle.rotation.y = -age * 3.49;
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
