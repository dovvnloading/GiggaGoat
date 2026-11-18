/** Public, engine-independent world data. Distances are metres; Y is up. */
export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Transform { position: Vec3; rotationY: number }
export type Seed = string | number;

export const POI_IDS = [
  'hoofington', 'baa-ardwalk', 'crane-yard', 'downtown-bleatsville',
  'mt-gigga', 'whispering-pines', 'the-dam', 'old-lighthouse',
] as const;
export type PoiId = (typeof POI_IDS)[number];

export const BIOMES = [
  'ocean', 'beach', 'meadow', 'farmland', 'town', 'industrial',
  'pine-forest', 'highlands', 'cliff', 'freshwater',
] as const;
export type Biome = (typeof BIOMES)[number];

export type PropKind =
  | 'barn' | 'house' | 'shop' | 'tower' | 'windmill' | 'lighthouse'
  | 'ferris-wheel' | 'crane' | 'scaffold' | 'beam' | 'pier' | 'deck' | 'pier-rail'
  | 'bumper' | 'booth' | 'satellite-dish' | 'dam-wall'
  | 'fence' | 'hay-bale' | 'crate' | 'barrel' | 'tree-pine' | 'tree-oak'
  | 'rock' | 'log' | 'lamp' | 'ramp' | 'ledge' | 'bridge'
  | 'bench' | 'sign' | 'flag' | 'buoy' | 'platform' | 'deck-stilts'
  | 'silo' | 'mailbox' | 'gnome' | 'trampoline' | 'bunting'
  | 'container' | 'cone' | 'awning' | 'planter' | 'fountain'
  | 'ac-unit' | 'water-tower' | 'mushroom' | 'stump' | 'lookout'
  | 'control-house' | 'dock' | 'cottage' | 'shipwreck'
  | 'cave-mouth' | 'bush' | 'flower' | 'grass-tuft' | 'rope-rail'
  | 'stepping-stone' | 'chimney' | 'signboard'
  | 'kiosk-sign-icecream' | 'kiosk-sign-popcorn' | 'kiosk-sign-games'
  | 'kiosk-sign-prizes' | 'kiosk-sign-candy'
  | 'concrete-slab' | 'concrete-column' | 'yard-scaffold' | 'safety-rail'
  | 'chain-fence' | 'crane-jib' | 'crane-cab' | 'crane-cable'
  | 'red-girder' | 'pipe-stack' | 'site-barrier' | 'site-banner'
  | 'palm-tree' | 'floodlight' | 'life-ring' | 'cable-spool'
  | 'pallet-stack' | 'log-bridge' | 'fern' | 'lily-pads';

export type BodyDescriptor =
  | { type: 'static' }
  | { type: 'dynamic'; mass: number };

export interface PropDescriptor {
  id: string;
  kind: PropKind;
  poiId?: PoiId;
  transform: Transform;
  /** Visual bounds, in metres. */
  size: Vec3;
  body: BodyDescriptor;
  /** Primitive collider; convex uses an eight-vertex irregular rock hull. */
  shape: 'cuboid' | 'cylinder' | 'convex';
  /** Some decorative pieces have separately collidable structural supports. */
  collidable: boolean;
  breakable: boolean;
  lickable: boolean;
  climbable: boolean;
  color?: number;
}

export interface PlotDescriptor {
  poiId: PoiId;
  center: Vec2;
  radius: number;
  elevation: number;
  /** A small uniform pad except for the mountain and woodland. */
  flat: boolean;
}

export interface PoiDescriptor {
  id: PoiId;
  name: string;
  center: Vec3;
  radius: number;
  biome: Biome;
  description: string;
}

export interface RiverPoint extends Vec2 {
  /** Water surface elevation, not the riverbed. */
  level: number;
  width: number;
}
export interface ReservoirDescriptor {
  center: Vec2;
  radiusX: number;
  radiusZ: number;
  level: number;
}
export interface RoadPoint extends Vec3 { bridge: boolean }
export interface RoadDescriptor {
  id: string;
  from: PoiId;
  to: PoiId;
  type: 'road' | 'trail';
  width: number;
  points: RoadPoint[];
}
export interface SpawnPoint {
  id: string;
  poiId: PoiId;
  position: Vec3;
  heading: number;
}
export type RelicCategory = 'rooftop' | 'cliff-ledge' | 'under-pier' | 'forest' | 'secret' | 'platform';
export interface RelicSpot {
  id: string;
  poiId: PoiId;
  position: Vec3;
  category: RelicCategory;
  hint: string;
}

export interface HeightfieldColliderDescriptor {
  shape: 'heightfield';
  /** Number of grid segments per axis; heights has (rows+1)*(cols+1) entries. */
  rows: number;
  cols: number;
  heights: Float32Array;
  scale: Vec3;
  position: Vec3;
}
export interface PropColliderDescriptor {
  shape: 'cuboid' | 'cylinder' | 'convex';
  id: string;
  transform: Transform;
  size: Vec3;
  body: BodyDescriptor;
  /** Hull vertices are local metres, in x/y/z triples. */
  vertices?: Float32Array;
}
export type ColliderDescriptor = HeightfieldColliderDescriptor | PropColliderDescriptor;

export interface IslandData {
  seed: Seed;
  size: number;
  resolution: number;
  seaLevel: number;
  /** Row-major; x changes fastest, z from -size/2 to +size/2. */
  heights: Float32Array;
  /** The same grid as heights; entries index into BIOMES. */
  biomeMap: Uint8Array;
  /** The same grid as heights; 0=unassigned, otherwise POI_IDS index + 1. */
  zoneMap: Uint8Array;
  pois: PoiDescriptor[];
  plots: PlotDescriptor[];
  river: RiverPoint[];
  reservoir: ReservoirDescriptor;
  roads: RoadDescriptor[];
  props: PropDescriptor[];
  colliders: ColliderDescriptor[];
  spawns: SpawnPoint[];
  relics: RelicSpot[];
  tideLevels: number[];
}
export interface IslandOptions {
  seed?: Seed;
  /** Horizontal extent, metres; default 600. */
  size?: number;
  /** Samples per axis, including edges; default 193. */
  resolution?: number;
}

export interface ColliderBuild {
  terrain: import('@dimforge/rapier3d-compat').Collider;
  props: Map<string, import('@dimforge/rapier3d-compat').Collider>;
  bodies: Map<string, import('@dimforge/rapier3d-compat').RigidBody>;
}
