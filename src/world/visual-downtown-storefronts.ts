import * as THREE from 'three';
import { libraryPlacementBounds } from './library-fit';
import { matchesStorefront } from './visual-hoofington';
import type { DowntownPlacement } from './visual-downtown';

type Lettering = readonly [paper: string, ink: string, face: string];
const signs: Record<string, Lettering> = {
  BAAKERY: ['#f7e4c6', '#813e42', 'Georgia'],
  CAFE: ['#355651', '#f6e7bd', 'Georgia'],
  GOATFLIX: ['#743c4d', '#ffe6ac', 'sans-serif'],
  BOUTIQUE: ['#efdfc9', '#47676c', 'Georgia'],
  'KID ARCADE': ['#46394e', '#f3d98e', 'monospace'],
  FLOWERS: ['#e3dfba', '#475f4e', 'Georgia'],
  BOOKS: ['#3e5964', '#f9e7c2', 'Georgia'],
  'ICE CREAM': ['#f5dece', '#864e62', 'Georgia'],
  'HAY MART': ['#576445', '#f7e5af', 'sans-serif'],
  'HOOF & CO': ['#e6cda8', '#624d48', 'Georgia'],
};

/** Match the district baker's axis-by-axis fit for authored shop models. */
function facadeTransform(place: DowntownPlacement, model: THREE.Group) {
  model.updateMatrixWorld(true);
  const bounds = libraryPlacementBounds(model), size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (Math.min(size.x, size.y, size.z) < .0001) return null;
  const scale = new THREE.Vector3(place.size.x * .96 / size.x,
    place.size.y * .98 / size.y, place.size.z * .96 / size.z);
  const rotate = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw);
  return (vertex: THREE.Vector3) => vertex.sub(center).multiply(scale).applyQuaternion(rotate).add(place.position);
}

function visitFacade(model: THREE.Group, title: string | undefined, name: string, visit: (point: THREE.Vector3) => void): void {
  const point = new THREE.Vector3();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh) || !matchesStorefront(node, title)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const geometry = node.geometry, positions = geometry.getAttribute('position'), indices = geometry.index;
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0,
      count: indices?.count ?? positions.count, materialIndex: 0 }];
    for (const part of groups) {
      const material = materials[part.materialIndex ?? 0] ?? materials[0];
      if (material?.name !== name) continue;
      for (let i = part.start; i < part.start + part.count; i++) {
        visit(point.fromBufferAttribute(positions, indices ? indices.getX(i) : i).applyMatrix4(node.matrixWorld));
      }
    }
  });
}

export function downtownWindowGeometry(
  placements: readonly DowntownPlacement[], sources: ReadonlyMap<string, THREE.Group>,
): THREE.BufferGeometry | null {
  const coordinates: number[] = [];
  for (const place of placements) {
    if (place.source?.kind !== 'shop') continue;
    const model = sources.get(place.model);
    if (!model) continue;
    const world = facadeTransform(place, model);
    if (!world) continue;
    visitFacade(model, place.storefront, 'ShopGlass', point => {
      const vertex = world(point);
      coordinates.push(vertex.x, vertex.y, vertex.z);
    });
  }
  if (!coordinates.length) return null;
  const geometry = new THREE.BufferGeometry();
  const colours = new Float32Array(coordinates.length / 3 * 4).fill(1);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const TILE_W = 512, TILE_H = 80, COLUMNS = 2, INSET = 3;

interface Panel {
  title: string;
  bounds: THREE.Box3;
  world: (vertex: THREE.Vector3) => THREE.Vector3;
}

function buildSigns(placements: readonly DowntownPlacement[], sources: ReadonlyMap<string, THREE.Group>) {
  const panels: Panel[] = [];
  for (const place of placements) {
    const title = place.storefront, model = sources.get(place.model);
    if (!title || !signs[title] || !model) continue;
    const world = facadeTransform(place, model);
    if (!world) continue;
    const bounds = new THREE.Box3();
    visitFacade(model, title, 'SignBoard', point => bounds.expandByPoint(point));
    if (bounds.isEmpty()) continue;
    bounds.max.z += .0008;
    panels.push({ title, bounds, world });
  }
  if (!panels.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W * COLUMNS;
  canvas.height = TILE_H * Math.ceil(panels.length / COLUMNS);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const [index, { title, bounds, world }] of panels.entries()) {
    const x = (index % COLUMNS) * TILE_W, y = Math.floor(index / COLUMNS) * TILE_H;
    const [paper, ink, face] = signs[title]!;
    ctx.fillStyle = paper;
    ctx.fillRect(x, y, TILE_W, TILE_H);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x + 10, y + 8, TILE_W - 20, TILE_H - 16);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 54px ${face}`;
    const aspect = (bounds.max.x - bounds.min.x) / (bounds.max.y - bounds.min.y);
    ctx.save();
    ctx.translate(x + TILE_W / 2, y + TILE_H / 2 + 2);
    const width = ctx.measureText(title).width;
    const scale = Math.min((TILE_W - 84) / width, TILE_W / (TILE_H * aspect) * 1.27);
    ctx.scale(scale, 1);
    ctx.fillText(title, 0, 0);
    ctx.restore();
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      const point = world(new THREE.Vector3(THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, u),
        THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, v), bounds.max.z));
      positions.push(point.x, point.y, point.z);
      uv.push((x + INSET + u * (TILE_W - INSET * 2)) / canvas.width,
        1 - (y + INSET + (1 - v) * (TILE_H - INSET * 2)) / canvas.height);
    }
    const first = index * 4;
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
  mesh.name = 'downtown-shop-signs-and-displays';
  return mesh;
}

export function buildDowntownStorefronts(
  placements: readonly DowntownPlacement[], sources: ReadonlyMap<string, THREE.Group>,
) {
  const group = new THREE.Group();
  const lettering = buildSigns(placements, sources);
  if (lettering) group.add(lettering);
  const glass = downtownWindowGeometry(placements, sources);
  const paint = glass ? new THREE.MeshBasicMaterial({ color: 0xffce87, transparent: true, vertexColors: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }) : undefined;
  if (glass && paint) {
    const windows = new THREE.Mesh(glass, paint);
    windows.name = 'occupied-shopfront-windows';
    group.add(windows);
  }
  return {
    group,
    setDaylight(daylight: number): void {
      if (lettering) lettering.material.color.setScalar(.55 + daylight * .45);
      if (!paint) return;
      paint.opacity = .68 * (1 - THREE.MathUtils.smoothstep(daylight, .15, .6));
      paint.visible = paint.opacity > .005;
    },
  };
}
