/** Self-contained, renderer-agnostic running contact dust (Three.js only). */
export {
  RunningDustPuffs, createRunningDustPuffs,
  type RunningDustOptions,
} from './RunningDustPuffs';
export {
  groundDirection, makeDustBurst, sampleDustParticle, seededRandom,
  type DustFrame, type DustKind, type DustParticle, type Vec3Like,
} from './dustMath';
