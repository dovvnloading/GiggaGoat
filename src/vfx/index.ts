/** Self-contained cosmetic ground-contact effects (Three.js only). */
export {
  RunningDustPuffs, createRunningDustPuffs,
  type RunningDustOptions,
} from './RunningDustPuffs';
export {
  groundDirection, makeDustBurst, sampleDustParticle, seededRandom,
  type DustFrame, type DustKind, type DustParticle, type Vec3Like,
} from './dustMath';

export {
  LandingImpactRing, createLandingImpactRing,
  type LandingImpactRingOptions,
} from './LandingImpactRing';
export {
  LANDING_DEBRIS_COUNT, makeLandingRingBurst, sampleLandingRing, sampleLandingDebris,
  type LandingRingBurst, type LandingRingFrame, type LandingDebrisFrame,
} from './landingRingMath';

export {
  HeadbuttImpactStars, createHeadbuttImpactStars,
  type HeadbuttImpactStarsOptions,
} from './HeadbuttImpactStars';
export {
  HEADBUTT_STAR_COUNT, makeHeadbuttBurst, sampleHeadbuttFlash, sampleHeadbuttStar,
  type HeadbuttBurst, type HeadbuttFlashFrame, type HeadbuttStarFrame,
} from './headbuttMath';

export {
  WaterSplash, createWaterSplash,
  type WaterSplashOptions,
} from './WaterSplash';
export {
  WATER_DROPLET_COUNT, makeWaterSplashBurst, sampleWaterSplash, sampleWaterDroplet,
  type WaterSplashBurst, type WaterSplashFrame, type WaterDropletFrame,
} from './waterSplashMath';

export {
  CrateBreakDebris, createCrateBreakDebris,
  type CrateBreakDebrisOptions,
} from './CrateBreakDebris';
export {
  CRATE_PLANK_COUNT, CRATE_CHIP_COUNT, CRATE_DUST_COUNT,
  makeCrateBreakBurst, sampleCrateBreak, sampleCrateFragment, sampleCrateDust,
  type CrateBreakBurst, type CrateBreakFrame, type CrateFragmentFrame, type CrateDustFrame,
} from './crateDebrisMath';

export {
  TrampolineBoing, createTrampolineBoing,
  type TrampolineBoingOptions,
} from './TrampolineBoing';
export {
  TRAMPOLINE_MAT_Y, makeTrampolineBoingBurst, makeTrampolineBoingFrame,
  sampleTrampolineBoing, type TrampolineBoingBurst, type TrampolineBoingFrame,
} from './trampolineBoingMath';

export {
  LaunchPadBurst, createLaunchPadBurst, type LaunchPadBurstOptions,
} from './LaunchPadBurst';
export {
  LAUNCH_PAD_TOP_Y, launchFlightX, launchFlightY,
  makeLaunchPadBurstCue, makeLaunchPadBurstFrame, sampleLaunchPadBurst,
  type LaunchPadBurstCue, type LaunchPadBurstFrame,
} from './launchPadMath';


export {
  ComboPopText, createComboPopText, type ComboPopTextOptions,
} from './ComboPopText';
export {
  selectComboPopTier, makeComboPopCue, makeComboPopFrame, sampleComboPop,
  type ComboPopTier, type ComboPopCue, type ComboPopFrame,
} from './comboPopMath';
export { COMBO_POP_PALETTES, type ComboPopPalette } from './comboPopArt';

export {
  GiggaGrowthPurpleAura, createGiggaGrowthPurpleAura, type GiggaGrowthPurpleAuraOptions,
} from './GiggaGrowthPurpleAura';
export {
  GROWTH_TIER_SCALES, GROWTH_BURST_SECONDS, assertGrowthTier,
  makeGrowthAuraFrame, sampleGrowthBurst, sampleGiggaHold,
  type GrowthTier, type GrowthAuraFrame,
} from './growthAuraMath';
