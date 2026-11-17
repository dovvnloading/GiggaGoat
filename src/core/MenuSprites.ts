/** Existing pre-sliced menu artwork; keep names aligned with public/assets/ui/sprites/sprites.json. */
export const MENU_SPRITES = {
  panel: 'menu/panel_tall',
  stat: 'menu/stat_card',
  yellowNormal: 'menu/button_yellow_normal',
  yellowHover: 'menu/button_yellow_hover',
  yellowPressed: 'menu/button_yellow_pressed',
  purpleNormal: 'menu/button_purple_normal',
  purpleHover: 'menu/button_purple_hover',
  purplePressed: 'menu/button_purple_pressed',
  toggleOff: 'menu/toggle_off',
  toggleOn: 'menu/toggle_on',
  slider: 'menu/slider',
  checkboxEmpty: 'menu/checkbox_empty',
  checkboxChecked: 'menu/checkbox_checked',
  close: 'menu/button_close',
  back: 'menu/button_back',
  tabBrown: 'menu/tab_brown',
  tabGold: 'menu/tab_gold_active',
  tabPurple: 'menu/tab_purple',
} as const;
export type MenuSpriteName = (typeof MENU_SPRITES)[keyof typeof MENU_SPRITES];

/**
 * Public PNG paths are site-root relative, NOT origin-root relative.
 * In dev the module URL is /src/core/MenuSprites.ts; after bundling it is
 * /<repo>/assets/<bundle>.js. Resolve from that location so both / and the
 * GitHub Pages /GiggaGoat/ prefix work with Vite's relative base.
 */
export function menuSpriteUrl(name: MenuSpriteName): string {
  const siteRoot = new URL(import.meta.env.DEV ? '../../' : '../', import.meta.url);
  return new URL('assets/ui/sprites/' + name + '.png', siteRoot).href;
}

/** Every visual control exposes its sprite by name for DOM and manifest tests. */
export function menuSkin(name: MenuSpriteName, extraCss = ''): string {
  return `data-sprite="${name}" style="--gg-sprite:url('${menuSpriteUrl(name)}');${extraCss}"`;
}
