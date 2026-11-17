import { biomeAt, type IslandData, type PropDescriptor } from '../world';
import { projectHudMap } from './GameHudState';

const n = (value: number): string => value.toFixed(1);

/** Small hand-drawn SVG game pieces; no remote font/image or non-core assets. */
export function goatArtwork(): string {
  return '<svg viewBox="0 0 112 96" aria-hidden="true" class="gg-goat-art">' +
    '<g fill="#fff5dc" stroke="#613728" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 48 Q8 45 9 35 L15 35 Q21 41 24 43 L69 42 Q85 43 85 54 L78 67 L72 83 L63 83 L66 61 L38 62 L35 83 L25 83 L23 61 Q17 56 20 48Z"/>' +
    '<path d="M74 41 Q71 23 84 22 Q103 22 104 39 Q108 48 99 52 L89 57 L85 64 L79 56 L75 46Z"/>' +
    '<path d="M78 28 Q68 17 73 8 Q79 3 86 14 L91 25" fill="#ffbf4e"/>' +
    '<path d="M92 23 Q93 11 101 10 Q107 11 101 30" fill="#ffbf4e"/>' +
    '<path d="M84 36 L70 34 Q63 30 65 39 L79 46Z" fill="#e8b69d"/>' +
    '<path d="M96 50 Q102 65 88 71 L85 57" fill="#ffedd3"/>' +
    '</g><circle cx="94" cy="37" r="3.5" fill="#34243a"/>' +
    '<circle cx="102" cy="47" r="2.5" fill="#cb7466"/>' +
    '<path d="M35 40 Q50 30 60 44" fill="none" stroke="#fffef0" stroke-width="5" stroke-linecap="round"/>' +
    '</svg>';
}

const iconStart = '<svg viewBox="0 0 96 80" class="gg-piece-art" aria-hidden="true">';
const iconEnd = '</svg>';
export function buildArtwork(type: string): string {
  if (type === 'floor') return iconStart +
    '<ellipse cx="47" cy="65" rx="34" ry="10" fill="#613019" opacity=".35"/>' +
    '<path d="M25 25 L63 22 L76 34 L76 61 L30 65 L18 54 L18 34Z" fill="#f2ab14" stroke="#a4561c" stroke-width="4"/>' +
    '<path d="M26 27 L62 25 L62 60 L28 63Z" fill="#ffcc2b"/>' +
    '<ellipse cx="28" cy="45" rx="18" ry="23" fill="#ed9412" stroke="#ad591a" stroke-width="4"/>' +
    '<ellipse cx="28" cy="45" rx="11" ry="16" fill="none" stroke="#ffe074" stroke-width="4"/>' +
    '<ellipse cx="28" cy="45" rx="5" ry="9" fill="none" stroke="#b87822" stroke-width="3"/>' +
    '<path d="M61 27 L61 60 M68 30 L68 59" stroke="#ffe670" stroke-width="4"/>' + iconEnd;
  if (type === 'wall') return iconStart +
    '<path d="M13 25 L81 24 L81 35 L13 38Z M13 47 L81 43 L81 54 L13 60Z" fill="#f5bb6b" stroke="#9e542d" stroke-width="3"/>' +
    '<path d="M18 18 L27 10 L32 17 L32 72 L18 71Z M68 16 L78 9 L83 16 L83 70 L68 72Z" fill="#e7a25b" stroke="#995124" stroke-width="3"/>' +
    '<path d="M22 22 L22 66 M72 22 L72 65" stroke="#ffe0a0" stroke-width="3"/>' + iconEnd;
  if (type === 'ramp') return iconStart +
    '<path d="M13 64 L72 15 L85 23 L85 63Z" fill="#e3a032" stroke="#99501a" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M13 64 L72 15 L85 23 L28 69Z" fill="#ffcf59" stroke="#99501a" stroke-width="3"/>' +
    '<path d="M33 49 L46 56 M44 40 L58 47 M56 30 L70 37 M67 22 L80 28" stroke="#c68128" stroke-width="3"/>' + iconEnd;
  if (type === 'launch-pad') return iconStart +
    '<ellipse cx="48" cy="67" rx="33" ry="7" fill="#573e45" opacity=".35"/>' +
    '<path d="M30 59 L66 59 L74 68 L22 68Z" fill="#7b8d9b" stroke="#46495d" stroke-width="3"/>' +
    '<path d="M44 58 Q73 53 44 48 Q15 43 48 38 Q77 33 46 29" fill="none" stroke="#a2b7c2" stroke-width="7"/>' +
    '<ellipse cx="48" cy="25" rx="33" ry="11" fill="#ff6570" stroke="#aa354c" stroke-width="4"/>' +
    '<ellipse cx="47" cy="22" rx="24" ry="5" fill="#ff9ca5"/>' + iconEnd;
  return iconStart +
    '<path d="M20 30 L54 18 L81 31 L82 67 L47 77 L19 62Z" fill="#c57b32" stroke="#714022" stroke-width="4"/>' +
    '<path d="M20 30 L47 43 L81 31 M47 43 L47 77 M32 25 L62 37 M32 36 L32 67 M67 36 L67 71" fill="none" stroke="#f5c36e" stroke-width="5"/>' +
    '<path d="M36 25 L64 19 L76 28 L47 38Z" fill="#e2a85b" stroke="#714022" stroke-width="2"/>' + iconEnd;
}

const biomeColors: Record<string, string> = {
  ocean: '#59bcdc', beach: '#eedb93', meadow: '#a5d974', farmland: '#a6d26b',
  town: '#a5d078', industrial: '#bdcda0', 'pine-forest': '#619e68',
  highlands: '#8fbd82', cliff: '#a8a997', freshwater: '#61bed4',
};
const tree = (x: number, y: number, pine: boolean): string =>
  pine ? '<g><ellipse cx="' + n(x + 2) + '" cy="' + n(y + 5) +
    '" rx="10" ry="4" fill="#386c49" opacity=".3"/><path d="M' + n(x) + ' ' + n(y - 12) +
    ' l-9 19 h18Z" fill="#327d4b" stroke="#286b42" stroke-width="2"/></g>' :
    '<g><ellipse cx="' + n(x + 3) + '" cy="' + n(y + 7) +
    '" rx="11" ry="5" fill="#4d8542" opacity=".25"/><circle cx="' +
    n(x) + '" cy="' + n(y) + '" r="9" fill="#3a9c53" stroke="#30844a" stroke-width="2"/>' +
    '<circle cx="' + n(x - 3) + '" cy="' + n(y - 3) + '" r="5" fill="#7dcc63"/></g>';
const building = (prop: PropDescriptor, x: number, y: number): string => {
  if (prop.kind === 'windmill') {
    return '<g transform="translate(' + n(x) + ' ' + n(y) + ')">' +
      '<path d="M-7 12 L-10 -10 L9 -10 L6 12Z" fill="#fff2d5" stroke="#906e52" stroke-width="2"/>' +
      '<path d="M-12 -10 L0 -19 L12 -10Z" fill="#e35c46"/>' +
      '<path d="M0 -5 L0 -27 M0 -5 L0 17 M0 -5 L-22 -5 M0 -5 L22 -5" stroke="#a86b2c" stroke-width="5"/>' +
      '<circle cx="0" cy="-5" r="4" fill="#eebb3f"/></g>';
  }
  const palette = prop.kind === 'barn' ? '#ec5446' : prop.kind === 'shop' ? '#fbd856' :
    prop.kind === 'silo' ? '#d6e6d4' : prop.kind === 'cottage' ? '#f3aaab' : '#e8d4a3';
  return '<g transform="translate(' + n(x) + ' ' + n(y) + ')">' +
    '<rect x="-8" y="-6" width="16" height="15" rx="2" fill="' + palette + '" stroke="#8c754c" stroke-width="1.4"/>' +
    '<path d="M-10 -6 L0 -14 L10 -6Z" fill="#c65b46" stroke="#925345" stroke-width="1.3"/>' +
    '<rect x="-2" y="1" width="4" height="8" fill="#8dcee2"/></g>';
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
    return '<g transform="translate(' + n(point.x) + ' ' + n(point.y) + ')">' +
      '<path d="M0 -12 Q-10 -12 -10 -3 Q-10 4 0 14 Q10 4 10 -3 Q10 -12 0 -12Z" fill="#ffb22b" stroke="#724027" stroke-width="2"/>' +
      '<text x="0" y="3" text-anchor="middle" fill="#fff" font-size="13" font-weight="1000">!</text></g>';
  }).join('');
  return '<defs><clipPath id="gg-hud-map-clip"><circle cx="140" cy="140" r="132"/></clipPath></defs>' +
    '<g clip-path="url(#gg-hud-map-clip)">' + terrain.join('') + roads.join('') +
    trees.join('') + structures.join('') + boards +
    '<g data-player><path d="M0 -17 L12 14 L0 8 L-12 14Z" fill="#fff7df" stroke="#88411d" stroke-width="6" stroke-linejoin="round"/>' +
    '<path d="M0 -17 L12 14 L0 8 L-12 14Z" fill="#ff8e28" stroke="#ffe883" stroke-width="2"/></g></g>' +
    '<circle cx="140" cy="140" r="132" fill="none" stroke="#f6d78d" stroke-width="6"/>';
}
