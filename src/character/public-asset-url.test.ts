import { createServer } from 'vite';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('resolves the shipped goat after Vite transforms dev code and on nested production hosts', async () => {
  const server = await createServer({
    configFile: false, root: process.cwd(), base: './',
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    // Test the actual dev transform: a source-only URL test misses Vite
    // rewriting a literal directory into /@fs/, which serves fallback HTML.
    const result = await server.transformRequest('/src/character/rigged.ts');
    expect(result).not.toBeNull();
    const source = ts.createSourceFile('rigged.js', result!.code, ts.ScriptTarget.Latest, true);
    const helper = source.statements.find(statement => ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'goatPublicAssetUrl') as ts.FunctionDeclaration | undefined;
    expect(helper?.body).toBeDefined();
    const body = helper!.body!.getText(source).slice(1, -1)
      .replaceAll('import.meta.env.DEV', 'dev').replaceAll('import.meta.url', 'moduleUrl');
    const assetUrl = new Function('filename', 'dev', 'moduleUrl', body) as
      (filename: string, dev: boolean, moduleUrl: string) => string;

    expect(assetUrl('goat_hero.glb', true, 'http://localhost:5173/src/character/rigged.ts'))
      .toBe('http://localhost:5173/assets/characters/goat/goat_hero.glb');
    expect(assetUrl('goat_alt_bell.glb', false, 'https://example.test/GiggaGoat/assets/GoatCharacter-abc.js'))
      .toBe('https://example.test/GiggaGoat/assets/characters/goat/goat_alt_bell.glb');
    expect(assetUrl('goat_alt_bandana.glb', false, 'https://example.test/assets/GoatCharacter-abc.js'))
      .toBe('https://example.test/assets/characters/goat/goat_alt_bandana.glb');
  } finally {
    await server.close();
  }
});
