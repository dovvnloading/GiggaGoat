/** GOAT GIGS: public engine-agnostic, deterministic fixed-tick API. */
export { GigCatalog, GIG_INFO, TICKS_PER_SECOND, BOARD_CYCLE_TICKS } from './catalog';
export { GigDirector } from './engine';
export { GigGameplayBridge } from './integrations';
export { GIG_IDS, DIFFICULTIES, HAY_HAUL_TAG_RADIUS } from './types';
export type {
  Point, GigId, Difficulty, Rating, GigStatus, GigVerb, GigInfo, GigOffer,
  GigBoard, GigPropSpawn, GigMarker, GigConfig, GigSetup,
  HayConfig, RooftopConfig, DemolitionConfig, MowConfig, EscortConfig,
  StackConfig, SummitConfig, SplashConfig,
  GoatFact, PropFact, AbilityFact, StyleFact, GigFrame, GigObjective,
  GigMetrics, GigRun, GigBest, GigAward, GigEvent, GigSnapshot,
} from './types';
