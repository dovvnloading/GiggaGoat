import * as THREE from 'three';
import library from './prop-kit-previews.json';
import { fitLibraryModel, fitTimberRamp } from './library-fit';
import { PROP_LIBRARY_MODELS } from './library-props';
import type { PropKind, Vec3 } from './types';

/** Original proportions, vertex paint and a bottom-centred, unit-length envelope. */
export function kitShape(kind: keyof typeof library, nativeMetres = false): THREE.BufferGeometry {
  const raw = Uint8Array.from(atob(library[kind]), c => c.charCodeAt(0));
  const bytes = new DataView(raw.buffer);
  const vertices = bytes.getUint16(0, true), triangles = bytes.getUint16(2, true);
  const pos = new Float32Array(triangles * 9), rgb = new Float32Array(pos.length);
  const colour = new THREE.Color();
  for (let i = 0; i < triangles; i++) {
    const face = 20 + vertices * 6 + i * 9;
    colour.setRGB(raw[face + 6]! / 255, raw[face + 7]! / 255, raw[face + 8]! / 255, THREE.SRGBColorSpace);
    for (let j = 0; j < 3; j++) {
      const source = 20 + 6 * bytes.getUint16(face + j * 2, true);
      const dst = i * 9 + j * 3;
      for (let k = 0; k < 3; k++) pos[dst + k] = bytes.getInt16(source + 2 * k, true) / 32760;
      colour.toArray(rgb, dst);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  if (nativeMetres) {
    const length = bytes.getFloat32(16, true);
    geo.scale(length, length, length);
    geo.translate(bytes.getFloat32(4, true), bytes.getFloat32(8, true), bytes.getFloat32(12, true));
  }
  geo.computeBoundingBox();
  geo.computeVertexNormals();
  geo.userData.preserveSilhouette = true;
  return geo;
}

/** Fit a model to a physical prop slot, with the same rules as its streamed art. */
export function kitPreview(kind: PropKind, size: Vec3): THREE.BufferGeometry {
  const geo = kitShape(kind);
  geo.userData.sourceKit = PROP_LIBRARY_MODELS[kind];
  if (kind === 'ramp') {
    fitTimberRamp(geo);
    return geo;
  }
  const bounds = geo.boundingBox!, span = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  geo.translate(-center.x, -bounds.min.y, -center.z);
  const fit = fitLibraryModel(span, new THREE.Vector3().copy(size), PROP_LIBRARY_MODELS[kind]);
  geo.rotateY(fit.yaw);
  geo.scale(fit.scale.x / size.x, fit.scale.y / size.y, fit.scale.z / size.z);
  geo.translate(0, -.5, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
