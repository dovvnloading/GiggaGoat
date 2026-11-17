import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

let cachedBinary: string | undefined;

/** Resolve Chromium once per test worker; CHROME_PATH takes precedence. */
export function chromeBinary(): string {
  if (cachedBinary) return cachedBinary;
  const candidates = [
    process.env['CHROME_PATH'], process.env['CHROME_BIN'],
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', 'google-chrome',
    'google-chrome-stable', 'chromium', 'chromium-browser',
  ];
  const tried = new Set<string>();
  const failures: string[] = [];
  for (const binary of candidates) {
    if (!binary || tried.has(binary)) continue;
    tried.add(binary);
    const check = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (check.status === 0) return (cachedBinary = binary);
    failures.push(`${binary}: ${check.error?.message ?? `exit ${check.status ?? check.signal}`}`);
  }
  throw new Error('Headless Chrome/Chromium is required for browser tests. ' +
    'Set CHROME_PATH to an executable Chrome binary. Tried: ' + failures.join('; '));
}

interface ChromeOptions {
  width?: number;
  height?: number;
  extraFlags?: readonly string[];
  /** Keep the software WebGL GPU process enabled for renderer-based tests. */
  softwareWebgl?: boolean;
}

const STABLE_FLAGS = [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--enable-webgl', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader',
];

function chromeFlags(options: ChromeOptions): string[] {
  return [
    ...STABLE_FLAGS,
    // Chrome's --disable-gpu is safe for DOM layout, but breaks WebGL startup/asset loads.
    ...(options.softwareWebgl ? [] : ['--disable-gpu', '--disable-background-networking']),
    `--window-size=${options.width ?? 1280},${options.height ?? 720}`,
    ...(options.extraFlags ?? []),
  ];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Execute a DOM geometry fixture; retry one empty/crashed Chrome launch. */
export function dumpChromeDom(
  url: string,
  options: ChromeOptions & { timeoutMs?: number; expectedOutput?: string } = {},
): string {
  const binary = chromeBinary();
  const failures: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = spawnSync(binary, [...chromeFlags(options), '--dump-dom', url], {
      encoding: 'utf8', timeout: options.timeoutMs ?? 35000, maxBuffer: 12 * 1024 * 1024,
    });
    const stdout = result.stdout ?? '';
    if (result.status === 0 && stdout.trim() &&
      (!options.expectedOutput || stdout.includes(options.expectedOutput))) return stdout;
    const reason = `attempt ${attempt}: exit=${result.status}, signal=${result.signal}, ` +
      `error=${result.error?.message ?? 'none'}, ` +
      `stderr=${(result.stderr ?? '').slice(-800)}, stdout=${stdout.slice(-800)}`;
    failures.push(reason);
    if (attempt === 1) console.warn('Chrome DOM launch failed; retrying once: ' + reason);
  }
  throw new Error(`Chrome did not return expected DOM after two attempts (${binary}):\n` +
    failures.join('\n'));
}

/** Start an isolated DevTools Chrome, retrying once if its port never appears. */
export async function launchChromeDevTools(
  url: string,
  profileRoot: string,
  options: ChromeOptions & { timeoutMs?: number } = {},
): Promise<{ browser: ChildProcess; port: number }> {
  const binary = chromeBinary();
  const failures: string[] = [];
  const timeoutMs = options.timeoutMs ?? 40000;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const profileDir = join(profileRoot, `attempt-${attempt}`);
    mkdirSync(profileDir, { recursive: true });
    const browser = spawn(binary, [
      ...chromeFlags(options), '--remote-debugging-port=0',
      '--user-data-dir=' + profileDir, url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let startError: Error | undefined;
    let stderr = '';
    browser.on('error', error => { startError = error; });
    browser.stderr?.on('data', (data: Buffer | string) => {
      stderr = (stderr + String(data)).slice(-1600);
    });

    try {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (startError) throw startError;
        if (browser.exitCode !== null || browser.signalCode !== null) {
          throw new Error(`Chrome exited (code ${browser.exitCode}, signal ${browser.signalCode})`);
        }
        const portFile = join(profileDir, 'DevToolsActivePort');
        if (existsSync(portFile)) {
          const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
          if (Number.isInteger(port) && port > 0) return { browser, port };
        }
        await sleep(150);
      }
      throw new Error(`DevToolsActivePort not created within ${timeoutMs}ms`);
    } catch (error) {
      const reason = `attempt ${attempt}: ${errorText(error)}; stderr=${stderr}`;
      failures.push(reason);
      browser.kill();
      if (browser.exitCode === null && browser.signalCode === null) {
        await Promise.race([
          new Promise<void>(resolve => browser.once('exit', () => resolve())),
          sleep(2000),
        ]);
      }
      try {
        rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch { /* The caller removes the entire profile root on teardown. */ }
      if (attempt === 1) console.warn('Chrome DevTools launch failed; retrying once: ' + reason);
    }
  }
  throw new Error(`Chrome DevTools did not start after two attempts (${binary}):\n` +
    failures.join('\n'));
}
