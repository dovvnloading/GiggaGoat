import { biomeAt, type IslandData, type PropDescriptor } from '../world';
import { boardwalkPierDecks } from '../world/boardwalk';
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
/** Sprite markers sit on top of the live biome and road SVG. */
function mapImage(name: HudSpriteName, x: number, y: number, w: number, h: number): string {
  return '<image data-sprite="' + name + '" href="' + hudSpriteUrl(name) +
    '" x="' + n(x - w / 2) + '" y="' + n(y - h / 2) +
    '" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid meet"/>';
}
const tree = (x: number, y: number, pine: boolean): string =>
  mapImage(pine ? HUD_SPRITES.markerTreePine :
    (Math.floor(x + y) % 5 === 0 ? HUD_SPRITES.markerTreeApple : HUD_SPRITES.markerTreeRound),
  x, y, 19, 20);

const building = (prop: PropDescriptor, x: number, y: number): string => {
  const name = prop.kind === 'barn' ? HUD_SPRITES.markerBarn :
    prop.kind === 'cottage' ? HUD_SPRITES.markerHousePink : HUD_SPRITES.markerHouseBlue;
  return mapImage(name, x, y, 24, 22);
};

/** Rebuild only when the map's area changes. Every feature is from island data. */
export function renderHudMinimap(island: IslandData, origin: { x: number; z: number }): string {
  const tile = 17.5;
  const terrain: string[] = [];
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
    const mapX = (col + .5) * tile, mapY = (row + .5) * tile;
    const worldX = origin.x + (mapX - 140) / 1.05;
    const worldZ = origin.z + (mapY - 140) / 1.05;
    const biome = biomeAt(island, worldX, worldZ);
    terrain.push('<rect x="' + n(col * tile) + '" y="' + n(row * tile) +
      '" width="17.7" height="17.7" fill="' + (biomeColors[biome] ?? '#9ace69') + '"/>');
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
  return '<defs><clipPath id="gg-hud-map-clip"><circle cx="140" cy="140" r="132"/></clipPath></defs>' +
    '<g clip-path="url(#gg-hud-map-clip)">' + terrain.join('') + roads.join('') + decking +
    trees.join('') + structures.join('') + boards +
    '<g data-player><path d="M0 -17 L12 14 L0 8 L-12 14Z" fill="#fff7df" stroke="#88411d" stroke-width="6" stroke-linejoin="round"/>' +
    '<path d="M0 -17 L12 14 L0 8 L-12 14Z" fill="#ff8e28" stroke="#ffe883" stroke-width="2"/></g></g>' +
    '<circle cx="140" cy="140" r="132" fill="none" stroke="#f6d78d" stroke-width="6"/>';
}
