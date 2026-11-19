import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameHud } from './GameHud';
import type { Game } from './Game';
import type { Vec3 } from '../world';
import { fitGigCardText } from './GigCardLayout';

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
  readonly dataset: Record<string, string> = {};
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
  it('clears previous desktop font overrides and lets the portrait gig card grow', () => {
    const removeProperty = vi.fn();
    const label = { style: { removeProperty } };
    const paper = { clientHeight: 72 };
    const computedStyle = vi.fn(() => ({ position: 'static' }));
    vi.stubGlobal('getComputedStyle', computedStyle);
    const card = { querySelector: (selector: string) => selector === '.gg-gig-paper' ? paper : label };
    fitGigCardText(card as unknown as HTMLElement);
    expect(removeProperty).toHaveBeenCalledTimes(4);
    expect(removeProperty).toHaveBeenCalledWith('font-size');
    expect(computedStyle).toHaveBeenCalledExactlyOnceWith(paper);
  });

  it('reuses one climb flag for active Rising Tide and preserves the Free Roam contract target', () => {
    const flag = { setAttribute: vi.fn() };
    const origin = { x: 0, z: 0 };
    const hud = Object.assign(Object.create(GameHud.prototype) as {
      updateMap(game: Game, location: string, hayHaul: null, tideTarget?: Vec3): void;
    }, {
      mapOrigin: origin, mapZone: 'open-island',
      mapObjectives: { querySelector: vi.fn(() => flag) },
      updateHayHaulMap: vi.fn(),
    });
    const match = { mode: 'rising-tide', phase: 'playing' };
    const party = { match: match as typeof match | null };
    const game = {
      island: { pois: [] },
      goat: { torso: { translation: () => origin }, locomotion: { heading: 0 } },
      gigs: { active: { status: 'running', objective: { kind: 'summit', next: { x: 0, y: 1, z: 10 } } } },
      party,
    } as unknown as Game;
    const tideTarget = { x: 10, y: 8, z: 0 };
    const update = (): void => hud.updateMap(game, 'BILLY ISLE', null, tideTarget);

    update();
    expect(flag.setAttribute).toHaveBeenNthCalledWith(1, 'visibility', 'visible');
    expect(flag.setAttribute).toHaveBeenNthCalledWith(2, 'transform', 'translate(150.5 140.0)');

    match.phase = 'results';
    update();
    expect(flag.setAttribute).toHaveBeenLastCalledWith('visibility', 'hidden');

    match.mode = 'hay-heist';
    match.phase = 'playing';
    update();
    expect(flag.setAttribute).toHaveBeenLastCalledWith('visibility', 'hidden');

    party.match = null;
    update();
    expect(flag.setAttribute).toHaveBeenNthCalledWith(5, 'visibility', 'visible');
    expect(flag.setAttribute).toHaveBeenNthCalledWith(6, 'transform', 'translate(140.0 150.5)');
  });

  it('reserves the numbered shortcuts for build pieces and separates the Supplies totals', () => {
    const head = new ElementStub();
    vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
    const host = new ElementStub();
    const hud = new GameHud(host as unknown as HTMLElement);
    try {
      const root = host.children[0]!;
      expect(root.querySelectorAll<ElementStub>('.gg-slot-key').map(node => node.textContent))
        .toEqual(['1', '2', '3', '4']);
      expect(root.querySelectorAll('.gg-slot')).toHaveLength(4);
      expect(root.querySelector<ElementStub>('.gg-supply')?.className).toBe('gg-supply');
      for (const material of ['hay', 'wood', 'scrap']) {
        expect(root.querySelector('[data-supply-' + material + ']')).not.toBeNull();
      }
      const css = head.children[0]!.textContent;
      expect(css).toMatch(/\.gg-hotbar\[data-active="true"\]::after\{[^}]*clip-path:polygon/);
    } finally {
      hud.dispose();
    }
  });
  it('shows compact idle build entry and controls with a visible placement reason in build mode', () => {
    const head = new ElementStub();
    vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
    const host = new ElementStub();
    const hud = new GameHud(host as unknown as HTMLElement);
    try {
      const root = host.children[0]!;
      const controls = root.querySelector<ElementStub>('[data-build-status]')!;
      const placement = root.querySelector<ElementStub>('[data-build-placement]')!;
      const hotbar = root.querySelector<ElementStub>('[data-hotbar]')!;
      expect(controls.textContent).toBe('B · BUILD');

      hud.setBuildPreview({ valid: false, reason: 'no-support' }, 'keyboard-mouse');
      expect(hotbar.dataset.active).toBe('true');
      expect(controls.textContent).toBe('1–4 SELECT · LMB PLACE · B EXIT');
      expect(placement.hidden).toBe(false);
      expect(placement.textContent).toBe('NEEDS SUPPORT');
      expect(placement.dataset.ready).toBe('false');

      hud.setBuildPreview({ valid: true, snapped: {
        type: 'floor', cell: { x: 0, y: 0, z: 0 }, rotation: 0,
      } }, 'gamepad');
      expect(controls.textContent).toBe('D-PAD SELECT · RT PLACE · Y EXIT');
      expect(placement.textContent).toBe('READY');
      expect(placement.dataset.ready).toBe('true');
      expect(root.querySelectorAll<ElementStub>('[data-build-key]').map(node => node.textContent))
        .toEqual(['↑', '→', '↓', '←']);

      hud.setBuildPreview(null, 'gamepad');
      expect(hotbar.dataset.active).toBe('false');
      expect(controls.textContent).toBe('Y · BUILD');
      expect(placement.hidden).toBe(true);
      hud.setBuildPreview(null, 'keyboard-mouse');
      expect(controls.textContent).toBe('B · BUILD');
      expect(root.querySelectorAll<ElementStub>('[data-build-key]').map(node => node.textContent))
        .toEqual(['1', '2', '3', '4']);
    } finally {
      hud.dispose();
    }
  });
  it('starts with one quiet style score and reserves the starburst for active combos', () => {
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
      expect(root.querySelector<ElementStub>('[data-combo-count]')?.textContent).toBe('');
      expect(root.querySelector<ElementStub>('[data-combo-title]')?.textContent).toBe('');
      expect(css.match(/\.gg-combo\{([^}]*)\}/)?.[1]).not.toContain('background:');
      expect(css).toContain('.gg-combo[data-combo-active]{background:var(--gg-scoreStarburst)');
      expect(css).toContain('.gg-combo:not([data-combo-active]) > .gg-current-score');
      expect(css).not.toContain('.gg-score-ribbon:before');
    } finally {
      hud.dispose();
    }
  });

  it('uses one readable value for each gameplay meter', () => {
    const head = new ElementStub();
    vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
    const host = new ElementStub();
    const hud = new GameHud(host as unknown as HTMLElement);
    try {
      const root = host.children[0]!;
      expect(root.querySelectorAll('[data-meter]')).toHaveLength(1);
      expect(root.querySelector<ElementStub>('[data-meter]')?.textContent).toBe('0 / 100');
      expect(root.querySelector<ElementStub>('[data-stamina-label]')?.textContent).toBe('STAMINA');
      expect(root.querySelectorAll('[data-stamina-number]')).toHaveLength(1);
      expect(root.querySelector<ElementStub>('[data-stamina-number]')?.textContent).toBe('100 / 100');
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
        ['gg-board-hint', 'GOAT GIGS'],
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

  it('shows the active device and gives the board prompt priority for either input', () => {
    const head = new ElementStub();
    vi.stubGlobal('document', { head, createElement: () => new ElementStub() });
    const host = new ElementStub();
    const hud = new GameHud(host as unknown as HTMLElement);
    try {
      const root = host.children[0]!;
      const hint = root.querySelector<ElementStub>('[data-hint]')!;
      const copy = root.querySelector<ElementStub>('[data-hint-copy]')!;
      const boardKey = root.querySelector<ElementStub>('[data-board-key]')!;
      expect(hint.hidden).toBe(false);
      hud.setPointerLockHint(true);
      expect(hint.hidden).toBe(true);
      hud.setPointerLockHint(false, true);
      expect(hint.hidden).toBe(true);
      expect(boardKey.textContent).toBe('E');
      hud.setPointerLockHint(false, true, 'gamepad');
      expect(hint.hidden).toBe(true);
      expect(boardKey.textContent).toBe('X');
      hud.setPointerLockHint(true, false, 'gamepad');
      expect(hint.hidden).toBe(false);
      expect(copy.textContent).toBe('RIGHT STICK TO LOOK');
      expect(root.querySelector<ElementStub>('[data-hint-key]')?.textContent).toBe('RS');
      hud.setPointerLockHint(false);
      expect(hint.hidden).toBe(false);
      expect(boardKey.textContent).toBe('E');
      expect(copy.textContent).toBe('MOUSE / IJKL LOOK · C CAPTURE MOUSE');
      expect(head.children[0]!.textContent).toContain('.gg-ui [hidden]{display:none!important}');
    } finally {
      hud.dispose();
    }
  });
});
