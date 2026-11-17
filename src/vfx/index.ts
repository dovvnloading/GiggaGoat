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
