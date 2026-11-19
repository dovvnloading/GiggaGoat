/** Pure audio decisions. No DOM/WebAudio dependency; safe in Node and deterministic replays. */
import type { PoiId } from '../world';

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }
export type AudioBus = 'music' | 'sfx' | 'ui' | 'ambience';
export type Surface = 'grass' | 'sand' | 'wood' | 'rock' | 'metal' | 'water';
export type GoatVoice = 'hero' | 'raspy' | 'goofy' | 'robot';
export type AudioMode = 'free' | 'party';
export type AudioLocation = PoiId;
export type AudioSettings = {
  master: number; music: number; sfx: number; ui: number; ambience: number; muted: boolean;
};
export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  master: .85, music: .52, sfx: .88, ui: .7, ambience: .43, muted: false,
});
export const SOUND_IDS = [
  'graze', 'checkpoint', 'bleat', 'headbutt-charge', 'headbutt-impact',
  'tongue-shoot', 'tongue-stick', 'tongue-reel', 'tongue-snap',
  'footstep-grass', 'footstep-sand', 'footstep-wood', 'footstep-rock',
  'footstep-metal', 'footstep-water', 'jump', 'flip-whoosh', 'landing',
  'ragdoll-flop', 'climb', 'splash', 'crate-break', 'prop-break',
  'domino', 'soda-pop', 'trampoline', 'launch-pad', 'build-place',
  'build-snap', 'build-collapse', 'combo', 'gigga-grow', 'gigga-shrink',
  'coin', 'gig-success', 'gig-fail', 'rating-bronze', 'rating-silver',
  'rating-gold', 'party-countdown', 'tide-warning', 'elimination',
  'victory', 'ui-click', 'ui-back', 'ui-confirm', 'ambient-bird',
  'ambient-gull', 'ambient-stream', 'ambient-wind', 'ambient-town',
  'ambient-dam',
] as const;
export type SoundId = (typeof SOUND_IDS)[number];
export const SURFACES: readonly Surface[] = ['grass', 'sand', 'wood', 'rock', 'metal', 'water'];
export const VOICES: readonly GoatVoice[] = ['hero', 'raspy', 'goofy', 'robot'];
export const LOCATIONS: readonly AudioLocation[] = [
  'hoofington', 'baa-ardwalk', 'crane-yard', 'downtown-bleatsville',
  'mt-gigga', 'whispering-pines', 'the-dam', 'old-lighthouse',
];
export const CULL_DISTANCE = 275;
export const MAX_VOICES = 32;

export function clamp(value: number, lo = 0, hi = 1): number {
  return Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : lo;
}
export function settingsFrom(value: unknown): AudioSettings {
  const data = value !== null && typeof value === 'object'
    ? value as Record<string, unknown> : {};
  const volume = (key: keyof Omit<AudioSettings, 'muted'>): number =>
    typeof data[key] === 'number' && Number.isFinite(data[key])
      ? clamp(data[key], 0, 1) : DEFAULT_AUDIO_SETTINGS[key];
  return {
    master: volume('master'), music: volume('music'), sfx: volume('sfx'),
    ui: volume('ui'), ambience: volume('ambience'),
    muted: typeof data.muted === 'boolean' ? data.muted : false,
  };
}
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
/** Island-sized, occlusion-free attenuation; smooth to silence before 275m. */
export function distanceGain(metres: number): number {
  if (!Number.isFinite(metres) || metres >= CULL_DISTANCE) return 0;
  const d = Math.max(0, metres);
  const attenuation = 1 / (1 + Math.pow(Math.max(0, d - 5) / 42, 1.28));
  const fade = clamp((CULL_DISTANCE - d) / 45);
  return attenuation * fade * fade * (3 - 2 * fade);
}
/** Kid is deliberately squeaky; a 3x GIGGA goat has a much heavier fundamental. */
export function goatPitch(size: number): number {
  return clamp(Math.pow(Math.max(.5, Number.isFinite(size) ? size : 1), -.53), .48, 1.55);
}
export function stepLength(size: number): number {
  return clamp(1.1 * Math.pow(Math.max(.6, size), .55), .7, 2.25);
}

/** xorshift32 + FNV-1a seed hashing. Never samples Math.random. */
export class AudioRandom {
  private state: number;
  constructor(seed: string | number = 0x9e3779b9) {
    let s = typeof seed === 'number' ? seed >>> 0 : 2166136261;
    if (typeof seed === 'string') {
      for (let i = 0; i < seed.length; i++) {
        s ^= seed.charCodeAt(i);
        s = Math.imul(s, 16777619) >>> 0;
      }
    }
    this.state = s || 0x6d2b79f5;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  integer(maxExclusive: number): number { return Math.floor(this.next() * Math.max(1, maxExclusive)); }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
    return items[this.integer(items.length)]!;
  }
}

export interface VoiceTicket {
  id: number; sound: SoundId; priority: number; loudness: number; started: number;
}
export type VoiceDecision = { allowed: true; steal: number | null } |
  { allowed: false; reason: 'culled' | 'priority' };
export function soundPriority(sound: SoundId): number {
  if (sound === 'tide-warning' || sound === 'victory' || sound === 'elimination' ||
      sound === 'gigga-grow' || sound === 'gigga-shrink') return 100;
  if (sound === 'headbutt-impact' || sound === 'gig-success' ||
      sound === 'gig-fail' || sound.startsWith('rating-')) return 86;
  if (sound === 'splash' || sound === 'crate-break' || sound === 'prop-break' ||
      sound === 'launch-pad' || sound === 'build-collapse') return 65;
  if (sound === 'bleat' || sound === 'combo' || sound === 'trampoline' ||
      sound === 'party-countdown' || sound.startsWith('ui-')) return 45;
  if (sound.startsWith('footstep-') || sound.startsWith('ambient-')) return 12;
  return 34;
}
export function soundLimit(sound: SoundId): number {
  if (sound.startsWith('footstep-')) return 4;
  if (sound.startsWith('ambient-')) return 2;
  if (sound.startsWith('rating-') || sound === 'victory' ||
      sound === 'gig-success' || sound === 'gig-fail' ||
      sound === 'gigga-grow' || sound === 'gigga-shrink' ||
      sound === 'tide-warning') return 1;
  if (sound === 'bleat') return 3;
  if (sound === 'headbutt-impact' || sound === 'landing') return 5;
  return 4;
}
/** Reject lower-priority requests rather than cutting off an important sound. */
export function decideVoice(
  active: readonly VoiceTicket[], sound: SoundId, priority: number,
  loudness: number, maxVoices = MAX_VOICES, limit = soundLimit(sound),
): VoiceDecision {
  if (!(loudness > 0)) return { allowed: false, reason: 'culled' };
  const same = active.filter(v => v.sound === sound);
  const pool = same.length >= limit ? same : active.length >= maxVoices ? active : [];
  if (pool.length === 0) return { allowed: true, steal: null };
  const worst = [...pool].sort((a, b) =>
    a.priority - b.priority || a.loudness - b.loudness || a.started - b.started || a.id - b.id)[0]!;
  if (worst.priority > priority || (worst.priority === priority && worst.loudness > loudness * 1.5)) {
    return { allowed: false, reason: 'priority' };
  }
  return { allowed: true, steal: worst.id };
}

/** Music bus reduction: 50ms soft attack, 150ms hold, 900ms recovering tail. */
export function duckGainSince(elapsed: number, depth = .34): number {
  const d = clamp(depth, .12, 1);
  if (elapsed < 0) return 1;
  if (elapsed < .05) {
    const t = clamp(elapsed / .05);
    return 1 - (1 - d) * (t * t * (3 - 2 * t));
  }
  if (elapsed < .20) return d;
  if (elapsed >= 1.1) return 1;
  const t = (elapsed - .20) / .90;
  return d + (1 - d) * (t * t * (3 - 2 * t));
}
export function isBigMoment(sound: SoundId, intensity = 1): boolean {
  return sound === 'gigga-grow' || sound === 'gigga-shrink' ||
    sound === 'victory' || sound === 'elimination' ||
    sound === 'tide-warning' || sound === 'gig-success' ||
    (sound === 'headbutt-impact' && intensity >= .76) ||
    (sound === 'splash' && intensity >= .82);
}

export interface MusicState {
  mode: AudioMode;
  combo: number;
  meter: number;
  tide: number; // 0..1
  poi: AudioLocation;
  night: boolean;
}
export const DEFAULT_MUSIC_STATE: Readonly<MusicState> = Object.freeze({
  mode: 'free', combo: 0, meter: 0, tide: 0, poi: 'hoofington', night: false,
});
export interface MusicPlan {
  bpm: number; drums: boolean; bass: boolean; lead: boolean;
  rhythm: boolean; tension: number; brightness: number; intensity: number;
  mode: AudioMode; poi: AudioLocation; night: boolean;
}
export function selectMusic(state: MusicState): MusicPlan {
  const meter = clamp(state.meter / 100);
  const tide = clamp(state.tide);
  const combo = Math.max(0, Number.isFinite(state.combo) ? state.combo : 0);
  const party = state.mode === 'party';
  const tension = party ? clamp(.22 + tide * .78) : 0;
  return {
    bpm: Math.round((party ? 124 + tide * 42 : 112) - (state.night ? 6 : 0)),
    drums: party || combo >= 2 || meter >= .22,
    bass: party || combo >= 3 || meter >= .38,
    lead: party ? tide >= .22 || combo >= 3 : combo >= 5 || meter >= .64,
    rhythm: !state.night || party || combo >= 1 || meter >= .12,
    tension, brightness: state.night ? .52 : 1,
    intensity: clamp(.36 + .25 * Math.min(1, combo / 6) + .24 * meter + .15 * tension, .25, 1),
    mode: state.mode, poi: state.poi, night: state.night,
  };
}
/** A progression whose notes transpose with the POI, seeded independently of frame rate. */
export function scorePattern(seed: number | string, bar: number): readonly number[] {
  const rng = new AudioRandom(String(seed) + ':bar:' + Math.floor(bar / 4));
  const skeleton = [0, 2, 4, 2, 5, 4, 2, 1, 0, 4, 2, 5, 4, 2, 1, 0];
  return skeleton.map((note, step) => {
    const alternate = rng.next();
    return step % 4 === 0 ? note : alternate < .15 ? -1 : alternate < .42 ? (note + 2) % 7 : note;
  });
}
