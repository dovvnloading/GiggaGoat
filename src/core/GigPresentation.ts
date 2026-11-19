import * as THREE from 'three';
import { HAY_HAUL_TAG_RADIUS, type GigConfig, type GigRun, type Point } from '../gigs';
import type { PartyMatch } from '../modes';
import type { Game } from './Game';
import type { InputDevice } from './GameInput';
import { projectHudMap } from './GameHudState';
import { HUD_SPRITES, hudSpriteUrl } from './HudSprites';

type SplashDiveConfig = Extract<GigConfig, { kind: 'splash-dive' }>;

export function createSummitTrailMarker(point: Point, facing: number, scale: number,
  destination: boolean, sampleGround: (x: number, z: number) => number): THREE.Group {
  const root = new THREE.Group();
  root.name = 'summit-trail-marker';
  root.position.set(point.x, sampleGround(point.x, point.z), point.z);
  const color = destination ? 0x88ffcb : 0xffd05f;
  const ringGeometry = new THREE.RingGeometry(.98 * scale, 1.14 * scale, 24).rotateX(-Math.PI / 2);
  const ringPositions = ringGeometry.getAttribute('position');
  for (let vertex = 0; vertex < ringPositions.count; vertex++) {
    const x = point.x + ringPositions.getX(vertex), z = point.z + ringPositions.getZ(vertex);
    ringPositions.setY(vertex, sampleGround(x, z) - root.position.y + .065 * scale);
  }
  const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  ring.name = 'summit-trail-paint';
  root.add(ring);

  const banner = new THREE.BufferGeometry();
  const vertices: number[] = [], colors: number[] = [];
  const triangle = (paint: number, x1: number, y1: number,
    x2: number, y2: number, x3: number, y3: number): void => {
    vertices.push(x1, y1, 0, x2, y2, 0, x3, y3, 0);
    const tint = new THREE.Color(paint);
    for (let i = 0; i < 3; i++) colors.push(tint.r, tint.g, tint.b);
  };
  triangle(0x705235, -.06, 0, .06, 0, .06, 1.55);
  triangle(0x705235, -.06, 0, .06, 1.55, -.06, 1.55);
  triangle(0x573754, .06, 1.60, .95, 1.31, .06, 1.02);
  triangle(color, .10, 1.53, .77, 1.31, .10, 1.09);
  banner.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  banner.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const flag = new THREE.Mesh(banner, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  flag.name = 'summit-trail-flag';
  flag.scale.setScalar(scale);
  flag.rotation.y = facing;
  root.add(flag);
  return root;
}

function splashLandingTarget(config: SplashDiveConfig, radius: number): THREE.Mesh {
  const positions: number[] = [], colors: number[] = [];
  const sectors = 64;
  const addBand = (inner: number, outer: number, color: number, broken = false): void => {
    const paint = new THREE.Color(color);
    const vertex = (distance: number, angle: number): void => {
      positions.push(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
      colors.push(paint.r, paint.g, paint.b);
    };
    for (let i = 0; i < sectors; i++) {
      if (broken && i % 16 >= 13) continue;
      const a = i * Math.PI * 2 / sectors;
      const b = (i + 1) * Math.PI * 2 / sectors;
      vertex(inner, a); vertex(outer, a); vertex(outer, b);
      vertex(inner, a); vertex(outer, b); vertex(inner, b);
    }
  };
  addBand(radius * .84, radius, 0x123754);
  addBand(radius * .875, radius * .965, 0xcafff0, true);
  addBand(radius * .18, radius * .245, 0x123754);
  addBand(radius * .193, radius * .230, 0xcafff0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: .94, depthWrite: false,
    side: THREE.DoubleSide, forceSinglePass: true,
  }));
  mesh.name = 'splash-dive-water-target';
  mesh.position.set(config.landing.x, config.waterY + .31, config.landing.z);
  // Draw over the transparent sea, with normal depth testing against the deck.
  mesh.renderOrder = 3;
  return mesh;
}

function splashDirectionArrow(config: SplashDiveConfig, deckY: number, scale: number): THREE.Mesh {
  const arrow = new THREE.Shape();
  arrow.moveTo(0, .44);
  arrow.lineTo(-.72, -.37);
  arrow.lineTo(-.24, -.37);
  arrow.lineTo(-.24, -1.32);
  arrow.lineTo(.24, -1.32);
  arrow.lineTo(.24, -.37);
  arrow.lineTo(.72, -.37);
  arrow.closePath();
  const geometry = new THREE.ShapeGeometry(arrow);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0xcafff0, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  mesh.name = 'splash-dive-water-direction';
  const { jumpPoint, landing } = config;
  mesh.position.set(jumpPoint.x, deckY + .04 * scale, jumpPoint.z);
  mesh.scale.setScalar(scale);
  mesh.rotation.y = Math.atan2(jumpPoint.x - landing.x, jumpPoint.z - landing.z);
  return mesh;
}

export function createSplashDiveMarkers(config: SplashDiveConfig, radius: number,
  deckY: number, approach: THREE.Sprite, scale = 1) {
  const root = new THREE.Group();
  root.name = 'splash-dive-markers';
  approach.position.set(config.jumpPoint.x, deckY + 1.55 * scale, config.jumpPoint.z);
  approach.name = 'splash-dive-launch';
  const landing = new THREE.Group();
  landing.name = 'splash-dive-landing';
  landing.add(splashDirectionArrow(config, deckY, scale), splashLandingTarget(config, radius));
  root.add(approach, landing);
  root.visible = false;
  return {
    root,
    update(run: GigRun | null): void {
      const active = run?.status === 'running' && run.setup.config.kind === 'splash-dive';
      // Launch is latched in the run, including saved attempts from before the HUD exposed it.
      const reached = active && run.streetStarted;
      root.visible = active;
      approach.visible = active && !reached;
      landing.visible = reached;
    },
  };
}

export interface HayMapGuidance {
  kind: 'pickup' | 'delivery';
  position: Point;
  teamId?: string;
}

export interface HayHaulGuidance extends HayMapGuidance {
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

/** Point to available rival cargo, then to the player's own goal while carrying. */
export function hayHeistGuidance(match: Pick<PartyMatch, 'mode' | 'phase' | 'view'>,
  player: Point, playerId: string): HayMapGuidance | null {
  if (match.mode !== 'hay-heist' || match.phase === 'lobby' || match.phase === 'results') return null;

  const { players, bales, arena } = match.view();
  const ownTeam = players.find(goat => goat.id === playerId)?.teamId;
  if (!ownTeam) return null;
  if (bales.some(bale => bale.carrierId === playerId)) {
    const goal = arena.barns.find(barn => barn.teamId === ownTeam);
    return goal ? { kind: 'delivery', position: goal.position, teamId: ownTeam } : null;
  }

  let nearest: (typeof bales)[number] | undefined;
  let nearestDistance = Infinity;
  for (const bale of bales) {
    if (bale.homeTeam === ownTeam || bale.carrierId !== null) continue;
    const distance = Math.hypot(bale.position.x - player.x, bale.position.z - player.z);
    if (distance < nearestDistance) {
      nearest = bale;
      nearestDistance = distance;
    }
  }
  return nearest
    ? { kind: 'pickup', position: nearest.position, teamId: nearest.homeTeam }
    : null;
}

type MapPoint = ReturnType<typeof projectHudMap>;
const MAP_CENTER = 140;
const OBJECTIVE_MAP_RADIUS = 108;
const MARKER_SEPARATION = 40;

/** Keep an out-of-range waypoint just inside the rim of the circular minimap. */
export function gigMapPoint(position: Point, origin: { x: number; z: number }) {
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

export function createHayMapMarker({ kind, teamId }: HayMapGuidance): SVGGElement {
  const svg = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(svg, 'g');
  if (teamId) {
    group.dataset.hayHeistMarker = kind;
    group.dataset.team = teamId;
  } else {
    group.dataset.hayHaulMarker = kind;
  }
  const leader = document.createElementNS(svg, 'line');
  leader.setAttribute('stroke', '#5c3d25');
  leader.setAttribute('stroke-width', '2');
  leader.setAttribute('stroke-dasharray', '3 2');
  leader.setAttribute('stroke-linecap', 'round');
  const ring = document.createElementNS(svg, 'circle');
  ring.setAttribute('r', '16');
  const colour = teamId === 'red' ? '#ff7890' : teamId === 'blue' ? '#68cdff' :
    kind === 'pickup' ? '#ffdf74' : '#a5ffd8';
  ring.setAttribute('fill', colour);
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
