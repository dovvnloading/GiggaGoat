/**
 * Vite uses a relative BASE_URL for both the game and standalone lab pages.
 * Public assets are nevertheless rooted at the deployment root, not at the
 * current lab's /src/<lane>/<page>/ directory.
 */
export function publicAssetUrl(
  assetPath: string,
  pagePath: string = globalThis.location?.pathname ?? '/',
  viteBase: string = import.meta.env.BASE_URL,
): string {
  const labIndex = pagePath.indexOf('/src/');
  const root = viteBase.startsWith('/')
    ? viteBase
    : labIndex >= 0
      ? pagePath.slice(0, labIndex + 1)
      : pagePath.slice(0, pagePath.lastIndexOf('/') + 1);
  return root.replace(/\/?$/, '/') + assetPath.replace(/^\/+/, '');
}

export const ISLAND_ART_PATH = 'assets/generated/billy-isle/';
