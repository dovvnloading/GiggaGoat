import * as THREE from 'three';
import type { DowntownPlacement } from './visual-downtown';

const STOREFRONT_PALETTE: Record<string, readonly [trim: string, sign: string, ink: string, display: string]> = {
  'CAFE': ['#af553c', '#fff1ce', '#542e33', '#dd8a5b'],
  'GOATFLIX': ['#dd5873', '#332840', '#fff2da', '#87c5bd'],
  'BOUTIQUE': ['#b88c52', '#fff1dc', '#633958', '#e6a6b4'],
  'KID ARCADE': ['#b66cf1', '#46265e', '#fff3a5', '#b18cf9'],
  'BAAKERY': ['#ce5860', '#fff0d1', '#703632', '#f0b36c'],
  'FLOWERS': ['#71995d', '#fff1db', '#3e683f', '#e793a9'],
  'BOOKS': ['#7093aa', '#f8dd97', '#344a5d', '#d17b66'],
  'ICE CREAM': ['#e58090', '#fff3e6', '#75426b', '#9cd5cc'],
  'HAY MART': ['#a9b764', '#37684c', '#fff0bd', '#e8bd59'],
  'HOOF & CO': ['#56a48b', '#fff3d7', '#325751', '#e0a485'],
};

/** Match the district baker's axis-by-axis fit for authored shop models. */
function facadeTransform(place: DowntownPlacement, model: THREE.Group) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (Math.min(size.x, size.y, size.z) < .0001) return null;
  const scale = new THREE.Vector3(place.size.x * .96 / size.x,
    place.size.y * .98 / size.y, place.size.z * .96 / size.z);
  const rotate = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw);
  return (vertex: THREE.Vector3) => vertex.sub(center).multiply(scale).applyQuaternion(rotate).add(place.position);
}

function visitFacade(model: THREE.Group, name: string, visit: (point: THREE.Vector3) => void): void {
  const point = new THREE.Vector3();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const geometry = node.geometry, positions = geometry.getAttribute('position'), indices = geometry.index;
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0,
      count: indices?.count ?? positions.count, materialIndex: 0 }];
    for (const part of groups) {
      if (materials[part.materialIndex ?? 0]?.name !== name) continue;
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
    visitFacade(model, 'ShopGlass', point => {
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

const TILE_W = 256, TILE_H = 96, COLUMNS = 4, ROWS = 5, INSET = 5;
interface Panel { title: string; window: boolean; bounds: THREE.Box3; world: (vertex: THREE.Vector3) => THREE.Vector3 }

function storefrontPanels(placements: readonly DowntownPlacement[], sources: ReadonlyMap<string, THREE.Group>): Panel[] {
  const panels: Panel[] = [];
  for (const place of placements) {
    const title = place.storefront;
    const model = sources.get(place.model);
    if (!title || !STOREFRONT_PALETTE[title] || !model) continue;
    const world = facadeTransform(place, model);
    if (!world) continue;
    for (const window of [false, true]) {
      const bounds = new THREE.Box3();
      visitFacade(model, window ? 'ShopGlass' : 'SignBoard', point => { bounds.expandByPoint(point); });
      if (bounds.isEmpty()) continue;
      if (window) {
        // Dress the lower window, leaving the upper panes and frames in place.
        bounds.min.x += .006;
        bounds.max.x -= .006;
        bounds.min.y += .004;
        bounds.max.y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, .61);
      } else {
        const centerX = (bounds.max.x + bounds.min.x) / 2;
        const halfWidth = Math.min((bounds.max.x - bounds.min.x) * .49,
          (bounds.max.y - bounds.min.y) * (title.length * .31 + 1.1));
        bounds.min.x = centerX - halfWidth;
        bounds.max.x = centerX + halfWidth;
      }
      bounds.max.z += .0018;
      panels.push({ title, window, bounds, world });
    }
  }
  return panels;
}

function drawWindow(ctx: CanvasRenderingContext2D, title: string, trim: string, accent: string): void {
  const glass = ctx.createLinearGradient(0, 0, 0, TILE_H);
  glass.addColorStop(0, '#485a67'); glass.addColorStop(1, '#283b48');
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, TILE_W, TILE_H);
  ctx.fillStyle = '#8594a0';
  ctx.fillRect(6, 11, TILE_W - 12, 3);
  for (let bay = 0; bay < 4; bay++) {
    const x = bay * 64 + 32;
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    if (title === 'BOOKS') {
      for (let book = 0; book < 4; book++) ctx.fillRect(x - 17 + book * 9, 40 + (book % 2) * 7, 7, 30 - (book % 2) * 7);
    } else if (title === 'GOATFLIX' || title === 'KID ARCADE') {
      ctx.fillRect(x - 18, 33, 36, 36);
      ctx.fillStyle = '#39364c';
      ctx.fillRect(x - 13, 38, 26, 18);
      ctx.fillStyle = '#fff0c3';
      ctx.fillRect(x - 8, 59, 16, 3);
    } else if (title === 'BOUTIQUE' || title === 'HOOF & CO') {
      ctx.beginPath();
      ctx.moveTo(x - 8, 33); ctx.lineTo(x - 22, 46); ctx.lineTo(x - 15, 57);
      ctx.lineTo(x - 10, 53); ctx.lineTo(x - 10, 69); ctx.lineTo(x + 10, 69);
      ctx.lineTo(x + 10, 53); ctx.lineTo(x + 15, 57); ctx.lineTo(x + 22, 46);
      ctx.lineTo(x + 8, 33); ctx.closePath(); ctx.fill();
    } else if (title === 'CAFE' || title === 'ICE CREAM') {
      ctx.beginPath();
      ctx.roundRect(x - 15, 45, 25, 21, 5); ctx.fill();
      ctx.strokeRect(x + 10, 48, 7, 10);
      ctx.fillRect(x - 20, 67, 35, 3);
    } else if (title === 'FLOWERS') {
      ctx.fillStyle = '#82a66a';
      ctx.fillRect(x - 2, 42, 4, 17);
      ctx.fillStyle = accent;
      for (const [dx, dy] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) {
        ctx.beginPath(); ctx.ellipse(x + dx!, 38 + dy!, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#bb745a'; ctx.fillRect(x - 9, 56, 18, 14);
    } else {
      for (let item = 0; item < 3; item++) {
        ctx.beginPath();
        ctx.ellipse(x - 13 + item * 12, 60 - (item % 2) * 7,
          title === 'BAAKERY' ? 10 : 7, 8, .25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#aeb8bb';
    ctx.fillRect(bay * 64, 1, 3, TILE_H - 1);
  }
  ctx.fillStyle = trim;
  ctx.fillRect(0, 72, TILE_W, 10);
  ctx.fillStyle = '#c8b5a0';
  ctx.fillRect(0, 72, TILE_W, 3);
}

/** One small atlas and one draw for signs and displays on the existing facades. */
function buildFrontage(placements: readonly DowntownPlacement[], sources: ReadonlyMap<string, THREE.Group>) {
  const panels = storefrontPanels(placements, sources);
  if (!panels.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W * COLUMNS; canvas.height = TILE_H * ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const [index, { title, window, bounds, world }] of panels.entries()) {
    const [trim, sign, ink, display] = STOREFRONT_PALETTE[title]!;
    const x = (index % COLUMNS) * TILE_W, y = Math.floor(index / COLUMNS) * TILE_H;
    ctx.save();
    ctx.translate(x, y);
    if (window) drawWindow(ctx, title, trim, display);
    else {
      ctx.fillStyle = trim; ctx.fillRect(0, 0, TILE_W, TILE_H);
      ctx.fillStyle = sign; ctx.fillRect(10, 10, TILE_W - 20, TILE_H - 20);
      ctx.strokeStyle = trim; ctx.lineWidth = 2;
      ctx.strokeRect(15, 15, TILE_W - 30, TILE_H - 30);
      ctx.fillStyle = ink;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.font = '900 49px sans-serif';
      ctx.fillText(title, TILE_W / 2, TILE_H / 2 + 2, TILE_W - 48);
      ctx.fillStyle = trim;
      ctx.fillRect(20, TILE_H / 2 - 2, 5, 5);
      ctx.fillRect(TILE_W - 25, TILE_H / 2 - 2, 5, 5);
    }
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
  const frontage = buildFrontage(placements, sources);
  if (frontage) group.add(frontage);
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
      if (frontage) frontage.material.color.setScalar(.55 + daylight * .45);
      if (!paint) return;
      paint.opacity = .68 * (1 - THREE.MathUtils.smoothstep(daylight, .15, .6));
      paint.visible = paint.opacity > .005;
    },
  };
}
