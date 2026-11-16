/** Billy Isle's public lane API. No imports from core, gameplay or physics. */
export type {
  Seed, Vec2, Vec3, Transform, Biome, PoiId, PropKind, BodyDescriptor,
  PropDescriptor, PlotDescriptor, PoiDescriptor, RiverPoint, ReservoirDescriptor,
  RoadPoint, RoadDescriptor, SpawnPoint, RelicSpot, RelicCategory,
  HeightfieldColliderDescriptor, PropColliderDescriptor, ColliderDescriptor,
  IslandData, IslandOptions, ColliderBuild,
} from './types';
export { BIOMES, POI_IDS } from './types';
export { SeededRandom, GradientNoise } from './random';
export { IslandGenerator, generateIsland, heightAt, biomeAt, zoneAt,
  landAreaAtTideLevel, hashIsland } from './island';
export { arePoisConnected } from './roads';
export { isPointInsideProps } from './layouts';
export { isSafeCollectiblePosition } from './collectibles';
export { makeColliderDescriptors, buildRapierColliders } from './colliders';
export { createWorldScene } from './render';
export type { WorldScene, WorldSceneOptions } from './render';
