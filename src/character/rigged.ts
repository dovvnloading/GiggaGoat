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

// Travel speed fades the goat into motion. The controller decides whether the
// gait is a walk or a gallop, so normal movement cannot select the Run clip.
export function locomotionBlend(speed: number, galloping: boolean): LocomotionBlend {
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const moving = Math.min(1, s / 1.2);
  const run = galloping ? Math.max(0, Math.min(1, (s - 4.4) / 2.1)) : 0;
  return { Idle: 1 - moving, Walk: moving * (1 - run), Run: moving * run };
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
  // Keep this intentional directory URL dynamic: Vite's asset transform treats
  // a literal new URL('/', import.meta.url) as a filesystem asset in dev.
  const rootPath = import.meta.env.DEV ? '/' : '../';
  const root = new URL(rootPath, import.meta.url);
  return new URL('assets/characters/goat/' + filename, root).href;
}
