import type { CharacterAction } from './motion';

/** Names shared by the three baked 30 fps GLBs; textures are embedded. */
export const GOAT_VARIANTS = ['hero', 'bandana', 'bell'] as const;
export type GoatVariant = (typeof GOAT_VARIANTS)[number];

export const GOAT_GLB_FILES: Readonly<Record<GoatVariant, string>> = {
  hero: 'goat_hero.glb',
  bandana: 'goat_alt_bandana.glb',
  bell: 'goat_alt_bell.glb',
};

export const GOAT_CLIPS = ['Idle', 'Walk', 'Run', 'Jump', 'Headbutt', 'Bleat'] as const;
export type GoatClip = (typeof GOAT_CLIPS)[number];
export type GoatOneShot = Extract<GoatClip, 'Jump' | 'Headbutt' | 'Bleat'>;

export interface GoatCharacterOptions {
  /** Force a look, otherwise the player is the hero and bots are stable by ID/seed. */
  variant?: GoatVariant;
  seed?: string;
}

function hash(text: string): number {
  let result = 2166136261;
  for (let i = 0; i < text.length; i++) {
    result ^= text.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function selectGoatVariant(
  goat?: { readonly id: string } | string | null,
  options: GoatCharacterOptions = {},
): GoatVariant {
  if (options.variant !== undefined) {
    if (!(GOAT_VARIANTS as readonly string[]).includes(options.variant)) {
      throw new RangeError('Unknown goat variant: ' + options.variant);
    }
    return options.variant;
  }
  const id = typeof goat === 'string' ? goat : goat?.id;
  if (id === 'player') return 'hero';
  const key = options.seed ?? id;
  return key ? GOAT_VARIANTS[hash(key) % GOAT_VARIANTS.length]! : 'hero';
}

export interface LocomotionBlend {
  readonly Idle: number;
  readonly Walk: number;
  readonly Run: number;
}

/** Piecewise crossfade: at 1.2 m/s Walk is 100%, at 3.5 m/s Run is 100%. */
export function locomotionBlend(speed: number): LocomotionBlend {
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  if (s <= 1.2) return { Idle: 1 - s / 1.2, Walk: s / 1.2, Run: 0 };
  if (s < 3.5) return { Idle: 0, Walk: (3.5 - s) / 2.3, Run: (s - 1.2) / 2.3 };
  return { Idle: 0, Walk: 0, Run: 1 };
}

/** Legacy pose vocabulary plus a direct "jump" alias for gameplay callers. */
export function clipForAction(action: CharacterAction | 'jump'): GoatClip {
  switch (action) {
    case 'sprint': return 'Run';
    case 'jump':
    case 'jump-flip': return 'Jump';
    case 'headbutt': return 'Headbutt';
    case 'bleat': return 'Bleat';
    default: return 'Idle';
  }
}

/**
 * Vite dev serves /public at the site origin; built modules live in /assets/.
 * Resolving relative to the module (not the nested lab HTML or location.pathname)
 * also works on GitHub Pages with the project's Vite base: './'.
 */
export function goatPublicAssetUrl(filename: string): string {
  const root = import.meta.env.DEV
    ? new URL('/', import.meta.url)
    : new URL('../', import.meta.url);
  return new URL('assets/characters/goat/' + filename, root).href;
}
