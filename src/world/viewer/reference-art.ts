/**
 * Vite resolves these source paintings to served asset URLs. A root-absolute
 * "/docs/art/hifi/..." URL is not a public asset and was a broken image in
 * the standalone world viewer (including its PNG comparison export).
 */
const paintings = import.meta.glob('../../../docs/art/hifi/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export function paintingAssetUrl(filename: string): string {
  const url = paintings['../../../docs/art/hifi/' + filename];
  if (!url) throw new Error('Missing reference painting asset: ' + filename);
  return url;
}
