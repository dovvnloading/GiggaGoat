import * as THREE from 'three';

/**
 * Shop anchors were measured on the original shell. A balcony or sign can
 * project beyond it without shifting the roof, street entrance or night glass.
 */
export function libraryPlacementBounds(root: THREE.Object3D): THREE.Box3 {
  const frame: readonly number[] | undefined = root.userData.placementBounds;
  if (frame?.length === 6) {
    return new THREE.Box3(new THREE.Vector3().fromArray(frame),
      new THREE.Vector3().fromArray(frame, 3));
  }
  return new THREE.Box3().setFromObject(root);
}

/** Custom and USDCraft models are authored to their collider/anchor envelopes. */
export function isAuthoredLibraryAsset(path: string): boolean {
  return path.startsWith('assets/library/custom/') ||
    path.startsWith('assets/library/usdcraft/');
}

/** Fit wooden-ramp.glb to the walkable wedge, whose crest is at local +Z. */
export function fitTimberRamp(geometry: THREE.BufferGeometry): void {
  const bounds = geometry.boundingBox!;
  const span = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  // The tops of the boards are not the extremes of the timber frame.
  // These are the tread heights at the toe and crest as a fraction of its height.
  const toe = .0548, crest = 1.0031;
  geometry.translate(-centre.x, -bounds.min.y, -centre.z);
  geometry.rotateY(Math.PI);
  geometry.scale(1 / Math.max(.001, span.x), 1 / (Math.max(.001, span.y) * (crest - toe)),
    1 / Math.max(.001, span.z));
  geometry.translate(0, -.5 - toe / (crest - toe), 0);
}

export interface LibraryModelFit {
  /** Additional Y rotation in model-local space, either zero or a quarter turn. */
  yaw: number;
  /** World-space scale; uniform except for explicitly authored library assets. */
  scale: THREE.Vector3;
}

/**
 * Choose the horizontal orientation with the least anisotropic box/native
 * ratios, then fit the entire native model without changing its proportions.
 * The caller centres X/Z and places the source's minimum Y on the box floor.
 */
export function fitLibraryModel(
  native: Readonly<THREE.Vector3>, box: Readonly<THREE.Vector3>, path: string,
): LibraryModelFit {
  const x = Math.max(native.x, 0.001);
  const y = Math.max(native.y, 0.001);
  const z = Math.max(native.z, 0.001);
  const direct = [box.x / x, box.y / y, box.z / z];
  if (isAuthoredLibraryAsset(path)) {
    return { yaw: 0, scale: new THREE.Vector3(direct[0]!, direct[1]!, direct[2]!) };
  }
  const turned = [box.x / z, box.y / y, box.z / x];
  const distortion = (ratios: number[]): number =>
    Math.max(...ratios) / Math.max(1e-9, Math.min(...ratios));
  const rotate = distortion(turned) < distortion(direct);
  const ratios = rotate ? turned : direct;
  const scale = Math.min(...ratios);
  return { yaw: rotate ? Math.PI / 2 : 0, scale: new THREE.Vector3(scale, scale, scale) };
}
