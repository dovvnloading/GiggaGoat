import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { ART_BOOKMARKS } from './bookmarks';

const chrome = [
  process.env['CHROME_PATH'],
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].find(path => path && existsSync(path));

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
}

// Chrome is preinstalled on the GitHub-hosted Ubuntu runner. Running through
// the real WebGL renderer + gl.finish() measures completed GPU/CPU frames,
// not just a requestAnimationFrame clock or the Three.js triangle counter.
// The budget guard for the specific bottleneck is in renderer-budget.test.ts;
// this hardware-dependent measurement is reported, not an absolute FPS gate.
describe.skipIf(!process.env['CI'] || !chrome)('world viewer real-Chrome frame profiling', () => {
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

      browser = spawn(chrome!, [
        '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
        '--enable-webgl', '--enable-unsafe-swiftshader',
        '--use-gl=angle', '--use-angle=swiftshader',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--force-device-scale-factor=1.5',
        '--window-size=1280,720',
        '--remote-debugging-port=0',
        '--user-data-dir=' + directory,
        'http://127.0.0.1:' + port + '/src/world/viewer/index.html?profile=1',
      ], { stdio: 'ignore' });
      browser.on('error', error => { console.error('Chrome failed:', error); });

      const debuggingPort = await until(async () => {
        const path = join(directory, 'DevToolsActivePort');
        if (!existsSync(path)) return null;
        const value = Number(readFileSync(path, 'utf8').split('\n')[0]);
        return value > 0 ? value : null;
      }, 25000);
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
      const send = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          pending.set(id, { resolve, reject });
          connectedSocket.send(JSON.stringify({ id, method, params }));
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
      // the procedural reservoir is hidden instead of overlapping the GLB.
      await send('Runtime.evaluate', {
        expression: 'window.__worldProfile.measure(2)', returnByValue: true,
      });
      const latest = await send('Runtime.evaluate', {
        expression: 'window.__worldProfile.damHeroState()', returnByValue: true,
      });
      expect(latest.result?.value?.reservoirHidden).toBe(true);

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
          signs: number; awnings: boolean;
        } | undefined;
        return state?.loaded ? state : null;
      }, 45000);
      expect(downtown.models).toBeGreaterThanOrEqual(28);
      expect(downtown.triangles).toBeGreaterThan(5000);
      expect(downtown.signs).toBe(10);
      expect(downtown.awnings).toBe(true);
      await send('Runtime.evaluate', {
        expression: '(() => { const menu = document.getElementById("bookmark"); ' +
          'menu.value = "11"; menu.dispatchEvent(new Event("change", ' +
          '{ bubbles: true })); window.__worldProfile.measure(2); })()',
      });
      // A compact real-WebGL reference for comparing the painting by eye.
      // The JPEG is emitted only on CI; no image is committed to another lane.
      const screenshot = await send('Page.captureScreenshot', {
        format: 'jpeg', quality: 58, fromSurface: true,
      });
      if (screenshot.data) {
        console.log('WORLD_DOWNTOWN_SCREENSHOT ' + screenshot.data);
      }

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
        return { bookmarks, crane, dpr: window.devicePixelRatio,
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
      expect(report?.bookmarks).toHaveLength(ART_BOOKMARKS.length);
      expect(report?.dpr).toBe(1.5);
      expect(report!.crane.noOutlines!.drawCalls)
        .toBeLessThan(report!.crane.normal!.drawCalls);
      for (const mark of report!.bookmarks) {
        expect(mark.frames).toBe(12);
        expect(mark.p50Ms).toBeGreaterThan(0);
        expect(mark.p50Ms).toBeLessThan(1000 / 60);
        expect(mark.width).toBeGreaterThan(1000);
        expect(mark.height).toBeGreaterThan(600);
      }
      console.log('WORLD_CHROME_PROFILE ' + JSON.stringify(report));

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
  }, 180000);
});
