import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { GameHud } from './GameHud';
import { HUD_SPRITES, hudSpriteUrl } from './HudSprites';

interface SpriteEntry { file: string; w: number; h: number }
const manifest = JSON.parse(readFileSync(
  new URL('../../public/assets/ui/sprites/sprites.json', import.meta.url), 'utf8'
)) as Record<string, SpriteEntry>;

/** Parse the actual constructor markup without a browser-specific test runner. */
class ElementStub {
  className = '';
  textContent = '';
  readonly children: ElementStub[] = [];
  private html = '';
  private nodes: ElementStub[] = [];
  private readonly attrs = new Set<string>();

  set innerHTML(html: string) {
    this.html = html;
    this.nodes = Array.from(html.matchAll(/<([a-z][\w-]*)\b([^>]*)>([^<]*)/gi), match => {
      const node = new ElementStub(), attributes = match[2] ?? '';
      node.className = attributes.match(/(?:^|\s)class="([^"]*)"/)?.[1] ?? '';
      node.textContent = match[3] ?? '';
      for (const attr of attributes.matchAll(/\b(data-[\w-]+)(?:="[^"]*")?/g)) {
        node.attrs.add(attr[1]!);
      }
      return node;
    });
  }
  get innerHTML(): string { return this.html; }
  appendChild(node: ElementStub): void { this.children.push(node); }
  remove(): void {}
  setAttribute(_name: string, _value: string): void {}
  querySelector<T = ElementStub>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }
  querySelectorAll<T = ElementStub>(selector: string): T[] {
    if (selector.startsWith('.')) return this.nodes.filter(
      node => node.className.split(/\s+/).includes(selector.slice(1))) as T[];
    if (selector.startsWith('[data-') && selector.endsWith(']')) {
      return this.nodes.filter(node => node.attrs.has(selector.slice(1, -1))) as T[];
    }
    throw new Error('Unsupported HUD selector: ' + selector);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('free-roam HUD sprite atlas', () => {
  it('resolves every registered HUD frame and icon to a real pre-sliced PNG in sprites.json', () => {
    const names = Object.values(HUD_SPRITES);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      const sprite = manifest[name];
      expect(sprite, name + ' is absent from sprites.json').toBeDefined();
      expect(sprite!.file).toBe('assets/ui/sprites/' + name + '.png');
      expect(sprite!.w, name).toBeGreaterThan(0);
      expect(sprite!.h, name).toBeGreaterThan(0);
      expect(existsSync(new URL('../../public/' + sprite!.file, import.meta.url)),
        name + ' PNG is missing').toBe(true);
      expect(hudSpriteUrl(name)).toMatch(new RegExp(
        '/assets/ui/sprites/' + name + '\\.png$'
      ));
    }
  });

  it('checks every sprite used by the actual HUD DOM and CSS against sprites.json', () => {
    const head = new ElementStub();
    vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
    const host = new ElementStub();
    const hud = new GameHud(host as unknown as HTMLElement);
    try {
      const html = host.children[0]!.innerHTML;
      const css = head.children[0]!.textContent;
      const dataNames = [...html.matchAll(/data-sprite(?:-selected)?="([^"]+)"/g)]
        .map(match => match[1]!);
      const cssNames = [...css.matchAll(/assets\/ui\/sprites\/([\w/-]+)\.png/g)]
        .map(match => match[1]!);
      expect(dataNames.length).toBeGreaterThanOrEqual(20);
      expect(cssNames.length).toBe(Object.keys(HUD_SPRITES).length);
      for (const name of [...dataNames, ...cssNames]) {
        expect(manifest[name], 'unregistered HUD element sprite ' + name).toBeDefined();
      }
      for (const name of ['goat_kid', 'goat_billy', 'goat_big', 'goat_gigga',
        'hay_floor', 'fence_wall', 'hay_ramp', 'launch_pad']) {
        expect(html).toContain('data-sprite="icons/' + name + '"');
      }
      for (const stock of ['hay', 'wood', 'scrap']) expect(html).toContain('data-supply-' + stock);
      // Stretchable controls are real nine-slice images, never CSS-painted frames.
      expect(css).toContain('border-image:var(--gg-hotbarSlot)');
      expect(css).toContain('border-image:var(--gg-promptPill)');
      expect(css).toContain('border-image:var(--gg-keyBadge)');
      expect(css).toContain('background:var(--gg-scoreStarburst)');
    } finally {
      hud.dispose();
    }
  });
});
