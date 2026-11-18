import { execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { launchChromeDevTools } from '../test-utils/chrome';

const webglError = /GL_INVALID_|CONTEXT_LOST_WEBGL|WebGL.*(?:error|invalid|failed)|WebGLRenderer.*error/i;
const mime: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2',
};

async function until<T>(read: () => Promise<T | null>, timeoutMs: number,
  what: string): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await read();
      if (result !== null) return result;
    } catch { /* The browser may be navigating between execution contexts. */ }
    await sleep(120);
  }
  throw new Error('Timed out waiting for ' + what);
}

async function serveDist(): Promise<{ server: Server; url: string }> {
  const dist = resolve(process.cwd(), 'dist');
  const server = createServer(async (request, response) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch {
      // Intentionally return a real 404. The network monitor must catch missing assets.
      response.writeHead(404).end('Not found: ' + pathname);
    }
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail);
      done();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port');
  return { server, url: 'http://127.0.0.1:' + address.port + '/' };
}

interface DevtoolsPacket {
  id?: number;
  method?: string;
  error?: { message: string };
  result?: Record<string, any>;
  params?: Record<string, any>;
}

class ChromePage {
  readonly faults: string[] = [];
  phase = 'boot';
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve: (value: Record<string, any>) => void;
    reject: (error: Error) => void;
  }>();

  constructor(readonly socket: WebSocket) {
    socket.addEventListener('message', event => {
      const packet = JSON.parse(String(event.data)) as DevtoolsPacket;
      if (packet.id !== undefined) {
        const request = this.pending.get(packet.id);
        if (!request) return;
        this.pending.delete(packet.id);
        if (packet.error) request.reject(new Error(packet.error.message));
        else request.resolve(packet.result ?? {});
        return;
      }
      const params = packet.params ?? {};
      if (packet.method === 'Runtime.consoleAPICalled') {
        const message = (params.args as Array<{
          value?: unknown; description?: string; type?: string;
        }> ?? []).map(arg => arg.value === undefined ?
          (arg.description ?? arg.type ?? '') : String(arg.value)).join(' ');
        if (params.type === 'error' || webglError.test(message)) {
          this.record('console.' + String(params.type) + ': ' + message);
        }
      } else if (packet.method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails ?? {};
        this.record('uncaught exception: ' + String(details.text ?? '') + ' ' +
          String(details.exception?.description ?? '') + ' ' +
          JSON.stringify(details.stackTrace?.callFrames ?? []));
      } else if (packet.method === 'Log.entryAdded') {
        const entry = params.entry ?? {};
        const message = String(entry.text ?? '');
        if ((entry.source === 'rendering' && entry.level === 'error') ||
          webglError.test(message)) {
          this.record('WebGL/' + String(entry.source) + ': ' + message);
        }
      } else if (packet.method === 'Network.responseReceived') {
        const response = params.response ?? {};
        if (typeof response.status === 'number' && response.status >= 400) {
          this.record('HTTP ' + response.status + ': ' + String(response.url));
        }
      } else if (packet.method === 'Network.loadingFailed' && !params.canceled) {
        this.record('network failure: ' + String(params.errorText) +
          ' (' + String(params.requestId) + ')');
      }
    });
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) request.reject(new Error('DevTools disconnected'));
      this.pending.clear();
    });
  }

  private record(message: string): void {
    this.faults.push('[' + this.phase + '] ' + message);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const answer = await this.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) throw new Error('Page evaluation: ' +
      JSON.stringify(answer.exceptionDetails));
    return answer.result?.value as T;
  }

  async waitFor(expression: string, what: string, timeoutMs = 10000): Promise<void> {
    try {
      await until(async () => (await this.evaluate<boolean>(expression)) ? true : null,
        timeoutMs, what);
    } catch (error) {
      let state = 'unavailable';
      try {
        state = await this.evaluate<string>('JSON.stringify({' +
          'menu: document.querySelector(".gg-shell-panel")?.textContent?.slice(0, 200),' +
          'hidden: document.querySelector(".gg-shell")?.hidden,' +
          'locked: !!document.pointerLockElement, url: location.href})');
      } catch { /* A browser crash may also remove the execution context. */ }
      throw new Error('Waiting for ' + what + ' failed: ' + String(error) +
        ' (browser state ' + state + ')');
    }
  }

  async click(selector: string): Promise<void> {
    const point = await this.evaluate<{ x: number; y: number }>(
      '(() => { const el = document.querySelector(' + JSON.stringify(selector) + ');' +
      'if (!el || !el.getClientRects().length) throw new Error(' +
      JSON.stringify('Missing visible button: ' + selector) +
      '); const r = el.getBoundingClientRect();' +
      'return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()');
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent',
        { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
  }

  async key(code: string, type: 'keyDown' | 'keyUp'): Promise<void> {
    const keys: Record<string, [string, number]> = {
      KeyW: ['w', 87], KeyA: ['a', 65], KeyS: ['s', 83], KeyD: ['d', 68],
      KeyI: ['i', 73], KeyK: ['k', 75],
      KeyE: ['e', 69], KeyP: ['p', 80], Space: [' ', 32], Escape: ['Escape', 27],
    };
    const [key, virtualKey] = keys[code] ?? [code, 0];
    await this.send('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: virtualKey,
      nativeVirtualKeyCode: virtualKey,
    });
  }

  async tap(code: string): Promise<void> {
    await this.key(code, 'keyDown');
    await sleep(70);
    await this.key(code, 'keyUp');
  }

  async hold(code: string, milliseconds: number): Promise<void> {
    await this.key(code, 'keyDown');
    try { await sleep(milliseconds); } finally { await this.key(code, 'keyUp'); }
  }

  async scanWebgl(): Promise<void> {
    const errors = await this.evaluate<string[]>(
      '(() => (window.__browserSmokeContexts || []).flatMap((gl, i) => {' +
      'const errors = []; for (let n = 0; n < 16; n++) {' +
      'const code = gl.getError(); if (code === gl.NO_ERROR) break;' +
      'errors.push("context " + i + " error 0x" + code.toString(16));' +
      '} return errors; }))()');
    for (const error of errors) this.record('WebGL gl.getError(): ' + error);
  }
}

const initScript = [
  '(function () {',
  '  window.__browserSmokeFaults = [];',
  '  window.__browserSmokeContexts = [];',
  '  addEventListener("error", function (event) {',
  '    window.__browserSmokeFaults.push("window.error: " + event.message + " " + (event.error?.stack || ""));',
  '  });',
  '  addEventListener("unhandledrejection", function (event) {',
  '    window.__browserSmokeFaults.push("unhandledrejection: " + (event.reason?.stack || String(event.reason)));',
  '  });',
  '  const getContext = HTMLCanvasElement.prototype.getContext;',
  '  HTMLCanvasElement.prototype.getContext = function (kind) {',
  '    const context = getContext.apply(this, arguments);',
  '    if (["webgl", "webgl2", "experimental-webgl"].includes(kind) && context &&',
  '        !window.__browserSmokeContexts.includes(context)) {',
  '      window.__browserSmokeContexts.push(context);',
  '      this.addEventListener("webglcontextlost", () => window.__browserSmokeFaults.push("WebGL context lost"));',
  '    }',
  '    return context;',
  '  };',
  '})();',
].join('\n');

// CI calls this file in a separate step. Running another Chrome alongside the
// World Lab and HUD layout Chrome tests overwhelms the shared runner.
describe.skipIf(!process.env['BROWSER_SMOKE'])('production game Chrome runtime smoke', () => {
  it('builds, loads, plays, opens menus, and runs every party mode without browser errors', async () => {
    // Use the exact production Vite output, not Vite's forgiving development server.
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
      cwd: process.cwd(), stdio: 'pipe', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
    });
    const directory = mkdtempSync(join(tmpdir(), 'gigga-smoke-chrome-'));
    let browser: ChildProcess | undefined;
    let server: Server | undefined;
    let page: ChromePage | undefined;
    let failure: unknown;
    const faults: string[] = [];

    try {
      const served = await serveDist();
      server = served.server;
      const launched = await launchChromeDevTools('about:blank', directory, {
        timeoutMs: 40000,
        extraFlags: ['--force-device-scale-factor=1'],
        softwareWebgl: true,
      });
      browser = launched.browser;
      const port = launched.port;
      const target = await until(async () => {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        const tabs = await response.json() as Array<{
          type: string; webSocketDebuggerUrl?: string;
        }>;
        return tabs.find(tab => tab.type === 'page')?.webSocketDebuggerUrl ?? null;
      }, 15000, 'Chrome page target');
      const socket = new WebSocket(target);
      await new Promise<void>((done, fail) => {
        socket.addEventListener('open', () => done(), { once: true });
        socket.addEventListener('error', () => fail(new Error('DevTools WebSocket failed')),
          { once: true });
      });
      page = new ChromePage(socket);
      await Promise.all([
        page.send('Page.enable'), page.send('Runtime.enable'),
        page.send('Network.enable'), page.send('Log.enable'),
      ]);
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
      await page.send('Page.navigate', { url: served.url });
      await page.waitFor('!!document.querySelector(".gg-shell [data-action=play]")',
        'loaded PLAY · FREE ROAM menu', 90000);
      await sleep(500);

      page.phase = 'free roam / gig board';
      await page.click('[data-action="play"]');
      await page.waitFor('document.querySelector(".gg-shell")?.hidden === true',
        'free roam to start');
      page.phase = 'compact HUD geometry';
      const compactHudIssues = () => {
        const selectors = {
          meter: '.gg-meter', score: '.gg-combo', map: '.gg-map-panel',
          gig: '.gg-gig-card', stamina: '.gg-stamina',
          tray: '.gg-hotbar', look: '.gg-hint', board: '.gg-board-hint',
        };
        const look = document.querySelector<HTMLElement>(selectors.look)!;
        const board = document.querySelector<HTMLElement>(selectors.board)!;
        const name = document.querySelector<HTMLElement>('[data-place]')!;
        const original = { look: look.hidden, board: board.hidden, name: name.textContent };
        const inside = (a: DOMRect, b: DOMRect) => a.left >= b.left - 1 &&
          a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
        try {
          look.hidden = board.hidden = false;
          name.textContent = 'DOWNTOWN BLEATSVILLE';
          const boxes = Object.entries(selectors).map(([id, selector]) =>
            [id, document.querySelector(selector)!.getBoundingClientRect()] as const);
          const issues: string[] = [];
          const viewport = new DOMRect(0, 0, innerWidth, innerHeight);
          for (const [i, [id, rect]] of boxes.entries()) {
            if (!inside(rect, viewport) || rect.width <= 0 || rect.height <= 0) {
              issues.push(id + ' outside viewport');
            }
            for (const [other, b] of boxes.slice(i + 1)) {
              if (Math.min(rect.right, b.right) - Math.max(rect.left, b.left) > 1 &&
                  Math.min(rect.bottom, b.bottom) - Math.max(rect.top, b.top) > 1) {
                issues.push(id + ' overlaps ' + other);
              }
            }
          }
          const text = document.createRange();
          text.selectNodeContents(name);
          if (!inside(text.getBoundingClientRect(), name.parentElement!.getBoundingClientRect())) {
            issues.push('district name exceeds minimap plaque');
          }
          // The cream portion of the card illustration ends at 88% of its height.
          const card = document.querySelector(selectors.gig)!.getBoundingClientRect();
          text.selectNodeContents(document.querySelector('.gg-gig-footer')!);
          if (text.getBoundingClientRect().bottom > card.top + card.height * .88) {
            issues.push('gig footer touches frame art');
          }
          return issues;
        } finally {
          look.hidden = original.look;
          board.hidden = original.board;
          name.textContent = original.name;
        }
      };
      try {
        for (const [width, height] of [[1024, 576], [540, 360]] as const) {
          await page.send('Emulation.setDeviceMetricsOverride',
            { width, height, deviceScaleFactor: 1, mobile: false });
          await page.waitFor(`innerWidth === ${width} && innerHeight === ${height}`,
            `${width}×${height} viewport`);
          expect(await page.evaluate<string[]>('(' + compactHudIssues.toString() + ')()'),
            `${width}×${height}`).toEqual([]);
        }
      } finally {
        await page.send('Emulation.clearDeviceMetricsOverride');
      }
      page.phase = 'free roam / gig board';
      const readHudVisibility = '[".gg-hotbar",".gg-hint",".gg-meter",".gg-combo",".gg-map-panel",' +
        '".gg-gig-card",".gg-stamina"].map(s => getComputedStyle(document.querySelector(s)).visibility)';
      await page.evaluate('(() => {' +
        'const read = () => JSON.stringify(' + readHudVisibility + ');' +
        'const start = read(); window.__ggHudChanges = [];' +
        'const observer = new MutationObserver(() => {' +
        'const frame = read(); if (frame !== start) window.__ggHudChanges.push(frame); });' +
        'observer.observe(document.querySelector(".gg-ui"),' +
        '{attributes:true,subtree:true,attributeFilter:["style","hidden"]});' +
        'window.__ggHudDisconnect = () => observer.disconnect(); })()');
      await page.hold('KeyI', 600);
      await page.hold('KeyK', 1000);
      const hudChanges = await page.evaluate<string[]>('(() => {' +
        'window.__ggHudDisconnect(); return window.__ggHudChanges; })()');
      expect(hudChanges).toEqual([]);
      expect(await page.evaluate('getComputedStyle(document.querySelector(".gg-hotbar")).visibility'))
        .toBe('visible');
      // Spawn is close to Hoofington's board; E must open the real board UI.
      await page.tap('KeyE');
      await page.waitFor('document.querySelector(".gg-shell h2")?.textContent === "MAKE CUD COINS"',
        'gig board to open');
      await page.tap('Escape');
      await page.waitFor('document.querySelector(".gg-shell")?.hidden === true',
        'gig board to close');

      // Drive native Chrome input, not Game.advance() or direct game state mutations.
      await page.key('KeyW', 'keyDown');
      await sleep(650);
      await page.tap('Space');
      await sleep(750);
      await page.key('KeyW', 'keyUp');
      await page.hold('KeyD', 700);
      await page.hold('KeyS', 700);
      await page.hold('KeyA', 700);
      await page.send('Input.dispatchMouseEvent',
        { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
      await sleep(650);
      await page.send('Input.dispatchMouseEvent',
        { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
      await page.tap('Escape');
      await page.waitFor('document.querySelector(".gg-shell h2")?.textContent === "PAUSED"',
        'pause menu', 20000);
      await page.click('[data-action="resume"]');
      await page.waitFor('document.querySelector(".gg-shell")?.hidden === true',
        'resume from pause');

      const modes = [
        ['rising-tide', 'RISING TIDE'], ['king-of-the-peak', 'KING OF THE PEAK'],
        ['hay-heist', 'HAY HEIST'],
      ] as const;
      for (const [index, [mode, title]] of modes.entries()) {
        page.phase = 'party mode: ' + mode;
        if (index === 0) await page.tap('KeyP');
        else await page.click('[data-action="party"]');
        await page.waitFor('!!document.querySelector("#gg-mode")', 'party selector');
        const selected = await page.evaluate<string>('(() => {' +
          'const select = document.querySelector("#gg-mode");' +
          'select.value = ' + JSON.stringify(mode) + ';' +
          'select.dispatchEvent(new Event("change", { bubbles: true }));' +
          'return select.value; })()');
        expect(selected).toBe(mode);
        await page.click('[data-action="start-party"]');
        await page.waitFor('document.querySelector(".gg-shell")?.hidden === true',
          mode + ' round to start');
        await sleep(1700);
        await page.tap('Escape');
        await page.waitFor('document.querySelector(".gg-shell h2")?.textContent === "PAUSED"',
          mode + ' pause');
        const summary = await page.evaluate<string>(
          'document.querySelector(".gg-shell-panel")?.textContent || ""');
        expect(summary).toContain(title);
        await page.click('[data-action="title"]');
        await page.waitFor('!!document.querySelector(".gg-shell [data-action=play]")',
          'return to title from ' + mode);
      }

      // Allow any late asset fetches, async work and WebGL driver errors to surface.
      await sleep(700);
    } catch (error) {
      failure = error;
    } finally {
      if (page) {
        try { await page.scanWebgl(); } catch (error) {
          faults.push('WebGL inspection: ' + String(error));
        }
        try {
          const browserFaults = await page.evaluate<string[]>(
            'window.__browserSmokeFaults || []');
          faults.push(...browserFaults);
        } catch (error) {
          faults.push('Browser error inspection: ' + String(error));
        }
        const inspectedPage = page;
        faults.push(...inspectedPage.faults);
        page.socket.close();
      }
      browser?.kill();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>(done => server!.close(() => done()));
      }
      if (browser && browser.exitCode === null) {
        await Promise.race([
          new Promise<void>(done => browser!.once('exit', () => done())),
          sleep(2000),
        ]);
      }
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
      } catch (error) {
        console.warn('Chrome profile cleanup deferred:', error);
      }
    }

    // Print EVERY error rather than filtering expected 404s or suppressing console output.
    for (const fault of faults) console.error('BROWSER SMOKE: ' + fault);
    if (failure || faults.length) throw new Error(
      (failure ? 'Scenario failed: ' + String(failure) + '\n' : '') +
      (faults.length ? faults.length + ' browser runtime error(s):\n' +
        faults.join('\n') : ''));
  }, 420000);
});
