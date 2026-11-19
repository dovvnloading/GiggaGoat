/** Public HUD sprite names are centralized here; paths never depend on the page's URL. */
export const HUD_SPRITES = {
  sizeMeterFrame: 'player/growth_frame',
  growthFill: 'player/growth_fill',
  growthBanner: 'hud/banner_purple',
  tierPurple: 'hud/tab_pill_purple',
  tierBrown: 'hud/tab_pill_brown',
  tierGold: 'hud/tab_pill_gold',
  scoreStarburst: 'hud/score_starburst',
  minimapRing: 'hud/minimap_ring',
  gigCard: 'hud/gig_card',
  staminaRing: 'player/stamina_dial',
  hotbarTray: 'hud/hotbar_tray',
  hotbarSlot: 'hud/hotbar_slot',
  hotbarSlotSelected: 'hud/hotbar_slot_selected',
  promptPill: 'hud/prompt_pill',
  keyBadge: 'hud/key_badge',
  goatKid: 'player/goat_kid',
  goatBilly: 'player/goat_billy',
  goatBig: 'player/goat_big',
  goatGigga: 'player/goat_gigga',
  staminaHooves: 'player/hoof_emblem',
  hayFloor: 'icons/hay_floor',
  fenceWall: 'icons/fence_wall',
  hayRamp: 'icons/hay_ramp',
  launchPad: 'icons/launch_pad',
  suppliesCrate: 'icons/supplies_crate',
  cudCoin: 'icons/cud_coin',
  compassN: 'icons/compass_n',
  mapPin: 'icons/map_pin',
  markerBarn: 'icons/marker_barn',
  markerHouseBlue: 'icons/marker_house_blue',
  markerHousePink: 'icons/marker_house_pink',
  markerTreeRound: 'icons/marker_tree_round',
  markerTreePine: 'icons/marker_tree_pine',
  markerTreeApple: 'icons/marker_tree_apple',
} as const;

export type HudSpriteName = (typeof HUD_SPRITES)[keyof typeof HUD_SPRITES];

/**
 * In dev this module lives at /src/core/HudSprites.ts; in a Vite build it is
 * bundled under /assets/. Resolve from the module, not document.location:
 * GitHub Pages serves the same bundle under /GiggaGoat/ instead of /.
 * The PNGs are public files (not imported/hashed Vite assets).
 */
export function hudSpriteUrl(name: HudSpriteName): string {
  const siteRoot = new URL(import.meta.env.DEV ? '../../' : '../', import.meta.url);
  return new URL('assets/ui/sprites/' + name + '.png', siteRoot).href;
}

/** Decorative images remain readable by tests via data-sprite, not by CSS alone. */
export function hudSpriteImage(name: HudSpriteName, className: string): string {
  return '<img class="' + className + '" data-sprite="' + name + '" src="' +
    hudSpriteUrl(name) + '" alt="" aria-hidden="true" draggable="false">';
}

/** Set CSS custom properties once for the full-panel images and nine-slice pills. */
export function hudSpriteVariables(): string {
  return Object.entries(HUD_SPRITES).map(([key, name]) =>
    '--gg-' + key + ':url("' + hudSpriteUrl(name) + '")').join(';');
}
