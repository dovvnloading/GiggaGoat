/** Public, browser-side character lane. Never imported by the headless simulation. */
export { GoatCharacter, createGoatCharacter } from './GoatCharacter';
export type { GoatTier, CharacterAction, MotionFrame } from './motion';
export {
  ACTIONS, TIERS, TIER_PROFILES, tierFromPhysicsScale,
  actionFromPhysics, sampleMotion, previewRig,
} from './motion';
export type { PhysicsVisualState, TierProfile, PreviewRig } from './motion';
