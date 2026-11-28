import { GameSimulation, type GameSnapshot } from '../gameplay';
import type { GigSnapshot } from '../gigs';
import type { GigBodySave } from './GigSession';
import type { Game } from './Game';
import type { Vec3 } from '../physics';

export interface RooftopPose {
  position: Vec3;
  heading: number;
}

export interface GigPlayerPose extends RooftopPose {
  attemptId: number;
}

export interface GameProgress {
  gameplay: GameSnapshot;
  gigs: GigSnapshot;
  gigBodies: GigBodySave[];
  acknowledgedGigAttempt?: number;
  post?: import('./IslandPost').PostSave;
  trialBests?: import('./TravelTrials').TrialBests;
  /** Stable IDs of one-time local discoveries; absent in older saves. */
  happenings?: import('./IslandHappenings').HappeningId[];
  gigPlayerPose?: GigPlayerPose;
  /** Saves made before remote gigs kept the player's position. */
  rooftopPose?: RooftopPose;
}
export interface GameSettings {
  mouseSensitivity: number;
  invertY: boolean;
  fov: number;
  graphics: 'low' | 'medium' | 'high';
  /** Master, music and effects gains are stored with the same versioned game save. */
  volume: number;
  musicVolume: number;
  effectsVolume: number;
}
export interface GameSave {
  version: 1;
  progress: GameProgress;
  settings: GameSettings;
}
export const SAVE_KEY = 'gigga-goat/save/v1';
export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
  mouseSensitivity: 1, invertY: false, fov: 67, graphics: 'high',
  volume: .8, musicVolume: .52, effectsVolume: .88,
});

export function validateSettings(raw: unknown): GameSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const s = raw as Partial<GameSettings>;
  const between = (n: unknown, lo: number, hi: number, fallback: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  return {
    mouseSensitivity: between(s.mouseSensitivity, .25, 3, DEFAULT_SETTINGS.mouseSensitivity),
    invertY: typeof s.invertY === 'boolean' ? s.invertY : DEFAULT_SETTINGS.invertY,
    fov: between(s.fov, 55, 95, DEFAULT_SETTINGS.fov),
    graphics: s.graphics === 'low' || s.graphics === 'medium' || s.graphics === 'high'
      ? s.graphics : DEFAULT_SETTINGS.graphics,
    volume: between(s.volume, 0, 1, DEFAULT_SETTINGS.volume),
    musicVolume: between(s.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
    effectsVolume: between(s.effectsVolume, 0, 1, DEFAULT_SETTINGS.effectsVolume),
  };
}
const storageOrNull = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
};
/** Malformed, old and blocked localStorage must never prevent boot. */
export function loadSave(storage: Pick<Storage, 'getItem'> | null = storageOrNull()): GameSave | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || (data as { version?: unknown }).version !== 1) return null;
    const value = data as GameSave;
    if (!value.progress || !Array.isArray(value.progress.gigBodies) ||
      !value.progress.gameplay || !value.progress.gigs || value.progress.gigs.version !== 1) return null;
    // Validate the gameplay snapshot before it can restore any wallet/unlocks.
    GameSimulation.fromJSON(value.progress.gameplay);
    return { version: 1, progress: value.progress, settings: validateSettings(value.settings) };
  } catch { return null; }
}
export function saveGame(game: Game, settings: GameSettings,
  storage: Pick<Storage, 'setItem'> | null = storageOrNull()): boolean {
  try {
    if (!storage) return false;
    const payload: GameSave = { version: 1, progress: game.exportProgress(),
      settings: validateSettings(settings) };
    storage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch { return false; }
}
