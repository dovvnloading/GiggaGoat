import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropKind } from './types';

/**
 * Houses are upright, closed buildings, not four-sided cone/pyramid roofs.
 * Both geometries are authored inside a ONE-METRE descriptor envelope.
 * The wall shell receives the descriptor's instance tint; the roof, glazing,
 * shutters and trim deliberately do not, so a pastel house has blue windows
 * and red/blue tiles rather than windows painted the colour of its walls.
 */
const ARCHITECTURAL_KINDS = [
  'barn', 'house', 'cottage', 'shop', 'booth', 'control-house',
] as const;
export type ArchitecturalKind = (typeof ARCHITECTURAL_KINDS)[number];
export function isArchitecturalKind(kind: PropKind): kind is ArchitecturalKind {
  return (ARCHITECTURAL_KINDS as readonly string[]).includes(kind);
}

export interface ArchitectureGeometries {
  shell: THREE.BufferGeometry;
  details: THREE.BufferGeometry;
}

type Pieces = THREE.BufferGeometry[];

function add(pieces: Pieces, geometry: THREE.BufferGeometry, tint: number): void {
  const unpacked = geometry.index ? geometry.toNonIndexed() : geometry;
  if (unpacked !== geometry) geometry.dispose();
  const color = new THREE.Color(tint);
  const count = unpacked.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  unpacked.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pieces.push(unpacked);
}
function box(pieces: Pieces, x: number, y: number, z: number,
  width: number, height: number, depth: number, color: number,
  tilt = 0): void {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt),
    new THREE.Vector3(1, 1, 1),
  ));
  add(pieces, geometry, color);
}
function finish(pieces: Pieces): THREE.BufferGeometry {
  const geometry = mergeGeometries(pieces, false);
  pieces.forEach(piece => piece.dispose());
  if (!geometry) throw new Error('Could not merge architecture pieces');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildArchitecture(kind: ArchitecturalKind): ArchitectureGeometries {
  const shell: Pieces = [], details: Pieces = [];
  const barn = kind === 'barn';
  const shop = kind === 'shop' || kind === 'booth';
  const slate = kind === 'house' || kind === 'control-house' || kind === 'shop';
  const roof = slate ? 0x53667f : barn ? 0xb94c3c : 0xcf7056;
  const roofLight = slate ? 0x73859a : barn ? 0xe16a4b : 0xe5916f;
  const cream = 0xffefce, wood = 0x76513f, sill = 0xe8d6b3;
  const white = 0xf9f2df, blue = 0x83c8e7, darkBlue = 0x397996;

  // The shell reaches the terrain at y=-0.5; no global bounding-box
  // recentring or nonuniform rescale is performed after authoring.
  box(shell, 0, -0.15, 0, 0.88, 0.70, 0.80, 0xffffff);
  box(shell, 0, -0.465, 0, 0.92, 0.07, 0.85, 0xf5e6cf);
  // Brick corner quoins are separate from the tinted plaster.
  for (const x of [-0.43, 0.43]) for (const z of [-0.395, 0.395]) {
    for (let j = 0; j < 5; j++) {
      box(details, x, -0.415 + j * 0.12, z, 0.045, 0.055, 0.045,
        j % 2 ? cream : 0xdcc2a2);
    }
  }

  if (shop) {
    // Flat, playable rooftop: a true horizontal slab, not a tilted cap.
    box(details, 0, 0.29, 0, 0.98, 0.13, 0.93, roof);
    for (const x of [-0.465, 0.465]) {
      box(details, x, 0.405, 0, 0.045, 0.17, 0.93, roofLight);
    }
    for (const z of [-0.44, 0.44]) {
      box(details, 0, 0.405, z, 0.97, 0.17, 0.045, roofLight);
    }
    // Wide front glazing, heavy door, painted awning and visible shop sign.
    for (const x of [-0.275, 0.275]) {
      box(details, x, -0.135, 0.408, 0.245, 0.31, 0.019, white);
      box(details, x, -0.135, 0.423, 0.208, 0.26, 0.016, blue);
      box(details, x, -0.135, 0.434, 0.017, 0.30, 0.017, white);
    }
    box(details, 0, -0.30, 0.412, 0.17, 0.38, 0.028, wood);
    box(details, 0.056, -0.29, 0.437, 0.020, 0.022, 0.02, cream);
    box(details, 0, 0.13, 0.445, 0.84, 0.13, 0.086, cream);
    box(details, 0, 0.025, 0.46, 0.92, 0.052, 0.075, roof);
    for (let i = 0; i < 8; i++) {
      box(details, -0.39 + i * 0.11, -0.025, 0.47,
        0.095, 0.10, 0.05, i % 2 ? roofLight : white);
    }
  } else {
    // Proper bilateral gable roof: two sloping planes + solid end triangles.
    // A 4-sided ConeGeometry has a diamond base and can never form a gable.
    const gable = new THREE.Shape();
    gable.moveTo(-0.44, 0.19);
    gable.lineTo(0.44, 0.19);
    gable.lineTo(0, 0.47);
    gable.closePath();
    const infill = new THREE.ExtrudeGeometry(gable, {
      depth: 0.79, steps: 1, bevelEnabled: false, curveSegments: 1,
    });
    infill.translate(0, 0, -0.395);
    add(shell, infill, 0xffffff);
    const rise = 0.25, run = 0.47;
    const slope = Math.atan2(rise, run);
    const slopeWidth = Math.hypot(rise, run) + 0.025;
    for (const side of [-1, 1]) {
      box(details, side * 0.235, 0.345, 0, slopeWidth, 0.034,
        0.965, roof, -side * slope);
      // Roof tile courses make the slope visible at third-person distance.
      for (let course = 0; course < 6; course++) {
        for (let column = 0; column < 7; column++) {
          const x = side * (0.075 + column * 0.053);
          const z = -0.393 + course * 0.157 + (column % 2) * 0.015;
          const y = 0.47 - Math.abs(x) * rise / run + 0.022;
          box(details, x, y, z, 0.075, 0.012, 0.148,
            (column + course) % 3 === 0 ? roofLight : roof, -side * slope);
        }
      }
    }
    // Ridge, fascia, eaves and painted gable boards.
    box(details, 0, 0.477, 0, 0.075, 0.030, 0.96, roofLight);
    for (const z of [-0.468, 0.468]) {
      box(details, 0, 0.20, z, 0.90, 0.042, 0.024, white);
      box(details, 0, 0.46, z, 0.065, 0.045, 0.025, white);
    }
    // Masonry chimney sits behind the roof ridge on the far slope.
    if (!barn) {
      box(details, 0.245, 0.391, -0.23, 0.11, 0.20, 0.13, 0xb97e6c);
      box(details, 0.245, 0.482, -0.23, 0.15, 0.028, 0.16, cream);
    }
    if (barn) {
      // Full barn doors with a readable white X, lintel and loft window.
      box(details, 0, -0.29, 0.421, 0.51, 0.40, 0.031, 0xa83f38);
      box(details, 0, -0.29, 0.444, 0.52, 0.044, 0.027, white);
      for (const x of [-0.25, 0.25]) {
        box(details, x, -0.29, 0.443, 0.040, 0.42, 0.032, white);
      }
      box(details, 0, -0.29, 0.447, 0.045, 0.56, 0.03, white, 0.72);
      box(details, 0, -0.29, 0.447, 0.045, 0.56, 0.03, white, -0.72);
      box(details, 0, 0.125, 0.406, 0.18, 0.15, 0.025, white);
      box(details, 0, 0.125, 0.424, 0.13, 0.11, 0.021, blue);
      box(details, 0, 0.125, 0.44, 0.025, 0.12, 0.02, white);
    } else {
      // Porch door, sash windows, pastel shutters, flower boxes.
      box(details, 0, -0.305, 0.413, 0.19, 0.375, 0.032, wood);
      box(details, 0.062, -0.30, 0.438, 0.021, 0.022, 0.02, cream);
      box(details, 0, -0.491, 0.446, 0.27, 0.019, 0.084, sill);
      for (const x of [-0.286, 0.286]) {
        box(details, x, -0.08, 0.414, 0.17, 0.24, 0.022, white);
        box(details, x, -0.08, 0.428, 0.137, 0.20, 0.018, blue);
        box(details, x, -0.08, 0.44, 0.019, 0.235, 0.02, white);
        box(details, x, -0.08, 0.441, 0.157, 0.019, 0.021, white);
        for (const side of [-1, 1]) {
          box(details, x + side * 0.105, -0.08, 0.432,
            0.044, 0.25, 0.027, darkBlue);
        }
        box(details, x, -0.219, 0.44, 0.22, 0.061, 0.09, 0xa46c4a);
        for (let f = -1; f <= 1; f++) {
          box(details, x + f * 0.057, -0.179, 0.466,
            0.045, 0.047, 0.045, f === 0 ? 0xffd578 : 0xf39bb6);
        }
      }
    }
  }
  // Side windows and their sills break up the long blank facade from street angles.
  for (const side of [-1, 1]) {
    const x = side * 0.444;
    for (const z of [-0.18, 0.19]) {
      box(details, x, -0.105, z, 0.018, 0.235, 0.175, white);
      box(details, x + side * 0.013, -0.105, z, 0.015, 0.194, 0.139, blue);
      box(details, x + side * 0.024, -0.105, z, 0.016, 0.235, 0.019, white);
      box(details, x + side * 0.024, -0.105, z - 0.106,
        0.023, 0.25, 0.031, darkBlue);
      box(details, x + side * 0.024, -0.105, z + 0.106,
        0.023, 0.25, 0.031, darkBlue);
      box(details, x + side * 0.026, -0.237, z, 0.072, 0.025, 0.205, sill);
    }
  }

  const built = { shell: finish(shell), details: finish(details) };
  // Fails loudly on any future overhanging/tilted part rather than silently
  // crushing a design back into the descriptor with a post-merge rescale.
  for (const geometry of [built.shell, built.details]) {
    const b = geometry.boundingBox!;
    if (Math.max(Math.abs(b.min.x), Math.abs(b.max.x),
      Math.abs(b.min.y), Math.abs(b.max.y),
      Math.abs(b.min.z), Math.abs(b.max.z)) > 0.511) {
      throw new Error('Architecture exceeded its descriptor envelope: ' + kind);
    }
  }
  return built;
}
