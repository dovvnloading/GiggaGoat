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
    camera: { x: 285, y: 275, z: 355 }, target: { x: 0, y: 34, z: 0 },
    fov: 53, day: 0.49, tide: 0 },
  { id: '18', label: '18 · Billy Isle map', image: '18_billy_isle_map.png',
    camera: { x: 0, y: 760, z: 1 }, target: { x: 0, y: 0, z: 0 },
    fov: 48, day: 0.5, tide: 0 },
  { id: '08', label: '08 · Hoofington village', image: '08_poi_hoofington.png',
    camera: { x: -204, y: 42, z: 211 }, target: { x: -146, y: 9, z: 132 },
    fov: 60, day: 0.53, tide: 0 },
  { id: '09', label: '09 · Baa-ardwalk', image: '09_poi_baaardwalk.png',
    camera: { x: 99, y: 42, z: 338 }, target: { x: 58, y: 8, z: 252 },
    fov: 59, day: 0.29, tide: 0 },
  { id: '10', label: '10 · Crane Yard', image: '10_poi_crane_yard.png',
    camera: { x: 260, y: 72, z: 18 }, target: { x: 185, y: 17, z: -47 },
    fov: 61, day: 0.52, tide: 0 },
  { id: '11', label: '11 · Downtown Bleatsville', image: '11_poi_downtown.png',
    camera: { x: 215, y: 44, z: 210 }, target: { x: 145, y: 12, z: 121 },
    fov: 59, day: 0.53, tide: 0 },
  { id: '12', label: '12 · Mt. Gigga', image: '12_poi_mt_gigga.png',
    camera: { x: 130, y: 159, z: 148 }, target: { x: 0, y: 57, z: 0 },
    fov: 54, day: 0.5, tide: 0 },
  { id: '13', label: '13 · Whispering Pines', image: '13_poi_whispering_pines.png',
    camera: { x: -224, y: 53, z: -68 }, target: { x: -147, y: 14, z: -150 },
    fov: 62, day: 0.49, tide: 0 },
  { id: '14', label: '14 · The Dam', image: '14_poi_the_dam.png',
    camera: { x: 82, y: 78, z: -270 }, target: { x: -17, y: 14, z: -192 },
    fov: 55, day: 0.53, tide: 0 },
  { id: '15', label: '15 · Old Lighthouse', image: '15_poi_lighthouse.png',
    camera: { x: -350, y: 49, z: 63 }, target: { x: -259, y: 17, z: -18 },
    fov: 57, day: 0.29, tide: 0 },
  { id: '16', label: '16 · Rising tide', image: '16_mode_rising_tide.png',
    camera: { x: 264, y: 249, z: 284 }, target: { x: 0, y: 65, z: 0 },
    fov: 54, day: 0.43, tide: 49 },
] as const;
export function findBookmark(id: string): ArtBookmark | undefined {
  return ART_BOOKMARKS.find(bookmark => bookmark.id === id);
}
