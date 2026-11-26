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
export { islandWeather } from './island-weather';
export type { IslandWeather } from './island-weather';
export { createAmbientLifePlan, residentStride } from './ambient-life';
export type { AmbientActivity, AmbientLifePlan, AmbientResidentDefinition, AmbientResidentModel,
  AmbientResidentRole, AmbientResidentState, AmbientStation, AmbientStationKind } from './ambient-life';
export { createAmbientNavigation, findAmbientPath, isAmbientFootSupported,
  isAmbientSegmentSafe, nearestAmbientNode } from './ambient-navigation';
export type { AmbientBlocker, AmbientNavigation, AmbientNavNode } from './ambient-navigation';
export { sampleEnvironmentWind } from './environment-wind';
export type { EnvironmentWind } from './environment-wind';
export { buildAmbientLifeVisuals } from './visual-ambient-life';
export type { AmbientLifeVisualOptions, ResidentQuality } from './visual-ambient-life';
export { buildDowntownLifeVisuals } from './visual-downtown-life';
export { buildMarketFruitVisuals } from './visual-market-fruit';
export type { MarketFruitVisualState } from './visual-market-fruit';
