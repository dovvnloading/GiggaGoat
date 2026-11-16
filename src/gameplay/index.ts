/** Stable engine-agnostic gameplay API. Nothing in this subtree imports Three or Rapier. */
export { TUNING } from './config';
export type { Material, PieceType, SizeTier, BuiltinTrick } from './config';
export { EventBus } from './events';
export type { GameplayEvents } from './events';
export { SeededRng } from './rng';
export type { RngSnapshot } from './rng';
export { GoatAbilities, NEUTRAL_FACTS } from './abilities';
export type { GoatIntent, GoatPhysicsFacts, AbilityCommands, AbilitiesSnapshot, HeadbuttLevel, TongueCommand } from './abilities';
export { StyleSystem } from './style';
export type { StyleEvent, StyleSnapshot, ComboSnapshot } from './style';
export { Inventory, HayBuild } from './build';
export type { Cell, Placement, BuildPiece, QuarterTurn, MaterialCounts, Validation, PlacementFailure, BuildSnapshot } from './build';
export { CudWallet, UnlockRegistry, ChallengeTracker } from './progression';
export type { WalletSnapshot, UnlockId, UnlockDefinition, UnlockResult, UnlocksSnapshot, ChallengeId,
  ChallengeDefinition, ChallengeProgress, ChallengesSnapshot } from './progression';
export { GameSimulation } from './simulation';
export type { GameSnapshot, SimulationStep } from './simulation';
