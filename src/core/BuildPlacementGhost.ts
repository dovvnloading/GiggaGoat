import * as THREE from 'three';
import { BUILD_RAMP_VERTICES, BUILD_RAMP_TRIANGLES, type PieceType } from '../gameplay';
import { getBuildPieceSize } from '../props';
import type { BuildPreview } from './Game';

const READY_COLOR = 0xa4ffd2;
const BLOCKED_COLOR = 0xff746e;

function pieceGeometry(type: PieceType): THREE.BufferGeometry {
  if (type !== 'ramp') {
    const { x, y, z } = getBuildPieceSize(type);
    return new THREE.BoxGeometry(x, y, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(BUILD_RAMP_VERTICES, 3));
  geometry.setIndex([...BUILD_RAMP_TRIANGLES]);
  return geometry;
}

function orientationArrow(): THREE.ShapeGeometry {
  const arrow = new THREE.Shape();
  arrow.moveTo(-.14, -.64);
  arrow.lineTo(.14, -.64);
  arrow.lineTo(.14, .1);
  arrow.lineTo(.4, .1);
  arrow.lineTo(0, .66);
  arrow.lineTo(-.4, .1);
  arrow.lineTo(-.14, .1);
  arrow.closePath();
  return new THREE.ShapeGeometry(arrow).rotateX(-Math.PI / 2);
}

/** Stable, asset-independent preview of the exact collision envelope and direction. */
export class BuildPlacementGhost {
  readonly root = new THREE.Group();
  private readonly shapes = new Map<PieceType, { body: THREE.BufferGeometry; edges: THREE.EdgesGeometry }>();
  private readonly fill = new THREE.MeshBasicMaterial({
    color: READY_COLOR, transparent: true, opacity: .24, depthWrite: false,
  });
  private readonly wire = new THREE.LineBasicMaterial({
    color: READY_COLOR, transparent: true, opacity: .95, depthWrite: false,
  });
  private readonly arrowPaint = new THREE.MeshBasicMaterial({
    color: READY_COLOR, side: THREE.DoubleSide, depthWrite: false, transparent: true, opacity: 1,
  });
  private readonly body: THREE.Mesh;
  private readonly edges: THREE.LineSegments;
  private readonly arrow = new THREE.Mesh(orientationArrow(), this.arrowPaint);

  constructor() {
    for (const type of ['floor', 'wall', 'ramp', 'launch-pad'] as const) {
      const body = pieceGeometry(type);
      this.shapes.set(type, { body, edges: new THREE.EdgesGeometry(body) });
    }
    const floor = this.shapes.get('floor')!;
    this.body = new THREE.Mesh(floor.body, this.fill);
    this.edges = new THREE.LineSegments(floor.edges, this.wire);
    this.body.renderOrder = 4;
    this.edges.renderOrder = 5;
    this.arrow.renderOrder = 6;
    this.body.name = 'build-preview-body';
    this.arrow.name = 'build-preview-orientation';
    this.root.name = 'hay-build-placement-preview';
    this.root.visible = false;
    this.root.add(this.body, this.edges, this.arrow);
  }

  update(preview: BuildPreview | null): void {
    this.root.visible = preview !== null;
    if (!preview) return;
    const { placement, position, validation } = preview;
    const shape = this.shapes.get(placement.type)!;
    this.body.geometry = shape.body;
    this.edges.geometry = shape.edges;
    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.y = placement.rotation * Math.PI / 2;
    const color = validation.valid ? READY_COLOR : BLOCKED_COLOR;
    this.fill.color.setHex(color);
    this.wire.color.setHex(color);
    this.arrowPaint.color.setHex(color);

    // A blocked cell can contain an opaque piece. Keep its outline legible.
    this.wire.depthTest = validation.valid;
    this.arrowPaint.depthTest = validation.valid;
    this.arrow.visible = placement.type !== 'floor';
    this.arrow.position.y = getBuildPieceSize(placement.type).y / 2 + .14;
    // The ramp rises towards +Z. Walls and launch pads use local forward (-Z).
    this.arrow.rotation.y = placement.type === 'ramp' ? Math.PI : 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const shape of this.shapes.values()) {
      shape.body.dispose();
      shape.edges.dispose();
    }
    this.fill.dispose();
    this.wire.dispose();
    this.arrowPaint.dispose();
    this.arrow.geometry.dispose();
  }
}
