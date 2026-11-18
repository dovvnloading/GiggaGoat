import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameHud } from './GameHud';

/**
 * Vitest runs in Node without a browser DOM. This small DOM stub indexes the
 * elements in GameHud's real innerHTML so the test exercises its constructor,
 * not a separately maintained copy of the markup.
 */
class ElementStub {
  className = '';
  textContent = '';
  hidden = false;
  readonly children: ElementStub[] = [];
  private readonly dataAttributes = new Set<string>();
  private nodes: ElementStub[] = [];
  private html = '';

  set innerHTML(html: string) {
    this.html = html;
    this.nodes = Array.from(html.matchAll(/<([a-z][\w-]*)\b([^>]*)>([^<]*)/gi), match => {
      const attrs = match[2] ?? '';
      const node = new ElementStub();
      node.className = attrs.match(/(?:^|\s)class="([^"]*)"/)?.[1] ?? '';
      node.textContent = match[3] ?? '';
      for (const attr of attrs.matchAll(/\b(data-[\w-]+)(?:="[^"]*")?/g)) {
        node.dataAttributes.add(attr[1]!);
      }
      return node;
    });
  }

  get innerHTML(): string { return this.html; }
  appendChild(child: ElementStub): ElementStub { this.children.push(child); return child; }
  remove(): void { /* detached test node */ }
  setAttribute(_name: string, _value: string): void {}

  querySelector<T = ElementStub>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }

  querySelectorAll<T = ElementStub>(selector: string): T[] {
    if (selector === '*') return this.nodes as T[];
    if (selector.startsWith('.')) {
      return this.nodes.filter(node => node.className.split(/\s+/).includes(selector.slice(1))) as T[];
    }
    if (selector.startsWith('[data-') && selector.endsWith(']')) {
      const name = selector.slice(1, -1);
      return this.nodes.filter(node => node.dataAttributes.has(name)) as T[];
    }
    throw new Error('Unsupported HUD test selector: ' + selector);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('live free-roam HUD DOM', () => {
  it('renders one STYLE SCORE label, without a second copy from a panel-wide shadow', () => {
    const head = new ElementStub();
    vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
    const host = new ElementStub();
    const hud = new GameHud(host as unknown as HTMLElement);
    try {
      const root = host.children[0]!;
      const labels = root.querySelectorAll<ElementStub>('*')
        .filter(node => node.textContent.includes('STYLE SCORE'));
      expect(labels).toHaveLength(1);
      expect(root.querySelectorAll<ElementStub>('.gg-score-caption')).toEqual(labels);
      expect(labels[0]?.textContent).toBe('STYLE SCORE');

      const css = head.children[0]!.textContent;
      const dropShadowSelectors = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(match => /\bfilter\s*:\s*drop-shadow\(/.test(match[2] ?? ''))
        .flatMap(match => (match[1] ?? '').split(',').map(selector => selector.trim()));
      // Filtering the whole combo re-paints its caption 7px lower, like a second label.
      expect(dropShadowSelectors).not.toContain('.gg-combo');

      // The starburst PNG already contains the score ribbon and gold chevrons:
      // do not repaint CSS duplicates over the art.
      expect(root.querySelector('.gg-score-ribbon')).not.toBeNull();
      expect(root.querySelector<ElementStub>('[data-score]')?.textContent).toBe('0');
      expect(root.querySelector<ElementStub>('[data-combo-count]')?.textContent)
        .toBe('START A COMBO!');
      expect(css).toContain('background:var(--gg-scoreStarburst)');
      expect(css).not.toContain('.gg-score-ribbon:before');
    } finally {
      hud.dispose();
    }
  });

  it.each([1280, 1600, 1920])('keeps both sprite prompts on a single row at %ipx', width => {
    const head = new ElementStub();
    vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
    const host = new ElementStub();
    const hud = new GameHud(host as unknown as HTMLElement);
    try {
      const root = host.children[0]!;
      const css = head.children[0]!.textContent;
      const rowRule = css.match(/\.gg-board-hint,\.gg-hint\{([^}]*)\}/)?.[1] ?? '';
      const copyRule = css.match(/\.gg-prompt-copy\{([^}]*)\}/)?.[1] ?? '';
      expect(rowRule).toContain('display:flex');
      expect(rowRule).toContain('flex-wrap:nowrap');
      expect(rowRule).toContain('width:max-content');
      expect(rowRule).toContain('max-width:82vw');
      expect(copyRule).toContain('white-space:nowrap');
      expect(root.querySelector('.gg-prompts')).not.toBeNull();
      expect(css.match(/\.gg-prompts\{([^}]*)\}/)?.[1]).toContain('flex-direction:column');

      for (const [name, message] of [
        ['gg-board-hint', 'GOAT GIGS · GAMEPAD X'],
        ['gg-hint', 'MOUSE / IJKL LOOK · C CAPTURE MOUSE'],
      ] as const) {
        expect(root.querySelector('.' + name)).not.toBeNull();
        // Read the exact constructor markup, rather than a second HTML fixture.
        const start = root.innerHTML.indexOf('<div class="' + name + '"');
        expect(start).toBeGreaterThan(-1);
        const markup = root.innerHTML.slice(start, root.innerHTML.indexOf('</div>', start) + 6);
        expect(markup).toContain(message);
        // One outer prompt_pill and one inner key_badge; never a nested pill.
        expect(markup.match(/data-sprite="hud\/prompt_pill"/g)).toHaveLength(1);
        expect(markup.match(/data-sprite="hud\/key_badge"/g)).toHaveLength(1);

        // Every glyph is budgeted a generous full 14px em (the CSS font cap),
        // plus the badge, borders, padding and gap. Even that upper bound fits.
        const maximumRowWidth = [...message].length * 14 + 50 + 26 + 22 + 6;
        expect(maximumRowWidth).toBeLessThan(width * .82);
      }
      expect(root.querySelector<ElementStub>('[data-hint-copy]')?.textContent)
        .toBe('MOUSE / IJKL LOOK · C CAPTURE MOUSE');
      expect(root.innerHTML).toContain('gg-prompt-mouse');
      expect(root.innerHTML).not.toContain('>CLICK</span>');
    } finally {
      hud.dispose();
    }
  });

  it('hides the click prompt on pointer lock and restores the flex row on unlock', () => {
    const head = new ElementStub();
    vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
    const host = new ElementStub();
    const hud = new GameHud(host as unknown as HTMLElement);
    try {
      const hint = host.children[0]!.querySelector<ElementStub>('[data-hint]')!;
      expect(hint.hidden).toBe(false);
      hud.setPointerLockHint(true);
      expect(hint.hidden).toBe(true);
      hud.setPointerLockHint(false);
      expect(hint.hidden).toBe(false);
      expect(head.children[0]!.textContent).toContain('.gg-ui [hidden]{display:none!important}');
    } finally {
      hud.dispose();
    }
  });
});
