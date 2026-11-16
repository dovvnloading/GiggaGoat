/** Public opt-in chaos layer: no imports from gameplay, world or core. */
export { WaterSystem } from './WaterSystem';
export type { WaterVolume, WaterOptions, WaterEvent, WaterBodyOptions } from './WaterSystem';
export { BreakableRegistry } from './BreakableRegistry';
export type { BreakableOptions, DestructionEvent, DestructionCause, DestructionOptions } from './BreakableRegistry';
export { ChainReactions } from './ChainReactions';
export type { DominoOptions, SodaOptions, ChainEvent } from './ChainReactions';
export { PHYSICS_MATERIALS, applyPhysicsMaterial, SurfaceSystem } from './SurfaceSystem';
export type { MaterialName, PhysicsMaterial, SurfaceOptions, TrampolineOptions,
  LaunchPadOptions, ConveyorOptions, SurfaceEvent } from './SurfaceSystem';
export { DynamicBodyBudget } from './DynamicBodyBudget';
