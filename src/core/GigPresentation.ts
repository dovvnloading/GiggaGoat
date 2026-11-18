import { HAY_HAUL_TAG_RADIUS, type GigRun, type Point } from '../gigs';
import type { Game } from './Game';
import { projectHudMap } from './GameHudState';
import { HUD_SPRITES, hudSpriteUrl } from './HudSprites';

export interface HayHaulGuidance {
  kind: 'pickup' | 'delivery';
  position: Point;
  task: string;
}

/** Follow the nearest unfinished live bale until a registered grab switches the goal to the barn. */
export function hayHaulGuidance(game: Game, run: GigRun | null): HayHaulGuidance | null {
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
    task: inRange ? 'Hold RMB / LT to lick' : 'Find a bale on the map',
  };
}

/** Keep an out-of-range waypoint just inside the rim of the circular minimap. */
export function hayHaulMapPoint(position: Point, origin: { x: number; z: number }) {
  const { x, y } = projectHudMap(position, origin);
  const dx = x - 140, dy = y - 140;
  const scale = Math.min(1, 108 / Math.hypot(dx, dy));
  return { x: 140 + dx * scale, y: 140 + dy * scale };
}

export function createHayHaulMapMarker(kind: HayHaulGuidance['kind']): SVGGElement {
  const svg = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(svg, 'g');
  group.dataset.hayHaulMarker = kind;
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
  group.append(ring, image);
  return group;
}
