import * as THREE from 'three';
import type { ComboPopTier } from './comboPopMath';

interface LetterColors {
  readonly edge: string;
  readonly rim: string;
  readonly top: string;
  readonly middle: string;
  readonly bottom: string;
}

export interface ComboPopPalette {
  readonly burstInner: string;
  readonly burstOuter: string;
  readonly burstEdge: string;
  readonly word: LetterColors;
  readonly multiplier: LetterColors;
  readonly stars: number;
}

/** Hand-tuned to the three beats of the approved COMBO POP TEXT panel. */
export const COMBO_POP_PALETTES: Readonly<Record<ComboPopTier, ComboPopPalette>> = {
  2: {
    burstInner: '#fffdea', burstOuter: '#ffdc1a', burstEdge: '#ffad07',
    word: {
      edge: '#172178', rim: '#23aafb',
      top: '#e9ffff', middle: '#42d5ff', bottom: '#0368ee',
    },
    multiplier: {
      edge: '#171e82', rim: '#f99317',
      top: '#ffff85', middle: '#ffde16', bottom: '#ff8b05',
    },
    stars: 0,
  },
  3: {
    burstInner: '#fff8ba', burstOuter: '#ffca00', burstEdge: '#ff8c00',
    word: {
      edge: '#811151', rim: '#ffcb16',
      top: '#fffd77', middle: '#ff9a00', bottom: '#ed282a',
    },
    multiplier: {
      edge: '#8c1258', rim: '#f4472a',
      top: '#ffff7f', middle: '#ffe000', bottom: '#ff9a00',
    },
    stars: 5,
  },
  4: {
    burstInner: '#ffe0ff', burstOuter: '#d62aec', burstEdge: '#8a16c2',
    word: {
      edge: '#54106d', rim: '#ed249c',
      top: '#fffba2', middle: '#ffe000', bottom: '#ff9703',
    },
    multiplier: {
      edge: '#5c086e', rim: '#ed249d',
      top: '#ffff9e', middle: '#ffe000', bottom: '#ff9c05',
    },
    stars: 8,
  },
};

const SIDE = 512;

/** A transparent, anti-aliased star silhouette with uneven pointed rays. */
function paintBurst(ctx: CanvasRenderingContext2D, tier: ComboPopTier): void {
  const p = COMBO_POP_PALETTES[tier];
  const spikes = tier === 4 ? 15 : tier === 3 ? 14 : 12;
  ctx.save();
  ctx.translate(256, 257);
  const glow = ctx.createRadialGradient(0, 0, 22, 0, 0, 204);
  glow.addColorStop(0, p.burstInner);
  glow.addColorStop(0.52, p.burstInner);
  glow.addColorStop(0.83, p.burstOuter);
  glow.addColorStop(1, p.burstEdge);
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const angle = -Math.PI / 2 + Math.PI * i / spikes;
    const outer = i % 2 === 0;
    const irregularity = 1 + 0.12 * Math.sin(i * 5.47) + 0.06 * Math.cos(i * 2.77);
    const radius = (outer ? (tier === 4 ? 207 : 188) : 91) * irregularity;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.shadowColor = p.burstOuter;
  ctx.shadowBlur = tier === 4 ? 24 : 14;
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = p.burstEdge;
  ctx.lineWidth = tier === 4 ? 5 : 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Thin tapered rays help the yellow and gold tiers read as impact flashes.
  for (let i = 0; i < spikes; i++) {
    const angle = Math.PI * 2 * (i + 0.14 * Math.sin(i * 7.1)) / spikes;
    const start = 148 + 8 * Math.cos(i * 5);
    const end = (tier === 4 ? 216 : 213) + (i % 3) * 11;
    const side = tier === 4 ? 3 : 2.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * start - Math.sin(angle) * side,
      Math.sin(angle) * start + Math.cos(angle) * side);
    ctx.lineTo(Math.cos(angle) * end, Math.sin(angle) * end);
    ctx.lineTo(Math.cos(angle) * start + Math.sin(angle) * side,
      Math.sin(angle) * start - Math.cos(angle) * side);
    ctx.closePath();
    ctx.fillStyle = tier === 4 ? '#ee44f5' : '#ffbf05';
    ctx.fill();
  }
  ctx.restore();
}

function paintStar(
  ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 === 0 ? radius : radius * 0.47;
    const sx = Math.cos(angle) * r;
    const sy = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.shadowColor = '#ffa600';
  ctx.shadowBlur = 7;
  ctx.fillStyle = '#ffdd00';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ff8700';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-radius * 0.25, -radius * 0.15);
  ctx.lineTo(-radius * 0.03, -radius * 0.44);
  ctx.strokeStyle = '#fff9ae';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function paintStars(ctx: CanvasRenderingContext2D, tier: ComboPopTier): void {
  const points: readonly (readonly [number, number, number, number])[] = [
    [112, 106, 20, -0.2],
    [371, 61, 22, 0.12],
    [442, 150, 17, 0.4],
    [86, 388, 21, -0.3],
    [408, 410, 18, 0.15],
    [470, 340, 20, -0.25],
    [141, 446, 15, 0.3],
    [253, 44, 17, -0.2],
  ];
  const count = COMBO_POP_PALETTES[tier].stars;
  for (let i = 0; i < count; i++) {
    const point = points[i]!;
    paintStar(ctx, point[0], point[1], point[2], point[3]);
  }
}

/** Thick dark comic ink, a bright colored inner rim and glossy gradient faces. */
function paintLetters(
  ctx: CanvasRenderingContext2D,
  label: string, y: number, fontSize: number, colors: LetterColors,
): void {
  ctx.save();
  ctx.translate(256, y);
  ctx.rotate(-0.10);
  ctx.font = 'italic 1000 ' + fontSize + 'px "Arial Black", Impact, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const measure = ctx.measureText(label).width;
  const widthScale = Math.min(1, 396 / Math.max(1, measure));
  ctx.scale(widthScale, 1);

  ctx.strokeStyle = '#4b135a';
  ctx.lineWidth = 29;
  ctx.shadowColor = '#50116a';
  ctx.shadowBlur = 8;
  ctx.strokeText(label, 7, 10);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 26;
  ctx.strokeText(label, 0, 0);
  ctx.strokeStyle = colors.rim;
  ctx.lineWidth = 15;
  ctx.strokeText(label, 0, 0);
  ctx.strokeStyle = '#fffaf0';
  ctx.lineWidth = 5.5;
  ctx.strokeText(label, 0, 0);
  const face = ctx.createLinearGradient(0, -fontSize * 0.49, 0, fontSize * 0.43);
  face.addColorStop(0, colors.top);
  face.addColorStop(0.28, colors.top);
  face.addColorStop(0.42, colors.middle);
  face.addColorStop(1, colors.bottom);
  ctx.fillStyle = face;
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function paintComboArt(
  ctx: CanvasRenderingContext2D, tier: ComboPopTier, count: number,
): void {
  ctx.clearRect(0, 0, SIDE, SIDE);
  paintBurst(ctx, tier);
  paintStars(ctx, tier);
  const p = COMBO_POP_PALETTES[tier];
  paintLetters(ctx, 'COMBO', 209, 96, p.word);
  paintLetters(ctx, 'x' + count + (tier === 4 ? '!' : ''), 319, 134, p.multiplier);
}

/**
 * The only canvas and GPU texture allocations occur at construction / first
 * use of a distinct count. Node tests have no DOM and use a 1px placeholder;
 * the browser always paints the fully outlined 512px artwork.
 */
export function makeComboPopTexture(tier: ComboPopTier, count: number): THREE.Texture {
  if (typeof document === 'undefined') {
    const texture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Combo pop artwork requires a 2D canvas context');
  paintComboArt(ctx, tier, count);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.name = 'combo pop tier ' + tier + ' x' + count;
  return texture;
}
