import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { launchChromeDevTools } from '../../test-utils/chrome';
import { ART_BOOKMARKS } from './bookmarks';

async function until<T>(read: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch { /* Server or DevTools is still starting. */ }
    await sleep(150);
  }
  throw new Error('Timed out waiting for Vite or Chrome DevTools');
}

interface Measurement {
  id: string;
  p50Ms: number;
  avgMs: number;
  p90Ms: number;
  frames: number;
  drawCalls: number;
  triangles: number;
  width: number;
  height: number;
  pixelRatio: number;
  gpu: string;
}
interface Report {
  bookmarks: Measurement[];
  crane: Record<string, Measurement>;
  dpr: number;
  userAgent: string;
  hotspots: { name: string; triangles: number }[];
}

// Chrome is preinstalled on the GitHub-hosted Ubuntu runner. Running through
// the real WebGL renderer + gl.finish() measures completed GPU/CPU frames,
// not just a requestAnimationFrame clock or the Three.js triangle counter.
// The budget guard for the specific bottleneck is in renderer-budget.test.ts;
// this hardware-dependent measurement is reported, not an absolute FPS gate.
describe.skipIf(!process.env['CI'])('world viewer real-Chrome frame profiling', () => {
  it('reports actual per-bookmark before/after frame costs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'billy-isle-chrome-'));
    const port = 5189;
    let vite: ChildProcess | undefined;
    let browser: ChildProcess | undefined;
    let socket: WebSocket | undefined;
    try {
      vite = spawn(process.execPath, [
        'node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
        '--port', String(port), '--strictPort',
      ], { cwd: process.cwd(), stdio: 'ignore' });
      vite.on('error', error => { console.error('Vite failed:', error); });
      await until(async () => {
        const response = await fetch('http://127.0.0.1:' + port +
          '/src/world/viewer/index.html');
        return response.ok ? true : null;
      }, 20000);

      const launched = await launchChromeDevTools(
        'http://127.0.0.1:' + port + '/src/world/viewer/index.html?profile=1',
        directory, {
          timeoutMs: 40000,
          extraFlags: ['--force-device-scale-factor=1.5'],
          softwareWebgl: true,
        },
      );
      browser = launched.browser;
      const debuggingPort = launched.port;
      const target = await until(async () => {
        const response = await fetch('http://127.0.0.1:' + debuggingPort + '/json/list');
        const tabs = await response.json() as Array<{
          type: string; url: string; webSocketDebuggerUrl?: string;
        }>;
        return tabs.find(tab => tab.type === 'page' &&
          tab.url.includes('/src/world/viewer/index.html'))?.webSocketDebuggerUrl ?? null;
      }, 20000);

      socket = new WebSocket(target);
      const connectedSocket = socket;
      await new Promise<void>((resolve, reject) => {
        connectedSocket.addEventListener('open', () => resolve(), { once: true });
        connectedSocket.addEventListener('error',
          () => reject(new Error('Chrome DevTools WebSocket failed')), { once: true });
      });
      let nextId = 0;
      const pending = new Map<number, {
        resolve: (result: any) => void; reject: (error: Error) => void;
      }>();
      connectedSocket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data)) as {
          id?: number; result?: any; error?: { message: string };
        };
        if (message.id === undefined) return;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      });
      const send = (method: string, params: Record<string, unknown> = {},
        timeoutMs?: number): Promise<any> =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
            pending.delete(id);
            reject(new Error(method + ' timed out after ' + timeoutMs + 'ms'));
          }, timeoutMs);
          pending.set(id, {
            resolve: result => { clearTimeout(timer); resolve(result); },
            reject: error => { clearTimeout(timer); reject(error); },
          });
          try {
            connectedSocket.send(JSON.stringify({ id, method, params }));
          } catch (error) {
            pending.delete(id);
            clearTimeout(timer);
            reject(error);
          }
        });

      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false,
      });
      await until(async () => {
        const response = await send('Runtime.evaluate', {
          expression: 'Boolean(window.__worldProfile)',
          returnByValue: true,
        });
        return response.result?.value === true ? true : null;
      }, 45000);

      // The benchmark starts as soon as the viewer boots, before its async
      // GLB could arrive. Check the actual model and the painting's bookmark
      // camera first rather than profiling the temporary fallback.
      const damView = await until(async () => {
        const value = await send('Runtime.evaluate', {
          expression: String.raw`(() => {
            const menu = document.getElementById('bookmark');
            if (!menu || !window.__worldProfile) return null;
            menu.value = '14';
            menu.dispatchEvent(new Event('change', { bubbles: true }));
            return window.__worldProfile.damHeroState();
          })()`,
          returnByValue: true,
        });
        const state = value.result?.value as {
          loaded: boolean; inFrame: boolean; reservoirHidden: boolean;
          camera: number[]; target: number[];
        } | undefined;
        return state?.loaded ? state : null;
      }, 30000);
      expect(damView.inFrame).toBe(true);
      for (const [axis, value] of [-52, 26, -119].entries()) {
        expect(damView.camera[axis]).toBeCloseTo(value, 5);
      }
      for (const [axis, value] of [-17, 16, -191].entries()) {
        expect(damView.target[axis]).toBeCloseTo(value, 5);
      }

      // Run a render pass to apply the async Dam model switch, then ensure
      // the terrain-bound reservoir stays visible when the Dam GLB arrives.
      await send('Runtime.evaluate', {
        expression: 'window.__worldProfile.measure(2)', returnByValue: true,
      });
      const latest = await send('Runtime.evaluate', {
        expression: 'window.__worldProfile.damHeroState()', returnByValue: true,
      });
      expect(latest.result?.value?.reservoirHidden).toBe(false);

      // Asset arrivals are asynchronous; profile the actual village GLBs,
      // not the temporary procedural placeholders displayed during fetch.
      const hoofington = await until(async () => {
        const answer = await send('Runtime.evaluate', {
          expression: 'window.__worldProfile.hoofingtonState()',
          returnByValue: true,
        });
        const state = answer.result?.value as {
          loaded: boolean; models: number; triangles: number;
        } | undefined;
        return state?.loaded ? state : null;
      }, 40000);
      expect(hoofington.models).toBeGreaterThanOrEqual(20);
      expect(hoofington.triangles).toBeGreaterThan(5000);

      // Rendered bookmark-11 QA runs after the actual GLTF handoff, not while
      // the fallback procedural shops are still on screen.
      const downtown = await until(async () => {
        const response = await send('Runtime.evaluate', {
          expression: 'window.__worldProfile.downtownState()',
          returnByValue: true,
        });
        const state = response.result?.value as {
          loaded: boolean; models: number; triangles: number;
          awnings: boolean;
        } | undefined;
        return state?.loaded ? state : null;
      }, 45000);
      expect(downtown.models).toBeGreaterThanOrEqual(28);
      expect(downtown.triangles).toBeGreaterThan(5000);
      // Blender shop GLBs include their awnings; no procedural overlay remains.
      expect(downtown.awnings).toBe(false);
      // Wait for the *actual* prop GLBs, not only the Downtown facades.
      // This prevents a fast procedural fallback from disguising broken paths.
      const library = await until(async () => {
        const response = await send('Runtime.evaluate', {
          expression: 'window.__worldProfile.propLibraryState()',
          returnByValue: true,
        });
        const state = response.result?.value as {
          ready: boolean; loaded: number; failed: number; pending: number;
        } | undefined;
        return state?.ready ? state : null;
      }, 120000);
      expect(library.pending).toBe(0);
      expect(library.loaded).toBeGreaterThan(50);
      expect(library.failed).toBe(0);
      console.log('WORLD_PROP_LIBRARY ' + JSON.stringify(library));
      await send('Runtime.evaluate', {
        expression: '(() => { const menu = document.getElementById("bookmark"); ' +
          'menu.value = "11"; menu.dispatchEvent(new Event("change", ' +
          '{ bubbles: true })); window.__worldProfile.measure(2); })()',
      });
      const ground = await until(async () => {
        const result = await send('Runtime.evaluate', {
          expression: 'window.__worldProfile.groundFinishState("downtown-bleatsville")',
          returnByValue: true,
        });
        const state = result.result?.value;
        return state?.maps === 4 && state.mix > .95 ? state : null;
      }, 30000);
      expect(ground.programs).toBeGreaterThan(0);
      expect(ground.linked).toBe(ground.programs);
      expect(ground.edgeSampler).toBe(true);
      console.log('WORLD_GROUND_FINISH ' + JSON.stringify(ground));
      // A compact real-WebGL reference for comparing the painting by eye.
      // The JPEG is emitted only on CI; no image is committed to another lane.
      const screenshot = await send('Page.captureScreenshot', {
        format: 'jpeg', quality: 58, fromSurface: true,
      });
      if (screenshot.data) {
        console.log('WORLD_DOWNTOWN_SCREENSHOT ' + screenshot.data);
      }
      // Also capture the unobscured 3D world at precisely the same bookmark
      // for hands-on art review; restore all overlays before profiling.
      await send('Runtime.evaluate', {
        expression: '["panel","reference","labels","hint"].forEach(id => ' +
          '{ document.getElementById(id).style.visibility = "hidden"; });',
      });
      const clean = await send('Page.captureScreenshot', {
        format: 'jpeg', quality: 68, fromSurface: true,
      });
      if (clean.data) console.log('WORLD_DOWNTOWN_CLEAN ' + clean.data);
      await send('Runtime.evaluate', {
        expression: '["panel","reference","labels","hint"].forEach(id => ' +
          '{ document.getElementById(id).style.visibility = ""; });',
      });

      const expression = String.raw`(() => {
        const profile = window.__worldProfile;
        const menu = document.getElementById('bookmark');
        if (!profile || !menu || !menu.options.length) throw new Error('Viewer failed to start');
        // Production default after the fill-rate fix; the previous run used 1.5.
        profile.pixelRatio(1);
        profile.water(true);
        profile.sky(true);
        profile.shadows(true);
        profile.outlines(true);
        const measure = (id) => {
          menu.value = id;
          menu.dispatchEvent(new Event('change', { bubbles: true }));
          const sample = profile.measure(12);
          const times = [...sample.frameTimesMs].sort((a, b) => a - b);
          return {
            id, p50Ms: times[Math.floor(times.length / 2)],
            avgMs: times.reduce((a, b) => a + b, 0) / times.length,
            p90Ms: times[Math.floor(times.length * 0.9)],
            frames: times.length, drawCalls: sample.drawCalls,
            triangles: sample.triangles, width: sample.width, height: sample.height,
            pixelRatio: sample.pixelRatio, gpu: sample.gpu,
          };
        };
        const bookmarks = Array.from(menu.options, option => measure(option.value));
        const crane = { normal: measure('10') };
        profile.water(false);
        crane.noWater = measure('10');
        profile.water(true);
        profile.shadows(false);
        crane.noShadows = measure('10');
        profile.shadows(true);
        profile.outlines(false);
        crane.noOutlines = measure('10');
        profile.outlines(true);
        profile.sky(false);
        crane.noSky = measure('10');
        profile.sky(true);
        profile.pixelRatio(1.5);
        crane.pixelRatio1point5 = measure('10');
        profile.pixelRatio(1);
        measure('08');
        const hotspots = profile.meshCosts();
        return { bookmarks, crane, hotspots, dpr: window.devicePixelRatio,
          userAgent: navigator.userAgent };
      })()`;
      const answer = await send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (answer.exceptionDetails) {
        throw new Error('Chrome benchmark failed: ' +
          JSON.stringify(answer.exceptionDetails));
      }
      const report = answer.result?.value as Report | undefined;
      console.log('WORLD_CHROME_PROFILE ' + JSON.stringify(report));
      console.log('WORLD_GPU_HOTSPOTS ' + JSON.stringify(report?.hotspots));
      expect(report?.bookmarks).toHaveLength(ART_BOOKMARKS.length);
      expect(report?.dpr).toBe(1.5);
      const hoofBudget = report!.bookmarks.find(mark => mark.id === '08');
      expect(hoofBudget, 'Hoofington bookmark must be profiled').toBeDefined();
      expect(hoofBudget!.triangles, 'bookmark 08 exceeds 400k triangles')
        .toBeLessThanOrEqual(400_000);
      // Art lead decision: the painting hero props (palms, floodlights, spools,
      // pallets, life rings, log bridge) are separate authored instanced kinds,
      // each one draw where visible. 215 keeps headroom without merging kinds.
      expect(hoofBudget!.drawCalls, 'bookmark 08 exceeds 215 draw calls')
        .toBeLessThanOrEqual(215);
      expect(report!.bookmarks.find(mark => mark.id === '11')?.drawCalls,
        'bookmark 11 exceeds 215 draw calls').toBeLessThanOrEqual(215);
      // Library prop batches can remove their outline draws before profiling;
      // toggling outlines off may then leave the already-optimized count equal.
      expect(report!.crane.noOutlines!.drawCalls)
        .toBeLessThanOrEqual(report!.crane.normal!.drawCalls);
      for (const mark of report!.bookmarks) {
        expect(mark.frames).toBe(12);
        expect(mark.p50Ms).toBeGreaterThan(0);
        expect(mark.p50Ms).toBeLessThan(1000 / 60);
        expect(mark.width).toBeGreaterThan(1000);
        expect(mark.height).toBeGreaterThan(600);
      }
      // Preserve real rendered world views for PR art review. Capture after
      // profiling so screenshot overhead cannot distort the frame timings.
      // Read the WebGL canvas in the same task as the render; unlike the page
      // screenshot API this does not wait for the headless Chrome compositor.
      if (process.env['WORLD_DETAIL_PREVIEWS'] === '1') {
        const output = join(process.cwd(), '.world-detail-previews');
        mkdirSync(output, { recursive: true });
        const jpegPrefix = 'data:image/jpeg;base64,';
        for (const id of ['08', '09', '10', '11', '12', '13', '14', '15']) {
          console.log('WORLD_DETAIL_PREVIEW capturing ' + id);
          const response = await send('Runtime.evaluate', {
            expression: 'window.__worldProfile.captureBookmark(' + JSON.stringify(id) + ')',
            returnByValue: true,
          }, 60000);
          expect(response.exceptionDetails, 'bookmark ' + id + ' capture failed').toBeUndefined();
          const data = response.result?.value;
          expect(typeof data === 'string' && data.startsWith(jpegPrefix),
            'bookmark ' + id + ' must return a JPEG').toBe(true);
          const bytes = Buffer.from(data.slice(jpegPrefix.length), 'base64');
          expect(bytes.length, 'bookmark ' + id + ' returned an empty JPEG').toBeGreaterThan(2);
          expect(bytes.readUInt16BE(0), 'bookmark ' + id + ' JPEG header').toBe(0xffd8);
          expect(bytes.readUInt16BE(bytes.length - 2), 'bookmark ' + id + ' JPEG trailer').toBe(0xffd9);
          writeFileSync(join(output, id + '.jpg'), bytes);
          console.log('WORLD_DETAIL_PREVIEW saved ' + id + ' (' + bytes.length + ' bytes)');
        }
      }
      // Recorded by a successful main-branch Chrome CI run at the same
      // viewport, renderer scale and GPU backend.
      const baseline = {
        '08': { triangles: 792297, drawCalls: 183 },
        '11': { triangles: 657362, drawCalls: 178 },
        '14': { triangles: 528622, drawCalls: 97 },
      };
      console.log('WORLD_LOD_COMPARE ' + JSON.stringify(
        (['08', '11', '14'] as const).map(id => ({
          id, before: baseline[id],
          after: report!.bookmarks.find(mark => mark.id === id),
        }))));

    } finally {
      socket?.close();
      browser?.kill();
      vite?.kill();
      // Chrome persists profile state briefly after SIGTERM. Do not convert
      // a successful WebGL benchmark into a failed test over cleanup races.
      if (browser && browser.exitCode === null) {
        await Promise.race([
          new Promise<void>(resolve => browser!.once('exit', () => resolve())),
          sleep(2500),
        ]);
      }
      try {
        rmSync(directory, { recursive: true, force: true,
          maxRetries: 12, retryDelay: 150 });
      } catch (error) {
        console.warn('Chrome profile cleanup deferred:', error);
      }
    }
  // The optional eight-frame art export has its own bounded CDP requests.
  // Give it additional wall-clock budget without changing the regular profile.
  }, process.env['WORLD_DETAIL_PREVIEWS'] === '1' ? 600000 : 420000);
});
