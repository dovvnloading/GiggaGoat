import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dumpChromeDom } from '../test-utils/chrome';
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
type Paint = {
  opacity: string; filter: string; transform: string;
  textShadow: string; color: string; fontFamily: string;
};
type Geometry = {
  styles: {
    card: Paint; detail: Paint; footer: Paint; wallet: Paint;
    balance: Paint; mode: Paint; coin: Paint;
    artworkFilter: string; coinFit: string;
  };
  boxes: Record<'card' | 'header' | 'paper' | 'title' | 'task' | 'detail' | 'footer' | 'wallet' | 'mode' | 'checkbox' | 'coin', Rect>;
  paperFits: boolean;
  taskFits: boolean;
  detailFits: boolean;
  footerFits: boolean;
  checkboxVisible: boolean;
  checkboxHiddenAttribute: boolean;
};

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
      checkbox: '.gg-gig-checkbox', coin: '.gg-coin'
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
    const paint = element => {
      const style = getComputedStyle(element);
      return { opacity: style.opacity, filter: style.filter, transform: style.transform,
        textShadow: style.textShadow, color: style.color, fontFamily: style.fontFamily };
    };
    const coin = card.querySelector('.gg-coin');
    const coinStyle = getComputedStyle(coin);
    const styles = {
      card: paint(card), detail: paint(detail), footer: paint(footer),
      wallet: paint(card.querySelector('.gg-gig-wallet')),
      balance: paint(card.querySelector('[data-wallet]')),
      mode: paint(card.querySelector('[data-mode]')), coin: paint(coin),
      artworkFilter: getComputedStyle(card, '::before').filter,
      coinFit: coinStyle.objectFit
    };
    const result = { boxes, styles,
      paperFits: paper.scrollHeight <= paper.clientHeight + 1,
      taskFits: task.scrollHeight <= task.clientHeight + 1,
      detailFits: detail.scrollHeight <= detail.clientHeight + 1,
      footerFits: footer.scrollWidth <= footer.clientWidth + 1 &&
        footer.scrollHeight <= footer.clientHeight + 1,
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
    const stdout = dumpChromeDom(pathToFileURL(file).href, {
      width, height, timeoutMs: 35000,
      expectedOutput: '<output id="geometry-result">',
    });
    const raw = stdout.match(/<output id="geometry-result">([^<]+)<\/output>/)?.[1];
    if (!raw) throw new Error('Chrome did not return geometry: ' + stdout.slice(-800));
    return JSON.parse(raw) as Geometry;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function inside(inner: Rect, outer: Rect, tolerance = 1): boolean {
  return inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
}

function artRegion(card: Rect, left: number, top: number, right: number, bottom: number): Rect {
  return {
    left: card.left + left * card.width, right: card.left + right * card.width,
    top: card.top + top * card.height, bottom: card.top + bottom * card.height,
    width: (right - left) * card.width, height: (bottom - top) * card.height,
  };
}

function expectWithinCream({ card, title, task, detail, footer, wallet, mode, coin }: Geometry['boxes']): void {
  // The 457×228 sprite bevel begins at row 194. The footer sits in the
  // wider part of the paper below the left checkbox and the ribbon shadow.
  const bodyCream = artRegion(card, .20, .47, .91, .76);
  const footerCream = artRegion(card, .12, .75, .90, 194 / 228);
  for (const [name, bounds] of Object.entries({ title, task, detail })) {
    expect(inside(bounds, bodyCream), name).toBe(true);
  }
  for (const [name, bounds] of Object.entries({ footer, wallet, mode, coin })) {
    expect(inside(bounds, footerCream), name).toBe(true);
  }
  expect(inside(wallet, footer), 'wallet inside footer').toBe(true);
  expect(inside(mode, footer), 'mode inside footer').toBe(true);
  expect(inside(coin, wallet), 'coin inside wallet').toBe(true);
}

afterEach(() => vi.unstubAllGlobals());

describe('live gig card text box geometry (headless browser DOM)', () => {
  it.each([[1280, 720], [1512, 797], [1920, 1080]])(
    'paints the footer crisp, opaque and dark at %ix%i', (width, height) => {
      const { styles, boxes } = measureHud(width, height, false, false);
      for (const text of [styles.footer, styles.wallet, styles.balance, styles.mode]) {
        expect(text.opacity).toBe('1');
        expect(text.filter).toBe('none');
        expect(text.transform).toBe('none');
        expect(text.textShadow).toBe('none');
        expect(text.color).toBe('rgb(78, 49, 43)');
        expect(text.fontFamily).toBe(styles.detail.fontFamily);
      }
      // The panel PNG still casts its shadow, but no filtered ancestor
      // can blur the footer text or downsample the original coin sprite.
      expect(styles.card.filter).toBe('none');
      expect(styles.card.transform).toBe('none');
      expect(styles.artworkFilter).toContain('drop-shadow(');
      expect(styles.coin.opacity).toBe('1');
      expect(styles.coin.filter).toBe('none');
      expect(styles.coin.transform).toBe('none');
      const size = Math.max(12, Math.min(16, width * .0086));
      expect(boxes.coin.width).toBeCloseTo(size, 1);
      expect(boxes.coin.height).toBeCloseTo(size, 1);
      expect(styles.coinFit).toBe('contain');
    }, 90_000,
  );
  it.each([[1280, 720], [1512, 797], [1920, 1080]])(
    'keeps YOUR NEXT GIG clear of the painted ribbon at %ix%i', (width, height) => {
      const g = measureHud(width, height, false, false);
      const { card, paper, title, task, detail, footer } = g.boxes;
      // The PNG ribbon extends to about 43% of the card, beyond the shorter
      // .gg-gig-header text box. Compare against the actual artwork boundary,
      // rather than only header.bottom (which let the original clipping pass).
      const ribbonBottom = card.top + card.height * .43;
      expect(title.top - ribbonBottom).toBeGreaterThanOrEqual(6);
      expect(inside(title, paper)).toBe(true);
      expect(task.top).toBeGreaterThanOrEqual(title.bottom - 1);
      expect(detail.top).toBeGreaterThanOrEqual(task.bottom - 1);
      expect(footer.top).toBeGreaterThanOrEqual(detail.bottom + 1);
      expect(g.paperFits && g.taskFits && g.detailFits && g.footerFits).toBe(true);
    },
    90_000,
  );

  it.each([[1280, 720], [1512, 797], [1600, 900], [1920, 1080]])(
    'keeps the idle free-roam card within the cream area at %ix%i', (width, height) => {
      const g = measureHud(width, height, false, false);
      const { card, header, title, task, detail, footer, wallet, mode } = g.boxes;
      expectWithinCream(g.boxes);
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
    90_000,
  );

  it.each([[1280, 720], [1512, 797], [1600, 900], [1920, 1080]])(
    'wraps a long active objective beside its checkbox at %ix%i', (width, height) => {
      const g = measureHud(width, height, true, true);
      const { card, header, title, task, detail, footer, wallet, mode, checkbox } = g.boxes;
      expectWithinCream(g.boxes);
      expect(inside(checkbox, card)).toBe(true);
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
    90_000,
  );
});
