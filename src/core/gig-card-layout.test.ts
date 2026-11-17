import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameHud } from './GameHud';
import { fitGigCardText } from './GigCardLayout';

/** Constructor-only DOM stub; Chromium does all real CSS layout measurements. */
class ElementStub {
  className = '';
  textContent = '';
  readonly children: ElementStub[] = [];
  private html = '';
  private nodes: ElementStub[] = [];
  private data = new Set<string>();

  set innerHTML(html: string) {
    this.html = html;
    this.nodes = Array.from(html.matchAll(/<([a-z][\w-]*)\b([^>]*)>([^<]*)/gi), match => {
      const attrs = match[2] ?? '';
      const element = new ElementStub();
      element.className = attrs.match(/(?:^|\s)class="([^"]*)"/)?.[1] ?? '';
      element.textContent = match[3] ?? '';
      for (const attr of attrs.matchAll(/\b(data-[\w-]+)(?:="[^"]*")?/g)) {
        element.data.add(attr[1]!);
      }
      return element;
    });
  }
  get innerHTML(): string { return this.html; }
  appendChild(child: ElementStub): ElementStub { this.children.push(child); return child; }
  remove(): void {}
  setAttribute(_key: string, _value: string): void {}
  querySelector<T = ElementStub>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }
  querySelectorAll<T = ElementStub>(selector: string): T[] {
    if (selector.startsWith('.')) return this.nodes.filter(node =>
      node.className.split(/\s+/).includes(selector.slice(1))) as T[];
    if (selector.startsWith('[data-') && selector.endsWith(']')) return this.nodes.filter(node =>
      node.data.has(selector.slice(1, -1))) as T[];
    throw new Error('Unsupported selector: ' + selector);
  }
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Geometry = {
  boxes: Record<string, Rect>;
  paperFits: boolean;
  taskFits: boolean;
  detailFits: boolean;
  footerFits: boolean;
  checkboxVisible: boolean;
  checkboxHiddenAttribute: boolean;
};

function chromeBinary(): string {
  for (const name of [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable',
    'chromium', 'chromium-browser'].filter((name): name is string => !!name)) {
    if (spawnSync(name, ['--version'], { encoding: 'utf8', timeout: 3000 }).status === 0) return name;
  }
  throw new Error('A headless Chrome/Chromium binary is required for gig card DOM geometry tests');
}

function measureHud(width: number, height: number, active: boolean, longCopy: boolean): Geometry {
  const head = new ElementStub();
  vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
  const host = new ElementStub();
  const hud = new GameHud(host as unknown as HTMLElement);
  const css = head.children[0]!.textContent;
  const markup = host.children[0]!.innerHTML;
  hud.dispose();
  vi.unstubAllGlobals();

  const task = longCopy ?
    'Carry the heavy crate through the winding summit checkpoints without letting the tower tumble over the edge' :
    'Find a yellow E · GIGS board to choose a challenge!';
  const detail = active ?
    '2 / 5 CHECKPOINTS · 47s LEFT · GOLD PACE*' :
    'EXPLORE THE ISLAND · PRESS E AT A BOARD';
  const data = JSON.stringify({ task, detail, active, title: active ? 'SUMMIT DELIVERY' : 'YOUR NEXT GIG' });
  const js = `
    const fixture = ${data};
    const card = document.querySelector('.gg-gig-card');
    const checkbox = card.querySelector('[data-gig-checkbox]');
    card.querySelector('[data-gig-title]').textContent = fixture.title;
    card.querySelector('[data-gig-task]').textContent = fixture.task;
    card.querySelector('[data-gig-detail]').textContent = fixture.detail;
    checkbox.hidden = !fixture.active;
    (${fitGigCardText.toString()})(card);
    const names = {
      card: '.gg-gig-card', header: '.gg-gig-header', paper: '.gg-gig-paper',
      title: '.gg-gig-title', task: '.gg-gig-task', detail: '.gg-gig-detail',
      footer: '.gg-gig-footer', wallet: '.gg-gig-wallet', mode: '[data-mode]',
      checkbox: '.gg-gig-checkbox'
    };
    const boxes = Object.fromEntries(Object.entries(names).map(([name, selector]) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return [name, { left:r.left, top:r.top, right:r.right, bottom:r.bottom,
        width:r.width, height:r.height }];
    }));
    const paper = card.querySelector('.gg-gig-paper');
    const task = card.querySelector('.gg-gig-task');
    const detail = card.querySelector('.gg-gig-detail');
    const footer = card.querySelector('.gg-gig-footer');
    const result = { boxes,
      paperFits: paper.scrollHeight <= paper.clientHeight + 1,
      taskFits: task.scrollHeight <= task.clientHeight + 1,
      detailFits: detail.scrollHeight <= detail.clientHeight + 1,
      footerFits: footer.scrollWidth <= footer.clientWidth + 1,
      checkboxVisible: getComputedStyle(checkbox).display !== 'none',
      checkboxHiddenAttribute: checkbox.hidden
    };
    document.getElementById('geometry-result').textContent = JSON.stringify(result);
  `;
  // Tests measure the actual generated DOM and styles, not a duplicate card fixture.
  // Sprite URLs are omitted: only the paint changes, never the geometric boxes.
  const html = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0}' +
    css.replace(/url\("[^"]*"\)/g, 'none') + '</style>' +
    '<div class="gg-ui" style="position:relative;width:' + width + 'px;height:' + height + 'px">' +
    markup.replace(/src="[^"]*"/g, 'src=""') + '</div>' +
    '<output id="geometry-result"></output><script>' + js + '</script>';
  const dir = mkdtempSync(join(tmpdir(), 'gig-card-dom-'));
  try {
    const file = join(dir, 'fixture.html');
    writeFileSync(file, html);
    const proc = spawnSync(chromeBinary(), ['--headless', '--no-sandbox',
      '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking',
      '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 15000 });
    if (proc.status !== 0) throw new Error('Chrome layout failed: ' + proc.stderr);
    const raw = proc.stdout.match(/<output id="geometry-result">([^<]+)<\/output>/)?.[1];
    if (!raw) throw new Error('Chrome did not return geometry: ' + proc.stdout.slice(-800));
    return JSON.parse(raw) as Geometry;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function inside(inner: Rect, outer: Rect, tolerance = 1): boolean {
  return inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
}

afterEach(() => vi.unstubAllGlobals());

describe('live gig card text box geometry (headless browser DOM)', () => {
  it.each([[1280, 720], [1600, 900], [1920, 1080]])(
    'keeps the idle free-roam card within the cream area at %ix%i', (width, height) => {
      const g = measureHud(width, height, false, false);
      const { card, header, title, task, detail, footer, wallet, mode } = g.boxes;
      const cream: Rect = { ...card, left: card.left + .19 * card.width,
        top: card.top + .40 * card.height, right: card.left + .91 * card.width,
        bottom: card.top + .92 * card.height };
      for (const rect of [title, task, detail, wallet, mode]) {
        expect(inside(rect, cream)).toBe(true);
      }
      expect(title.top).toBeGreaterThanOrEqual(card.top + .4 * card.height);
      expect(title.top).toBeGreaterThan(header.bottom);
      expect(task.top).toBeGreaterThanOrEqual(title.bottom - 1);
      expect(detail.top).toBeGreaterThanOrEqual(task.bottom - 1);
      expect(footer.top).toBeGreaterThanOrEqual(detail.bottom + 1);
      expect(wallet.right + 4).toBeLessThanOrEqual(mode.left + 1);
      expect(g.paperFits && g.taskFits && g.detailFits && g.footerFits).toBe(true);
      expect(g.checkboxVisible).toBe(false);
      expect(g.checkboxHiddenAttribute).toBe(true);
    },
  );

  it.each([[1280, 720], [1600, 900], [1920, 1080]])(
    'wraps a long active objective beside its checkbox at %ix%i', (width, height) => {
      const g = measureHud(width, height, true, true);
      const { card, header, title, task, detail, footer, wallet, mode, checkbox } = g.boxes;
      for (const rect of [title, task, detail, footer, wallet, mode, checkbox]) {
        expect(inside(rect, card)).toBe(true);
      }
      expect(title.top).toBeGreaterThan(header.bottom);
      expect(task.top).toBeGreaterThanOrEqual(title.bottom - 1);
      expect(detail.top).toBeGreaterThanOrEqual(task.bottom - 1);
      expect(footer.top).toBeGreaterThanOrEqual(detail.bottom + 1);
      expect(checkbox.right + 3).toBeLessThanOrEqual(task.left);
      expect(wallet.right + 4).toBeLessThanOrEqual(mode.left + 1);
      expect(g.paperFits && g.taskFits && g.detailFits && g.footerFits).toBe(true);
      expect(g.checkboxVisible).toBe(true);
      expect(g.checkboxHiddenAttribute).toBe(false);
    },
  );
});
