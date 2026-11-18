import { biomeAt, heightAt, type IslandData, type PropDescriptor } from '../world';
import { projectHudMap } from './GameHudState';
import { HUD_SPRITES, hudSpriteImage, hudSpriteUrl, type HudSpriteName } from './HudSprites';

const n = (value: number): string => value.toFixed(1);

/** The growth tiers are distinct pre-sliced illustrations, not a repeated SVG. */
export function goatArtwork(tier: 'Kid' | 'Billy' | 'Big' | 'GIGGA'): string {
  const sprites = {
    Kid: HUD_SPRITES.goatKid, Billy: HUD_SPRITES.goatBilly,
    Big: HUD_SPRITES.goatBig, GIGGA: HUD_SPRITES.goatGigga,
  };
  return hudSpriteImage(sprites[tier], 'gg-goat-art');
}

/** Keep the gameplay piece identifiers unchanged; only their artwork changes. */
export function buildArtwork(type: string): string {
  const sprite = type === 'floor' ? HUD_SPRITES.hayFloor :
    type === 'wall' ? HUD_SPRITES.fenceWall :
    type === 'ramp' ? HUD_SPRITES.hayRamp :
    type === 'launch-pad' ? HUD_SPRITES.launchPad : HUD_SPRITES.suppliesCrate;
  return hudSpriteImage(sprite, 'gg-piece-art');
}

const biomeColors: Record<string, string> = {
  ocean: '#59bcdc', beach: '#eedb93', meadow: '#a5d974', farmland: '#a6d26b',
  town: '#a5d078', industrial: '#bdcda0', 'pine-forest': '#619e68',
  highlands: '#8fbd82', cliff: '#a8a997', freshwater: '#61bed4',
};
const MAP_TILES = 16;
const MAP_TILE = 280 / MAP_TILES;
const MAP_SCALE = 1.05;

interface MapHeight {
  x: number;
  y: number;
  height: number;
}

function oceanPath(island: IslandData, origin: { x: number; z: number }): string {
  const halfSize = island.size / 2;
  const samples = Array.from({ length: MAP_TILES + 1 }, (_, row) =>
    Array.from({ length: MAP_TILES + 1 }, (_, col): MapHeight => {
      const x = col * MAP_TILE, y = row * MAP_TILE;
      const worldX = origin.x + (x - 140) / MAP_SCALE;
      const worldZ = origin.z + (y - 140) / MAP_SCALE;
      const height = Math.max(Math.abs(worldX), Math.abs(worldZ)) > halfSize
        ? -2 : heightAt(island, worldX, worldZ) - island.seaLevel;
      return { x, y, height };
    }));
  const path: string[] = [];
  const add = (points: readonly Pick<MapHeight, 'x' | 'y'>[]): void => {
    if (points.length > 2) path.push('M' + points.map(p => n(p.x) + ',' + n(p.y)).join('L') + 'Z');
  };
  function waterTriangle(triangle: readonly MapHeight[]): void {
    const wet: Pick<MapHeight, 'x' | 'y'>[] = [];
    for (const [index, a] of triangle.entries()) {
      const b = triangle[(index + 1) % triangle.length]!;
      if (a.height <= 0) wet.push(a);
      if ((a.height <= 0) !== (b.height <= 0)) {
        const t = a.height / (a.height - b.height);
        wet.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    add(wet);
  }
  for (let row = 0; row < MAP_TILES; row++) for (let col = 0; col < MAP_TILES; col++) {
    const a = samples[row]![col]!, b = samples[row]![col + 1]!;
    const c = samples[row + 1]![col + 1]!, d = samples[row + 1]![col]!;
    if (Math.max(a.height, b.height, c.height, d.height) <= 0) add([a, b, c, d]);
    else if (Math.min(a.height, b.height, c.height, d.height) <= 0) {
      waterTriangle([a, b, c]);
      waterTriangle([a, c, d]);
    }
  }
  return '<path data-map-ocean d="' + path.join('') + '" fill="' + biomeColors.ocean + '"/>';
}
/** Sprite markers sit on top of the live biome and road SVG. */
function mapImage(name: HudSpriteName, x: number, y: number, w: number, h: number): string {
  return '<image data-sprite="' + name + '" href="' + hudSpriteUrl(name) +
    '" x="' + n(x - w / 2) + '" y="' + n(y - h / 2) +
    '" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid meet"/>';
}
const tree = (x: number, y: number, pine: boolean): string =>
  mapImage(pine ? HUD_SPRITES.markerTreePine :
    (Math.floor(x + y) % 5 === 0 ? HUD_SPRITES.markerTreeApple : HUD_SPRITES.markerTreeRound),
  x, y, 16, 17);

const building = (prop: PropDescriptor, x: number, y: number): string => {
  const name = prop.kind === 'barn' ? HUD_SPRITES.markerBarn :
    prop.kind === 'cottage' ? HUD_SPRITES.markerHousePink : HUD_SPRITES.markerHouseBlue;
  return mapImage(name, x, y, 20, 19);
};

/** Rebuild only when the map's area changes. Every feature is from island data. */
export function renderHudMinimap(island: IslandData, origin: { x: number; z: number }): string {
  const terrain: string[] = [];
  for (let row = 0; row < MAP_TILES; row++) for (let col = 0; col < MAP_TILES; col++) {
    const mapX = (col + .5) * MAP_TILE, mapY = (row + .5) * MAP_TILE;
    const worldX = origin.x + (mapX - 140) / MAP_SCALE;
    const worldZ = origin.z + (mapY - 140) / MAP_SCALE;
    const biome = biomeAt(island, worldX, worldZ);
    const color = biome === 'ocean' ? biomeColors.beach : biomeColors[biome] ?? '#9ace69';
    terrain.push('<rect x="' + n(col * MAP_TILE) + '" y="' + n(row * MAP_TILE) +
      '" width="' + n(MAP_TILE + .2) + '" height="' + n(MAP_TILE + .2) + '" fill="' + color + '"/>');
  }
  const roads: string[] = [];
  for (const road of island.roads) {
    const points = road.points.map(p => {
      const m = projectHudMap(p, origin);
      return n(m.x) + ',' + n(m.y);
    }).join(' ');
    const width = road.type === 'road' ? 12 : 5;
    roads.push('<polyline points="' + points +
      '" stroke="#dfd1a3" stroke-width="' + (width + 3) +
      '" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<polyline points="' + points + '" stroke="' + (road.type === 'road' ? '#c3b79c' : '#f3e6b5') +
      '" stroke-width="' + width + '" fill="none" stroke-linecap="round" stroke-linejoin="round"/>');
  }
  const trees: string[] = [], structures: string[] = [];
  let count = 0;
  for (const prop of island.props) {
    const point = projectHudMap({ x: prop.transform.position.x, z: prop.transform.position.z }, origin);
    if (point.x < -18 || point.x > 298 || point.y < -18 || point.y > 298) continue;
    if (prop.kind === 'tree-oak' || prop.kind === 'tree-pine') {
      // The actual forest contains many trees: limit SVG work without random motion.
      if (++count % 3 === 0 && trees.length < 95) trees.push(tree(point.x, point.y, prop.kind === 'tree-pine'));
    } else if (['barn', 'house', 'shop', 'silo', 'windmill', 'cottage'].includes(prop.kind) &&
      structures.length < 52) {
      structures.push(building(prop, point.x, point.y));
    }
  }
  const boards = island.pois.map(poi => {
    const point = projectHudMap(poi.center, origin);
    if (point.x < 0 || point.x > 280 || point.y < 0 || point.y > 280) return '';
    return mapImage(HUD_SPRITES.mapPin, point.x, point.y - 2, 16, 20);
  }).join('');
  return '<defs><clipPath id="gg-hud-map-clip"><circle cx="140" cy="140" r="132"/></clipPath></defs>' +
    '<g clip-path="url(#gg-hud-map-clip)">' + terrain.join('') + oceanPath(island, origin) +
    roads.join('') + '<g opacity=".72">' + trees.join('') + structures.join('') +
    '</g>' + boards +
    '<g data-player><path d="M0 -17 L12 14 L0 8 L-12 14Z" fill="#fff7df" stroke="#88411d" stroke-width="6" stroke-linejoin="round"/>' +
    '<path d="M0 -17 L12 14 L0 8 L-12 14Z" fill="#ff8e28" stroke="#ffe883" stroke-width="2"/></g></g>' +
    '<circle cx="140" cy="140" r="132" fill="none" stroke="#f6d78d" stroke-width="6"/>';
}
