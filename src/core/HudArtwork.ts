import { biomeAt, type Biome, type IslandData, type PropDescriptor } from '../world';
import { boardwalkPierDecks } from '../world/boardwalk';
import { gridIndex } from '../world/terrain';
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

const biomeColors: Record<Biome, string> = {
  ocean: '#59bcdc', beach: '#eedb93', meadow: '#a5d974', farmland: '#a6d26b',
  town: '#a5d078', industrial: '#bdcda0', 'pine-forest': '#619e68',
  highlands: '#8fbd82', cliff: '#a8a997', freshwater: '#61bed4',
};
const MAP_TILES = 16;
const MAP_TILE = 280 / MAP_TILES;
const MAP_SCALE = 1.05;
const MAX_SHORE_TILES = 96;

interface MapHeight {
  x: number;
  y: number;
  height: number;
}

function shorePaths(island: IslandData, origin: { x: number; z: number }): string {
  const { resolution, size, heights } = island;
  const halfSize = size / 2;
  const cell = size / (resolution - 1);
  const mapRadius = 140 / MAP_SCALE;
  // Use the same grid as the world mesh at normal resolutions. Bound the
  // work for high-resolution worlds or island sizes under the minimap span.
  const stride = Math.max(1, Math.ceil(2 * mapRadius / cell / MAX_SHORE_TILES));
  const axis = (center: number) => {
    const first = Math.floor((center - mapRadius + halfSize) / (cell * stride));
    const last = Math.ceil((center + mapRadius + halfSize) / (cell * stride));
    return Array.from({ length: last - first + 1 }, (_, i) => {
      const index = (first + i) * stride;
      const pixel = 140 + (index * cell - halfSize - center) * MAP_SCALE;
      return { index, pixel };
    });
  };
  const columns = axis(origin.x);
  const samples = axis(origin.z).map(row => columns.map((column): MapHeight => {
    const ix = column.index, iz = row.index;
    const height = ix < 0 || iz < 0 || ix >= resolution || iz >= resolution
      ? -2 : heights[gridIndex(resolution, ix, iz)]! - island.seaLevel;
    return { x: column.pixel, y: row.pixel, height };
  }));
  return '<path data-map-beach d="' + sublevelPath(samples, 2.5 * island.size / 600) +
    '" fill="' + biomeColors.beach + '"/>' +
    '<path data-map-ocean d="' + sublevelPath(samples, 0) + '" fill="' + biomeColors.ocean + '"/>';
}

function sublevelPath(samples: MapHeight[][], level: number): string {
  const path: string[] = [];
  const add = (points: readonly Pick<MapHeight, 'x' | 'y'>[]): void => {
    if (points.length > 2) path.push('M' + points.map(p => n(p.x) + ',' + n(p.y)).join('L') + 'Z');
  };
  function clipTriangle(triangle: readonly MapHeight[]): void {
    const under: Pick<MapHeight, 'x' | 'y'>[] = [];
    for (const [index, a] of triangle.entries()) {
      const b = triangle[(index + 1) % triangle.length]!;
      if (a.height <= level) under.push(a);
      if ((a.height <= level) !== (b.height <= level)) {
        const t = (a.height - level) / (a.height - b.height);
        under.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    add(under);
  }
  const cols = samples[0]!.length - 1;
  for (let row = 0; row < samples.length - 1; row++) {
    const top = samples[row]!, bottom = samples[row + 1]!;
    let run = -1;
    for (let col = 0; col < cols; col++) {
      const a = top[col]!, b = top[col + 1]!, c = bottom[col]!, d = bottom[col + 1]!;
      if (Math.max(a.height, b.height, c.height, d.height) <= level) {
        if (run < 0) run = col;
        continue;
      }
      // Paint the filled part of each scanline as a single polygon.
      if (run >= 0) {
        add([top[run]!, a, c, bottom[run]!]);
        run = -1;
      }
      if (Math.min(a.height, b.height, c.height, d.height) <= level) {
        clipTriangle([a, b, c]);
        clipTriangle([b, d, c]);
      }
    }
    if (run >= 0) add([top[run]!, top[cols]!, bottom[cols]!, bottom[run]!]);
  }
  return path.join('');
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
    // Reserve the shoreline colors for the finer elevation contours.
    const color = biome === 'ocean' || biome === 'beach' ? biomeColors.meadow : biomeColors[biome];
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
  const decking = boardwalkPierDecks(island).map(deck => {
    const { position, rotationY } = deck.transform;
    const c = Math.cos(rotationY), s = Math.sin(rotationY);
    const w = deck.size.x / 2, d = deck.size.z / 2;
    const corners = [[-w, -d], [w, -d], [w, d], [-w, d]] as const;
    const points = corners.map(([x, z]) => {
      const m = projectHudMap({ x: position.x + c * x + s * z,
        z: position.z + c * z - s * x }, origin);
      return n(m.x) + ',' + n(m.y);
    }).join(' ');
    return '<polygon data-pier-deck points="' + points +
      '" fill="#d6a072" stroke="#775537" stroke-width="2" stroke-linejoin="round"/>';
  }).join('');
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
  return '<defs><clipPath id="gg-hud-map-clip"><circle cx="140" cy="140" r="132"/></clipPath>' +
    '<radialGradient id="gg-hud-map-clearance"><stop offset=".35" stop-color="#373737"/>' +
    '<stop offset="1" stop-color="white"/></radialGradient>' +
    '<mask id="gg-hud-map-scenery" maskUnits="userSpaceOnUse" x="0" y="0" width="280" height="280">' +
    '<rect width="280" height="280" fill="white"/>' +
    '<circle data-map-player-clearance r="43" fill="url(#gg-hud-map-clearance)"/></mask></defs>' +
    '<g clip-path="url(#gg-hud-map-clip)">' + terrain.join('') + shorePaths(island, origin) +
    roads.join('') + decking + '<g data-map-scenery mask="url(#gg-hud-map-scenery)" opacity=".63">' +
    trees.join('') + structures.join('') + boards + '</g>' +
    '<g data-map-objectives><path data-map-climb-target visibility="hidden" ' +
    'd="M-8 10v-21h18l-4 5 4 5H-8" stroke="#463227" stroke-width="2.5" ' +
    'stroke-linejoin="round" fill="#ffdf74"/></g>' +
    '<g data-player><path d="M0 -17 L12 14 L0 8 L-12 14Z" fill="#fff7df" stroke="#88411d" stroke-width="6" stroke-linejoin="round"/>' +
    '<path d="M0 -17 L12 14 L0 8 L-12 14Z" fill="#ff8e28" stroke="#ffe883" stroke-width="2"/></g></g>' +
    '<circle cx="140" cy="140" r="132" fill="none" stroke="#f6d78d" stroke-width="6"/>';
}
