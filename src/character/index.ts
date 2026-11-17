/** Public, browser-side character lane. Never imported by the headless simulation. */
export { GoatCharacter, createGoatCharacter } from './GoatCharacter';
export { LegacyGoatCharacter, createLegacyGoatCharacter } from './LegacyGoatCharacter';
export type { GoatTier, CharacterAction, MotionFrame } from './motion';
export {
  ACTIONS, TIERS, TIER_PROFILES, tierFromPhysicsScale,
  actionFromPhysics, sampleMotion, previewRig,
} from './motion';
export type { PhysicsVisualState, TierProfile, PreviewRig } from './motion';
export {
  GOAT_VARIANTS, GOAT_GLB_FILES, GOAT_CLIPS, selectGoatVariant,
  locomotionBlend, clipForAction, goatPublicAssetUrl,
} from './rigged';
export type { GoatVariant, GoatClip, GoatCharacterOptions, LocomotionBlend } from './rigged';
