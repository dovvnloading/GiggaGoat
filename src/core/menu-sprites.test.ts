import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameMenu } from './GameMenu';
import { MENU_SPRITES, menuSpriteUrl } from './MenuSprites';
import { DEFAULT_SETTINGS } from './Persistence';

const manifest = JSON.parse(readFileSync(
  resolve(process.cwd(), 'public/assets/ui/sprites/sprites.json'), 'utf8',
)) as Record<string, { file: string; w: number; h: number }>;

class NodeStub {
  className = '';
  id = '';
  hidden = false;
  textContent = '';
  tagName = 'DIV';
  type = '';
  value = '';
  min = '';
  max = '';
  step = '';
  dataset: Record<string, string> = {};
  readonly attrs = new Map<string, string>();
  readonly children: NodeStub[] = [];
  readonly properties = new Map<string, string>();
  readonly style = {
    display: '',
    setProperty: (name: string, value: string) => { this.properties.set(name, value); },
  };
  private listeners = new Map<string, Array<(event: any) => void>>();
  private controls: NodeStub[] = [];
  private html = '';
  owner: NodeStub | null = null;
  constructor(readonly doc: DocumentStub) {}

  set innerHTML(html: string) {
    this.html = html;
    this.controls = [...html.matchAll(/<(button|select|input)\b([^>]*)>/gi)].map(match => {
      const tag = match[1]!.toLowerCase();
      const node = tag === 'button' ? new ButtonStub(this.doc) :
        tag === 'select' ? new SelectStub(this.doc) : new InputStub(this.doc);
      node.tagName = tag.toUpperCase();
      node.owner = this;
      for (const attr of (match[2] ?? '').matchAll(/([\w:-]+)(?:="([^"]*)")?/g))
        node.setAttribute(attr[1]!, attr[2] ?? '');
      return node;
    });
  }
  get innerHTML(): string { return this.html; }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === 'id') this.id = value;
    if (name === 'type') this.type = value;
    if (name === 'value') this.value = value;
    if (name === 'min') this.min = value;
    if (name === 'max') this.max = value;
    if (name === 'step') this.step = value;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_a, c: string) => c.toUpperCase());
      this.dataset[key] = value;
    }
  }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  appendChild(child: NodeStub): NodeStub { this.children.push(child); return child; }
  remove(): void {}
  contains(child: NodeStub | null): boolean {
    return child === this || !!child && this.controls.includes(child);
  }
  matches(_selector: string): boolean { return false; }
  closest<T = NodeStub>(selector: string): T | null {
    if (selector === 'button[data-sprite-normal]')
      return (this.tagName === 'BUTTON' && this.hasAttribute('data-sprite-normal') ? this : null) as T | null;
    if (selector === '[data-action]' || selector === '[data-tab]' ||
      selector === '[data-setting-toggle]' || selector === '[data-fullscreen]')
      return (this.hasAttribute(selector.slice(1, -1)) ? this : null) as T | null;
    return null;
  }
  querySelectorAll<T = NodeStub>(selector: string): T[] {
    if (selector === 'button,select,input') return this.controls as T[];
    if (selector === 'button') return this.controls.filter(n => n.tagName === 'BUTTON') as T[];
    const match = /^\[([\w-]+)(?:="([^"]+)")?\]$/.exec(selector);
    if (match) return this.controls.filter(n => n.hasAttribute(match[1]!) &&
      (match[2] === undefined || n.attrs.get(match[1]!) === match[2])) as T[];
    return [];
  }
  querySelector<T = NodeStub>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }
  addEventListener(name: string, handler: (event: any) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
  }
  dispatch(name: string, target: NodeStub, extra: Record<string, unknown> = {}): void {
    for (const handler of this.listeners.get(name) ?? [])
      handler({ target, relatedTarget: null, code: '', ...extra });
  }
  focus(): void {
    this.doc.activeElement = this;
    this.owner?.dispatch('focusin', this);
  }
  click(): void { this.owner?.dispatch('click', this); }
}
class ButtonStub extends NodeStub {}
class InputStub extends NodeStub {}
class SelectStub extends NodeStub {}
class DocumentStub {
  readonly head = new NodeStub(this);
  activeElement: NodeStub | null = null;
  pointerLockElement: NodeStub | null = null;
  fullscreenElement: NodeStub | null = null;
  hidden = false;
  readonly documentElement = new NodeStub(this);
  createElement(): NodeStub { return new NodeStub(this); }
  addEventListener(): void {}
  removeEventListener(): void {}
}
class WindowStub {
  private listeners = new Map<string, Array<(event: any) => void>>();
  addEventListener(name: string, callback: (event: any) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  removeEventListener(): void {}
  dispatch(name: string, event: Record<string, unknown>): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

function setup() {
  const doc = new DocumentStub();
  const win = new WindowStub();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('HTMLButtonElement', ButtonStub);
  vi.stubGlobal('HTMLInputElement', InputStub);
  vi.stubGlobal('HTMLSelectElement', SelectStub);
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const host = new NodeStub(doc);
  const game = {
    rules: { wallet: { coins: 20 } },
    gigs: { director: { ownedCosmetics: [] }, active: null },
    party: { match: null, title: 'Rising Tide' },
    physics: { stepCount: 0 },
  };
  const view = {
    paused: false,
    onFrame: null as null | (() => void),
    onInteract: null as null | (() => boolean),
    input: { reset: vi.fn(), requestPointerLock: vi.fn() },
    hud: { setVisible: vi.fn() },
    renderer: { domElement: new NodeStub(doc) },
    applySettings: vi.fn(),
  };
  const settings = { ...DEFAULT_SETTINGS };
  const menu = new GameMenu(host as unknown as HTMLElement,
    game as unknown as ConstructorParameters<typeof GameMenu>[1],
    view as unknown as ConstructorParameters<typeof GameMenu>[2], settings);
  const setScreen = (screen: string): void =>
    (menu as unknown as { setScreen: (value: string) => void }).setScreen(screen);
  return { menu, doc, win, view, settings, setScreen, root: host.children[0]! };
}

afterEach(() => vi.unstubAllGlobals());

describe('sprite-backed menu DOM', () => {
  it('references real manifest sprites for every title, pause and settings control', () => {
    const { menu, root, setScreen } = setup();
    try {
      const seen = new Set<string>();
      const check = () => {
        const html = root.innerHTML;
        expect(html).toContain('data-sprite="menu/panel_tall"');
        for (const control of html.matchAll(/<(button|input|select)\b([^>]*)>/g)) {
          const attrs = control[2] ?? '';
          const name = attrs.match(/\bdata-sprite="([^"]+)"/)?.[1];
          expect(name, control[0]).toBeDefined();
          expect(manifest[name!], control[0]).toBeDefined();
          seen.add(name!);
          for (const key of ['data-sprite-normal', 'data-sprite-hover', 'data-sprite-pressed']) {
            const variant = attrs.match(new RegExp('\\b' + key + '="([^"]+)"'))?.[1];
            if (variant) expect(manifest[variant], control[0]).toBeDefined();
          }
        }
      };
      check(); // Title, including all stat cards and the CUD coin icon
      expect(root.innerHTML).toContain('data-sprite="icons/cud_coin"');
      expect((root.innerHTML.match(/data-sprite="menu\/stat_card"/g) ?? []).length).toBe(3);
      setScreen('pause'); check();
      setScreen('settings'); check();
      expect(root.innerHTML).toContain('data-sprite="menu/toggle_off"');
      expect(root.innerHTML).toContain('data-sprite="menu/button_close"');
      expect(root.innerHTML).toContain('data-sprite="menu/button_back"');
      root.querySelector<ButtonStub>('[data-tab="video"]')!.click(); check();
      expect(root.innerHTML).toContain('data-sprite="menu/checkbox_empty"');
      root.querySelector<ButtonStub>('[data-tab="audio"]')!.click(); check();
      expect(root.innerHTML).toContain('data-sprite="menu/slider"');
      setScreen('party'); check(); // Native selects keep their art and input handling
      for (const required of [
        MENU_SPRITES.yellowHover, MENU_SPRITES.yellowPressed,
        MENU_SPRITES.purpleHover, MENU_SPRITES.purplePressed,
        MENU_SPRITES.tabGold, MENU_SPRITES.tabBrown, MENU_SPRITES.tabPurple,
      ]) expect(manifest[required]).toBeDefined();
      expect(seen).toContain(MENU_SPRITES.yellowNormal);
      expect(seen).toContain(MENU_SPRITES.purpleNormal);
      expect(menuSpriteUrl(MENU_SPRITES.panel)).toMatch(/assets\/ui\/sprites\/menu\/panel_tall\.png$/);
    } finally { menu.dispose(); }
  });

  it('swaps the live button sprite for mouse, keyboard and gamepad focus/press', () => {
    const { menu, doc, win, root, view, settings, setScreen } = setup();
    try {
      const play = root.querySelector<ButtonStub>('[data-action="play"]')!;
      expect(play.dataset.sprite).toBe(MENU_SPRITES.yellowHover); // Initial native focus
      root.dispatch('pointerdown', play);
      expect(play.dataset.sprite).toBe(MENU_SPRITES.yellowPressed);
      root.dispatch('pointerup', play);
      expect(play.dataset.sprite).toBe(MENU_SPRITES.yellowHover);
      doc.activeElement = null;
      root.dispatch('focusout', play);
      expect(play.dataset.sprite).toBe(MENU_SPRITES.yellowNormal);

      play.focus();
      win.dispatch('keydown', { code: 'ArrowDown', repeat: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn() });
      const party = root.querySelector<ButtonStub>('[data-action="party"]')!;
      expect(doc.activeElement).toBe(party);
      expect(party.dataset.sprite).toBe(MENU_SPRITES.purpleHover);

      doc.activeElement = play;
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
      buttons[13]!.pressed = true;
      vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, buttons, axes: [0, 0] }] });
      view.onFrame?.();
      expect(doc.activeElement).toBe(party);
      expect(party.dataset.sprite).toBe(MENU_SPRITES.purpleHover);
      setScreen('settings');
      const invert = root.querySelector<ButtonStub>('[data-setting-toggle]')!;
      invert.click();
      expect(settings.invertY).toBe(true);
      expect(root.innerHTML).toContain('data-sprite="menu/toggle_on"');
    } finally { menu.dispose(); }
  });
});
