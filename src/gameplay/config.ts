/** Single tuning source. All times are seconds, distances metres and scores points.
 * Tuning rationale lives beside each group and in README.md. */
export const TUNING = {
  fixedDt: 1 / 60,
  maxTicksPerAdvance: 60_000, // reject pathological catch-up rather than stall the UI
  // 100 stamina is legible on a HUD; a climb lasts ~5s, sprint ~8s.
  stamina: { max: 100, sprintDrain: 12, climbDrain: 20, chargeDrain: 14,
    regen: 24, regenDelay: 0.85, minStart: 8 },
  // A hard hit should mean a ~1s comic tumble, not a lost fight.
  balance: { max: 100, knockdownAt: 15, recoveryToStand: 45,
    recoverDelay: 1.05, recoverPerSecond: 44, regenDelay: 1.2, regenPerSecond: 16, flopCooldown: 1.6 },
  headbutt: { minCharge: 0.10, maxCharge: 1.5, cooldown: 0.38,
    level2: 0.48, level3: 1.05, baseImpulse: 9, speedBonusPerMps: 0.035, maxSpeedBonus: 0.4 },
  tongue: { cooldown: 0.35, flingCooldown: 0.95, reelSpeed: 6, flingImpulse: 13 },
  bleat: { cooldown: 0.8, spamWindow: 5, maxBleatsPerWindow: 3, radius: 4, impulse: 4 },
  glide: { minAirTime: 0.25 },
  style: {
    comboWindow: 3.2, meterMax: 100, pointsToMeter: 0.48,
    varietyPerNewType: 0.32, varietyMaxBonus: 1.6,
    repeatFactor: 0.53, qualityMin: 0.25, qualityMax: 2,
    // GIGGA is a multi-trick feat; a single huge event cannot trigger it.
    giggaMinTricks: 8, giggaMinDistinct: 4,
    idleDrain: 1.3, giggaIdleDrain: 5.5, scaleEaseRate: 5.5,
    tierEnter: { Billy: 16, Big: 55, GIGGA: 100 },
    tierExit: { Billy: 10, Big: 44, GIGGA: 74 },
    trickPoints: {
      flip: 11, airtime: 6, 'wall-climb': 9, 'tongue-swing': 14,
      knockback: 12, topple: 16, destruction: 18, 'near-miss': 10,
      'ragdoll-bounce': 8, 'big-splash': 17,
    },
    customMaxPoints: 20, customMaxIdLength: 64,
  },
  // Quick challenges teach advanced movement; rewards buy sidegrades, never power.
  progression: {
    fiveTrickDistinct: 3, wallChalkDrainFactor: 0.82,
    aerialHornsImpulseFactor: 1.25, aerialHornsChargeDrainFactor: 1.15,
    unlockCosts: {
      glide: 30, 'wall-chalk': 40, 'aerial-horns': 75,
      'kite-cape': 45, 'neon-hooves': 20, 'meteor-horns': 100,
    },
    challengeGoals: {
      'five-trick-combo': 5, 'mountain-goat': 50,
      'wrecking-crew': 10, 'sling-king': 8, 'master-builder': 12,
    },
    challengeRewards: {
      'five-trick-combo': 20, 'mountain-goat': 45,
      'wrecking-crew': 25, 'sling-king': 25, 'master-builder': 20,
    },
  },
  // More mass/impact is the reward for growth; GIGGA trades away finesse.
  size: {
    Kid: { scale: 0.6, mass: 0.55, impulse: 0.7, reach: 0.78, speed: 1.23, stepHeight: 0.65, canClimb: true },
    Billy: { scale: 1, mass: 1, impulse: 1, reach: 1, speed: 1, stepHeight: 1, canClimb: true },
    Big: { scale: 1.6, mass: 2.6, impulse: 1.65, reach: 1.35, speed: 0.86, stepHeight: 1.5, canClimb: true },
    GIGGA: { scale: 3, mass: 8, impulse: 3.1, reach: 2.3, speed: 0.72, stepHeight: 2.5, canClimb: false },
  },
  // Fast building is a movement skill: cheap pieces, free undo, costly destruction.
  build: {
    gridSize: 2, maxHeight: 48, maxHorizontalCell: 100_000, refundFraction: 1,
    hp: { floor: 60, wall: 80, ramp: 70, 'launch-pad': 95 },
    cost: {
      floor: { hay: 3, wood: 0, scrap: 0 },
      wall: { hay: 2, wood: 2, scrap: 0 },
      ramp: { hay: 4, wood: 1, scrap: 0 },
      'launch-pad': { hay: 2, wood: 2, scrap: 3 },
    },
    inventoryCaps: { hay: 100, wood: 65, scrap: 40 },
  },
} as const;

export type SizeTier = keyof typeof TUNING.size;
export type Material = keyof typeof TUNING.build.inventoryCaps;
export type PieceType = keyof typeof TUNING.build.hp;
export type BuiltinTrick = keyof typeof TUNING.style.trickPoints;
