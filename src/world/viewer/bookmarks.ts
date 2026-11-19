import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../types';

export interface ArtBookmark {
  id: string;
  label: string;
  image: string;
  camera: Vec3;
  target: Vec3;
  fov: number;
  day: number;
  tide: number;
}
/**
 * Camera compositions use the same north-up world map as the environment art.
 * Each option opens the source painting alongside the matching live view.
 */
export const ART_BOOKMARKS: readonly ArtBookmark[] = [
  { id: '07', label: '07 · Billy Isle key art', image: '07_key_art.png',
    camera: { x: -167.5, y: 9, z: 97 }, target: { x: 0, y: 40, z: 0 },
    fov: 55, day: 0.49, tide: 0 },
  { id: '18', label: '18 · Billy Isle map', image: '18_billy_isle_map.png',
    camera: { x: 0, y: 760, z: 1 }, target: { x: 0, y: 0, z: 0 },
    fov: 48, day: 0.5, tide: 0 },
  { id: '08', label: '08 · Hoofington village', image: '08_poi_hoofington.png',
    camera: { x: -147, y: 11.5, z: 171 }, target: { x: -147, y: 10, z: 91 },
    fov: 64, day: 0.53, tide: 0 },
  { id: '09', label: '09 · Baa-ardwalk', image: '09_poi_baaardwalk.png',
    camera: { x: 50, y: 7, z: 249 }, target: { x: 56.5, y: 19, z: 310 },
    fov: 68, day: 0.29, tide: 0 },
  { id: '10', label: '10 · Crane Yard', image: '10_poi_crane_yard.png',
    camera: { x: 195, y: 11.5, z: -3 }, target: { x: 179, y: 19, z: -59 },
    fov: 60, day: 0.52, tide: 0 },
  { id: '11', label: '11 · Downtown Bleatsville', image: '11_poi_downtown.png',
    camera: { x: 145, y: 12, z: 158 }, target: { x: 145, y: 11, z: 81 },
    fov: 65, day: 0.53, tide: 0 },
  { id: '12', label: '12 · Mt. Gigga', image: '12_poi_mt_gigga.png',
    camera: { x: 132, y: 98, z: 148 }, target: { x: 0, y: 69, z: 0 },
    fov: 55, day: 0.5, tide: 0 },
  { id: '13', label: '13 · Whispering Pines', image: '13_poi_whispering_pines.png',
    camera: { x: -130, y: 6.5, z: -175.5 }, target: { x: -98, y: 9, z: -151 },
    fov: 60, day: 0.49, tide: 0 },
  { id: '14', label: '14 · The Dam', image: '14_poi_the_dam.png',
    camera: { x: -52, y: 26, z: -119 }, target: { x: -17, y: 16, z: -191 },
    fov: 57, day: 0.53, tide: 0 },
  { id: '15', label: '15 · Old Lighthouse', image: '15_poi_lighthouse.png',
    camera: { x: -310, y: 38, z: 100 }, target: { x: -259, y: 11, z: -18 },
    fov: 35, day: 0.29, tide: 0 },
  { id: '16', label: '16 · Rising tide', image: '16_mode_rising_tide.png',
    camera: { x: 264, y: 249, z: 284 }, target: { x: 0, y: 65, z: 0 },
    fov: 54, day: 0.43, tide: 49 },
] as const;
export function findBookmark(id: string): ArtBookmark | undefined {
  return ART_BOOKMARKS.find(bookmark => bookmark.id === id);
}
/**
 * Apply a bookmark's authored pose without an OrbitControls constraint or
 * pending damped drag silently moving the camera on the next update.
 */
export function applyBookmarkCamera(
  camera: PerspectiveCamera, orbit: OrbitControls, bookmark: ArtBookmark,
): void {
  const dx = bookmark.camera.x - bookmark.target.x;
  const dy = bookmark.camera.y - bookmark.target.y;
  const dz = bookmark.camera.z - bookmark.target.z;
  const distance = Math.hypot(dx, dy, dz);
  const polarAngle = distance === 0 ? 0 :
    Math.acos(Math.max(-1, Math.min(1, dy / distance)));
  orbit.maxPolarAngle = Math.max(Math.PI * 0.49, polarAngle + 0.02);
  orbit.minDistance = Math.min(orbit.minDistance, distance);
  orbit.maxDistance = Math.max(orbit.maxDistance, distance);

  // Consume any residual free-orbit damping before installing the saved pose.
  const damping = orbit.enableDamping;
  orbit.enableDamping = false;
  orbit.update();
  camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
  camera.fov = bookmark.fov;
  camera.updateProjectionMatrix();
  orbit.target.set(bookmark.target.x, bookmark.target.y, bookmark.target.z);
  camera.lookAt(orbit.target);
  orbit.update();
  orbit.enableDamping = damping;
}
