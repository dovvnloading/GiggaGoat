import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshToonMaterial } from 'three';
import type { IslandData, PropDescriptor } from './types';
import { TOON_RAMP } from './visual-props';

// The timber profile and paint from public/assets/library/custom/baaardwalk/pier-rail.glb.
const RAIL_WHITE = new Color().setRGB(.964686, .930111, .863157);
const CAP_SHADE = new Color().setRGB(.814847, .760525, .672443);
const MODEL_LENGTH = 8.06;
const MODEL_HEIGHT = 2.65;
const MODEL_DEPTH = .5;

interface RailPart {
  matrix: Matrix4;
  colour: Color;
}

function along(rail: PropDescriptor, side: boolean): number {
  return side ? rail.transform.position.z : rail.transform.position.x;
}

function across(rail: PropDescriptor, side: boolean): number {
  return side ? rail.transform.position.x : rail.transform.position.z;
}

function joined(rails: PropDescriptor[], side: boolean): boolean {
  if (rails.length < 2) return false;
  rails.sort((a, b) => along(a, side) - along(b, side));
  const first = rails[0]!;
  return rails.every((rail, i) => {
    if (Math.abs(across(rail, side) - across(first, side)) > .01 ||
        Math.abs(rail.transform.position.y - first.transform.position.y) > .01 ||
        rail.size.y !== first.size.y || rail.size.z !== first.size.z) return false;
    const next = rails[i + 1];
    if (!next) return true;
    const end = along(rail, side) + rail.size.x / 2;
    const nextStart = along(next, side) - next.size.x / 2;
    return nextStart - end <= .01;
  });
}

function appendRail(parts: RailPart[], rails: PropDescriptor[], side: boolean): void {
  const first = rails[0]!, last = rails.at(-1)!;
  const horizontal = first.size.x * .98 / MODEL_LENGTH;
  const vertical = first.size.y * .98 / MODEL_HEIGHT;
  const depth = first.size.z * .98 / MODEL_DEPTH;
  const floor = first.transform.position.y - first.size.y * .49;
  const cross = across(first, side);
  const start = along(first, side) - 4 * horizontal;
  const end = along(last, side) + 4 * last.size.x * .98 / MODEL_LENGTH;

  const box = (position: number, bottom: number, width: number,
    height: number, thickness: number, colour = RAIL_WHITE) => {
    const matrix = new Matrix4().makeScale(side ? thickness * depth : width,
      height * vertical, side ? width : thickness * depth);
    matrix.setPosition(side ? cross : position, floor + (bottom + height / 2) * vertical,
      side ? position : cross);
    parts.push({ matrix, colour });
  };
  const post = (position: number) => {
    box(position, 0, .20 * horizontal, 1.25, .20);
    box(position, 1.25, .28 * horizontal, .10, .28, CAP_SHADE);
    box(position, 1.35, .16 * horizontal, .08, .16);
  };
  const picket = (position: number) => box(position, .12, .05 * horizontal, .52, .05);

  const centre = (start + end) / 2, length = end - start;
  box(centre, .06, length, .12, .12);
  box(centre, .575, length, .09, .09, CAP_SHADE);
  box(centre, 1.13, length, .12, .16);

  if (rails.length === 1) {
    // Preserve the stock bays along the approach and the narrow Splash Dive entrance.
    for (const offset of [-3.89, -2, 0, 2, 3.89]) post(centre + offset * horizontal);
    for (let bay = 0; bay < 4; bay++) {
      for (let i = 0; i < 6; i++) picket(start + (2 * bay + .375 + .25 * i) * horizontal);
    }
    return;
  }

  const seams = rails.slice(1).map((rail, i) => {
    const previous = rails[i]!;
    return (along(previous, side) + previous.size.x / 2 +
      along(rail, side) - rail.size.x / 2) / 2;
  });
  const ends = [start + .11 * horizontal, ...seams, end - .11 * horizontal];
  const posts = ends.slice(0, -1).flatMap((from, i) =>
    Array.from({ length: 4 }, (_, bay) => from + (ends[i + 1]! - from) * bay / 4));
  posts.push(ends.at(-1)!);
  for (const [i, position] of posts.entries()) {
    post(position);
    const next = posts[i + 1];
    if (next !== undefined) {
      for (let p = 1; p <= 6; p++) picket(position + (next - position) * p / 7);
    }
  }
}

/** All Baa-ardwalk rails share one draw. Only the Ferris platform panels share their posts. */
export function buildBoardwalkRailVisuals(island: IslandData) {
  const isBoardwalk = (prop: PropDescriptor) => prop.poiId === 'baa-ardwalk';
  const [deck] = island.props.filter(prop => isBoardwalk(prop) && prop.kind === 'pier')
    .sort((a, b) => b.size.x - a.size.x);
  if (!deck) return null;

  const rails = island.props.filter(prop => isBoardwalk(prop) && prop.kind === 'pier-rail' &&
    prop.body.type === 'static' && (Math.abs(Math.sin(prop.transform.rotationY)) < .001 ||
      Math.abs(Math.cos(prop.transform.rotationY)) < .001));
  const middle = deck.transform.position;
  const nearEdge = middle.z - deck.size.z / 2;
  const sideRails = rails.filter(prop => prop.transform.position.z > nearEdge &&
    Math.abs(Math.cos(prop.transform.rotationY)) < .001);
  const runs = [
    { rails: rails.filter(prop => prop.transform.position.z > middle.z &&
      Math.abs(Math.sin(prop.transform.rotationY)) < .001), side: false },
    { rails: sideRails.filter(prop => prop.transform.position.x < middle.x), side: true },
    { rails: sideRails.filter(prop => prop.transform.position.x > middle.x), side: true },
  ];

  const parts: RailPart[] = [];
  const replacedIds = new Set<string>();
  for (const run of runs) {
    // The corners have intentional openings. Only join the straight runs where
    // the guard footprints meet.
    if (!joined(run.rails, run.side)) continue;
    appendRail(parts, run.rails, run.side);
    for (const rail of run.rails) replacedIds.add(rail.id);
  }
  for (const rail of rails) {
    if (replacedIds.has(rail.id)) continue;
    appendRail(parts, [rail], Math.abs(Math.cos(rail.transform.rotationY)) < .001);
    replacedIds.add(rail.id);
  }

  if (!parts.length) return null;
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshToonMaterial({ gradientMap: TOON_RAMP }),
    parts.length);
  for (const [i, { matrix, colour }] of parts.entries()) {
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, colour);
  }
  mesh.name = 'baaardwalk-painted-rails';
  mesh.computeBoundingSphere();
  return { mesh, replacedIds };
}
