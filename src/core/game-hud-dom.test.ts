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
});
