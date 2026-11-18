import { HAY_HAUL_TAG_RADIUS, type GigRun, type Point } from '../gigs';
import type { Game } from './Game';
import type { InputDevice } from './GameInput';
import { projectHudMap } from './GameHudState';
import { HUD_SPRITES, hudSpriteUrl } from './HudSprites';

export interface HayHaulGuidance {
  kind: 'pickup' | 'delivery';
  position: Point;
  task: string;
}

/** Follow the nearest unfinished live bale until a registered grab switches the goal to the barn. */
export function hayHaulGuidance(game: Game, run: GigRun | null,
  device: InputDevice = 'keyboard-mouse'): HayHaulGuidance | null {
  if (run?.status !== 'running' || run.setup.config.kind !== 'hay-haul' || game.party.match) return null;

  const config = run.setup.config;
  const goat = game.goat;
  const player = goat.torso.translation();
  const held = goat.interactions.tongueBody?.handle;
  let nearest: Point | null = null;
  let nearestDistance = Infinity;

  for (const bale of config.bales) {
    if (run.finishedIds.includes(bale.id) || game.destroyedProps.has(bale.id)) continue;
    const body = game.colliders.bodies.get(bale.id);
    if (!body?.isValid()) continue;
    const position = body.translation();
    const distance = Math.hypot(position.x - player.x, position.y - player.y, position.z - player.z);
    if (body.handle === held) {
      if (run.seenIds.includes(bale.id)) {
        return { kind: 'delivery', position: config.barn, task: 'Drag bale to barn drop' };
      }
      const inRange = distance <= HAY_HAUL_TAG_RADIUS * goat.size;
      return { kind: 'pickup', position, task: inRange ? 'Release and re-lick' : 'Get closer and re-lick' };
    }
    if (distance < nearestDistance) {
      nearest = position;
      nearestDistance = distance;
    }
  }

  if (!nearest) return null;
  const inRange = nearestDistance <= HAY_HAUL_TAG_RADIUS * goat.size;
  return {
    kind: 'pickup',
    position: nearest,
    task: inRange ? (device === 'gamepad' ? 'Hold LB or LT to lick' : 'Hold RMB to lick') :
      'Find a bale on the map',
  };
}

type MapPoint = ReturnType<typeof projectHudMap>;
const MAP_CENTER = 140;
const OBJECTIVE_MAP_RADIUS = 108;
const MARKER_SEPARATION = 40;

/** Keep an out-of-range waypoint just inside the rim of the circular minimap. */
export function hayHaulMapPoint(position: Point, origin: { x: number; z: number }) {
  const { x, y } = projectHudMap(position, origin);
  const dx = x - MAP_CENTER, dy = y - MAP_CENTER;
  const scale = Math.min(1, OBJECTIVE_MAP_RADIUS / Math.hypot(dx, dy));
  return { x: MAP_CENTER + dx * scale, y: MAP_CENTER + dy * scale };
}

/** Separate the two icons while retaining the exact anchor for the leader line. */
export function separateMapObjective(anchor: MapPoint, player: MapPoint): MapPoint {
  const dx = anchor.x - player.x, dy = anchor.y - player.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= MARKER_SEPARATION) return anchor;
  const px = player.x - MAP_CENTER, py = player.y - MAP_CENTER;
  const radius = Math.hypot(px, py);
  let x = distance > 0 ? dx / distance : radius > 0 ? -px / radius : 1;
  let y = distance > 0 ? dy / distance : radius > 0 ? -py / radius : 0;
  if (Math.hypot(px + x * MARKER_SEPARATION, py + y * MARKER_SEPARATION) > OBJECTIVE_MAP_RADIUS) {
    // Near the map rim, slide along its boundary to keep the icon inside.
    const ax = px / radius, ay = py / radius;
    const along = (OBJECTIVE_MAP_RADIUS ** 2 - radius ** 2 - MARKER_SEPARATION ** 2) /
      (2 * radius * MARKER_SEPARATION);
    const tangential = Math.sqrt(Math.max(0, 1 - along ** 2)) * (ax * y - ay * x < 0 ? -1 : 1);
    x = ax * along - ay * tangential;
    y = ay * along + ax * tangential;
  }
  return { x: player.x + x * MARKER_SEPARATION, y: player.y + y * MARKER_SEPARATION };
}

export function createHayHaulMapMarker(kind: HayHaulGuidance['kind']): SVGGElement {
  const svg = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(svg, 'g');
  group.dataset.hayHaulMarker = kind;
  const leader = document.createElementNS(svg, 'line');
  leader.setAttribute('stroke', '#5c3d25');
  leader.setAttribute('stroke-width', '2');
  leader.setAttribute('stroke-dasharray', '3 2');
  leader.setAttribute('stroke-linecap', 'round');
  const ring = document.createElementNS(svg, 'circle');
  ring.setAttribute('r', '16');
  ring.setAttribute('fill', kind === 'pickup' ? '#ffdf74' : '#a5ffd8');
  ring.setAttribute('stroke', '#422412');
  ring.setAttribute('stroke-width', '3');
  const image = document.createElementNS(svg, 'image');
  image.setAttribute('x', '-12');
  image.setAttribute('y', '-12');
  image.setAttribute('width', '24');
  image.setAttribute('height', '24');
  image.setAttribute('href', hudSpriteUrl(kind === 'pickup' ? HUD_SPRITES.hayFloor : HUD_SPRITES.markerBarn));
  group.append(leader, ring, image);
  return group;
}
