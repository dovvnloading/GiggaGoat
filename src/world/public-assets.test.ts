import { describe, expect, it } from 'vitest';
import { publicAssetUrl } from './public-assets';

const dam = 'assets/library/custom/the-dam/the-dam.glb';

describe('publicAssetUrl', () => {
  it('resolves from the deployed game root (with or without index.html)', () => {
    expect(publicAssetUrl(dam, '/GiggaGoat/', './'))
      .toBe('/GiggaGoat/' + dam);
    expect(publicAssetUrl(dam, '/GiggaGoat/index.html', './'))
      .toBe('/GiggaGoat/' + dam);
  });

  it('resolves from nested Pages labs, never inside their viewer directory', () => {
    expect(publicAssetUrl(dam, '/GiggaGoat/src/world/viewer/index.html', './'))
      .toBe('/GiggaGoat/' + dam);
    expect(publicAssetUrl(dam, '/GiggaGoat/src/character/lab/', './'))
      .toBe('/GiggaGoat/' + dam);
  });

  it('resolves from the Vite dev server root and lab pages', () => {
    expect(publicAssetUrl(dam, '/src/world/viewer/index.html', './'))
      .toBe('/' + dam);
    expect(publicAssetUrl(dam, '/index.html', './')).toBe('/' + dam);
    expect(publicAssetUrl(dam, '/', './')).toBe('/' + dam);
  });

  it('respects an absolute Vite base when one is configured', () => {
    expect(publicAssetUrl('/' + dam, '/GiggaGoat/src/world/viewer/', '/GiggaGoat/'))
      .toBe('/GiggaGoat/' + dam);
  });
});
