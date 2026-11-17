import { defineConfig } from 'vite';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Every dev lab / sandbox / viewer page under src/ is built too, so the live
 *  GitHub Pages deploy can be used for visual QA (e.g. /src/character/lab/). */
function labPages(): Record<string, string> {
  const pages: Record<string, string> = { main: resolve(__dirname, 'index.html') };
  const srcDir = resolve(__dirname, 'src');
  for (const lane of readdirSync(srcDir)) {
    const laneDir = join(srcDir, lane);
    if (!statSync(laneDir).isDirectory()) continue;
    for (const sub of readdirSync(laneDir)) {
      const page = join(laneDir, sub, 'index.html');
      if (existsSync(page)) pages[`${lane}-${sub}`] = page;
    }
  }
  return pages;
}

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { input: labPages() },
  },
});
