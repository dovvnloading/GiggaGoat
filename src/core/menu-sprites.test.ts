import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameMenu } from './GameMenu';
import { MENU_SPRITES, menuSpriteUrl } from './MenuSprites';
import { DEFAULT_SETTINGS } from './Persistence';
import { MODE_DEFAULTS, type PartyMatch } from '../modes';
import { GigCatalog, GigDirector, type GigBoard, type GigOffer, type GigRun } from '../gigs';
import { generateIsland, type PoiId } from '../world';
import { frame, goat, readyMatch } from '../modes/test-utils';

const manifest = JSON.parse(readFileSync(
  resolve(process.cwd(), 'public/assets/ui/sprites/sprites.json'), 'utf8',
)) as Record<string, { file: string; w: number; h: number }>;

class NodeStub {
  className = '';
  id = '';
  hidden = false;
  visibility = 'visible';
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
  private panel: NodeStub | null = null;
  private standings: NodeStub | null = null;
  private resultScrollHint: NodeStub | null = null;
  private controlReference: NodeStub | null = null;
  scrollTop = 0;
  clientHeight = 124;
  scrollHeight = 124;
  tabIndex = -1;
  private brief: NodeStub[] = [];
  private html = '';
  owner: NodeStub | null = null;
  constructor(readonly doc: DocumentStub) {}

  set innerHTML(html: string) {
    this.html = html;
    this.panel = /class="gg-shell-panel(?:\s|")/.test(html) ? new NodeStub(this.doc) : null;
    this.standings = html.includes('<ol class="gg-results"') ? new NodeStub(this.doc) : null;
    this.resultScrollHint = html.includes('data-results-scroll-hint') ? new NodeStub(this.doc) : null;
    if (this.resultScrollHint) this.resultScrollHint.hidden = true;
    this.controlReference = html.includes('id="gg-gameplay-controls"') ? new NodeStub(this.doc) : null;
    if (this.controlReference) this.controlReference.id = 'gg-gameplay-controls';
    this.controls = [...html.matchAll(/<(button|select|input)\b([^>]*)>/gi)].map(match => {
      const tag = match[1]!.toLowerCase();
      const node = tag === 'button' ? new ButtonStub(this.doc) :
        tag === 'select' ? new SelectStub(this.doc) : new InputStub(this.doc);
      node.tagName = tag.toUpperCase();
      node.tabIndex = 0;
      node.owner = this;
      for (const attr of (match[2] ?? '').matchAll(/([\w:-]+)(?:="([^"]*)")?/g))
        node.setAttribute(attr[1]!, attr[2] ?? '');
      return node;
    });
    this.brief = [...html.matchAll(/<(strong|p) ([^>]*)(data-party-(?:venue|objective)|data-board-note)([^>]*)>([^<]*)<\//g)]
      .map(match => {
        const node = new NodeStub(this.doc);
        node.setAttribute(match[3]!, '');
        node.textContent = match[5]!;
        return node;
      });
  }
  get innerHTML(): string { return this.html; }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === 'id') this.id = value;
    if (name === 'type') this.type = value;
    if (name === 'tabindex') this.tabIndex = Number(value);
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
  matches(selector: string): boolean { return selector === ':disabled' && this.hasAttribute('disabled'); }
  getClientRects(): unknown[] { return this.hidden ? [] : [{}]; }
  closest<T = NodeStub>(selector: string): T | null {
    if (selector === 'button[data-sprite-normal]')
      return (this.tagName === 'BUTTON' && this.hasAttribute('data-sprite-normal') ? this : null) as T | null;
    if (selector === '[data-action]' || selector === '[data-tab]' || selector === '[data-board-offer]' ||
      selector === '[data-setting-toggle]' || selector === '[data-fullscreen]')
      return (this.hasAttribute(selector.slice(1, -1)) ? this : null) as T | null;
    return null;
  }
  querySelectorAll<T = NodeStub>(selector: string): T[] {
    if (selector === '.gg-shell-panel') return (this.panel ? [this.panel] : []) as T[];
    if (selector === '.gg-results') return (this.standings ? [this.standings] : []) as T[];
    if (selector === '[data-results-scroll-hint]')
      return (this.resultScrollHint ? [this.resultScrollHint] : []) as T[];
    if (selector === '#gg-gameplay-controls') return (this.controlReference ? [this.controlReference] : []) as T[];
    if (selector === 'button,select,input') return this.controls as T[];
    if (selector === 'button,select,input,[tabindex]') return [
      ...(this.standings ? [this.standings] : []), ...this.controls,
      ...(this.controlReference ? [this.controlReference] : []),
    ] as T[];
    if (selector === 'button') return this.controls.filter(n => n.tagName === 'BUTTON') as T[];
    const match = /^\[([\w-]+)(?:(\^?=)"([^"]+)")?\]$/.exec(selector);
    if (match) return [...this.controls, ...this.brief].filter(n => {
      const value = n.attrs.get(match[1]!);
      if (value === undefined) return false;
      if (match[2] === '^=') return value.startsWith(match[3]!);
      return match[3] === undefined || value === match[3];
    }) as T[];
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
  scrollBy(_x: number, y: number): void { this.scrollTop += y; }
  scrollIntoView(_options: ScrollIntoViewOptions): void {}
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

class ResizeObserverStub {
  private target: NodeStub | null = null;
  constructor(private readonly onResize: () => void) {}
  observe(target: NodeStub): void { this.target = target; }
  disconnect(): void { this.target = null; }
  trigger(): void { if (this.target) this.onResize(); }
}

function setup(audio?: ConstructorParameters<typeof GameMenu>[4]) {
  const doc = new DocumentStub();
  const win = new WindowStub();
  const observers: ResizeObserverStub[] = [];
  vi.stubGlobal('ResizeObserver', class extends ResizeObserverStub {
    constructor(callback: () => void) {
      super(callback);
      observers.push(this);
    }
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('HTMLButtonElement', ButtonStub);
  vi.stubGlobal('HTMLInputElement', InputStub);
  vi.stubGlobal('HTMLSelectElement', SelectStub);
  vi.stubGlobal('getComputedStyle', (node: NodeStub) => ({ visibility: node.visibility }));
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const host = new NodeStub(doc);
  const game = {
    rules: { unlocks: { isUnlocked: () => false }, wallet: { coins: 20 } },
    gigs: { director: { ownedCosmetics: [], board: vi.fn<(poi: PoiId) => GigBoard>() },
      active: null as GigRun | null, catalog: null as GigCatalog | null,
      nearBoard: vi.fn<() => PoiId | null>(), accept: vi.fn() },
    party: { match: null as PartyMatch | null, title: 'Rising Tide',
      start: vi.fn(), returnToFreeRoam: vi.fn() },
    physics: { stepCount: 0 },
  };
  const view = {
    paused: false,
    onFrame: null as null | (() => void),
    onInteract: null as null | (() => boolean),
    input: { setActive: vi.fn(), requestPointerLock: vi.fn() },
    hud: { setVisible: vi.fn() },
    renderer: { domElement: new NodeStub(doc) },
    applySettings: vi.fn(),
    alignCameraForPlay: vi.fn(),
  };
  const settings = { ...DEFAULT_SETTINGS };
  const menu = new GameMenu(host as unknown as HTMLElement,
    game as unknown as ConstructorParameters<typeof GameMenu>[1],
    view as unknown as ConstructorParameters<typeof GameMenu>[2], settings, audio);
  const setScreen = (screen: string): void =>
    (menu as unknown as { setScreen: (value: string) => void }).setScreen(screen);
  return { menu, doc, win, game, view, settings, setScreen, root: host.children[0]!,
    resizeStandings: () => observers.forEach(observer => observer.trigger()) };
}

afterEach(() => vi.unstubAllGlobals());

describe('sprite-backed menu DOM', () => {
  it('keeps the result tail only on visible gig and party results', () => {
    const audio = { setVolumes: vi.fn(), setMenuOpen: vi.fn(), playResultAudio: vi.fn() };
    const { menu, game, doc, view, setScreen } =
      setup(audio as unknown as ConstructorParameters<typeof GameMenu>[4]);
    Object.assign(game, { acknowledgeGigResult: vi.fn() });
    try {
      expect(audio.setMenuOpen).toHaveBeenLastCalledWith(true);
      setScreen('playing');
      expect(audio.setMenuOpen).toHaveBeenLastCalledWith(false);
      setScreen('gig-results');
      expect(view.paused).toBe(true);
      expect(audio.playResultAudio).toHaveBeenLastCalledWith('gig');
      setScreen('playing');
      expect(audio.setMenuOpen).toHaveBeenLastCalledWith(false);
      setScreen('party-results');
      expect(audio.playResultAudio).toHaveBeenLastCalledWith('party');
      setScreen('pause');
      expect(audio.setMenuOpen).toHaveBeenLastCalledWith(true);

      doc.hidden = true;
      setScreen('party-results');
      expect(audio.setMenuOpen).toHaveBeenLastCalledWith(true);
      expect(audio.playResultAudio).toHaveBeenCalledTimes(2);
    } finally { menu.dispose(); }
  });

  it('routes pointer, keyboard, and gamepad menu activations to UI feedback', () => {
    const audio = { setVolumes: vi.fn(), setMenuOpen: vi.fn(), playMenuCue: vi.fn() };
    const { menu, root, win, view, setScreen } =
      setup(audio as unknown as ConstructorParameters<typeof GameMenu>[4]);
    try {
      expect(audio.playMenuCue).not.toHaveBeenCalled();
      const settings = root.querySelector<ButtonStub>('[data-action="settings"]')!;
      root.dispatch('click', settings, { isTrusted: true, detail: 1, pointerType: 'mouse' });
      expect(audio.playMenuCue).toHaveBeenLastCalledWith('ui-confirm');

      root.querySelector<ButtonStub>('[data-tab="controls"]')!.focus();
      win.dispatch('keydown', { code: 'ArrowRight', preventDefault: vi.fn() });
      expect(audio.playMenuCue).toHaveBeenLastCalledWith('ui-click');
      const buttons = [{ pressed: true }];
      vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, buttons, axes: [] }] });
      root.querySelector<ButtonStub>('[data-tab="audio"]')!.focus();
      view.onFrame?.();
      expect(audio.playMenuCue.mock.calls).toEqual([['ui-confirm'], ['ui-click'], ['ui-click']]);
      buttons[0]!.pressed = false;

      const slider = root.querySelector<InputStub>('[id="gg-setting-effectsVolume"]')!;
      slider.value = '0.3';
      root.dispatch('input', slider);
      slider.value = '0.4';
      root.dispatch('input', slider);
      expect(audio.playMenuCue).toHaveBeenCalledTimes(3);
      root.dispatch('change', slider);
      expect(audio.setVolumes).toHaveBeenLastCalledWith(expect.objectContaining({ effectsVolume: .4 }));
      expect(audio.playMenuCue).toHaveBeenCalledTimes(4);
      win.dispatch('keydown', { code: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(audio.playMenuCue).toHaveBeenLastCalledWith('ui-back');

      setScreen('playing');
      win.dispatch('keydown', { code: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(audio.playMenuCue).toHaveBeenLastCalledWith('ui-back');
      expect(audio.setMenuOpen).toHaveBeenLastCalledWith(true);
      root.querySelector<ButtonStub>('[data-action="resume"]')!.click();
      expect(audio.playMenuCue).toHaveBeenLastCalledWith('ui-confirm');
      expect(audio.setMenuOpen).toHaveBeenLastCalledWith(false);
    } finally { menu.dispose(); }
  });

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
      check(); // Title buttons and the returning player's CUD coin icon
      expect(root.innerHTML).toContain('data-sprite="icons/cud_coin"');
      setScreen('pause'); check();
      setScreen('settings'); check();
      expect(root.innerHTML).toContain('data-sprite="menu/toggle_off"');
      expect(root.innerHTML).not.toContain('data-sprite="menu/button_close"');
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

  it('uses matching inactive tabs, one selected palette, and a single labeled Back action', () => {
    const { menu, doc, win, root, view, setScreen } = setup();
    try {
      root.querySelector<ButtonStub>('[data-action="settings"]')!.click();
      const tabs = () => root.querySelectorAll<ButtonStub>('[data-tab]');
      const checkTabs = (selected: string) => {
        expect(tabs().map(tab => tab.dataset.tab)).toEqual(['controls', 'video', 'audio']);
        expect(tabs().filter(tab => tab.attrs.get('aria-selected') === 'true')).toHaveLength(1);
        for (const tab of tabs()) {
          const active = tab.dataset.tab === selected;
          expect(tab.attrs.get('aria-selected')).toBe(String(active));
          expect(tab.tabIndex).toBe(active ? 0 : -1);
          expect(tab.dataset.spriteNormal).toBe(active ? MENU_SPRITES.yellowNormal : MENU_SPRITES.purpleNormal);
          expect(tab.dataset.spriteHover).toBe(active ? MENU_SPRITES.yellowHover : MENU_SPRITES.purpleHover);
          expect(tab.dataset.spritePressed).toBe(active ? MENU_SPRITES.yellowPressed : MENU_SPRITES.purplePressed);
        }
      };
      checkTabs('controls');
      expect(root.innerHTML).toContain('<span>CONTROLS</span>');
      expect(root.innerHTML).toContain('<span>VIDEO</span>');
      expect(root.innerHTML).toContain('<span>AUDIO</span>');
      const backs = root.querySelectorAll<ButtonStub>('[data-action="back"]');
      expect(backs).toHaveLength(1);
      expect(backs[0]!.attrs.get('aria-label')).toBe('Back to title');
      expect(root.innerHTML).toContain('>Back</button>');

      tabs()[0]!.focus();
      win.dispatch('keydown', { code: 'ArrowRight', repeat: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn() });
      checkTabs('video');
      expect(doc.activeElement).toBe(tabs()[1]);
      const tabDefault = vi.fn();
      win.dispatch('keydown', { code: 'Tab', preventDefault: tabDefault });
      expect(tabDefault).not.toHaveBeenCalled();
      const stops = root.querySelectorAll('button,select,input,[tabindex]').filter(node => node.tabIndex >= 0);
      const fov = stops[stops.indexOf(tabs()[1]!) + 1]!;
      expect(fov.id).toBe('gg-setting-fov');
      const graphics = root.querySelector('[id="gg-setting-graphics"]')!;
      const nativeArrow = vi.fn();
      for (const control of [fov, graphics]) {
        control.focus();
        win.dispatch('keydown', { code: 'ArrowDown', preventDefault: nativeArrow });
        win.dispatch('keydown', { code: 'ArrowRight', preventDefault: nativeArrow });
        expect(doc.activeElement).toBe(control);
      }
      expect(nativeArrow).not.toHaveBeenCalled();
      tabs()[2]!.click();
      checkTabs('audio');
      expect(root.innerHTML).toMatch(/id="gg-setting-musicVolume"[^>]*step="0.01" value="0.52"/);
      expect(root.innerHTML).toContain('<output for="gg-setting-musicVolume">52%</output>');
      expect(root.innerHTML).toMatch(/id="gg-setting-effectsVolume"[^>]*step="0.01" value="0.88"/);
      expect(root.innerHTML).toContain('<output for="gg-setting-effectsVolume">88%</output>');

      root.querySelector<ButtonStub>('[data-action="back"]')!.click();
      expect(root.querySelector('[data-action="play"]')).not.toBeNull();
      expect(doc.activeElement).toBe(root.querySelector('[data-action="settings"]'));

      setScreen('pause');
      root.querySelector<ButtonStub>('[data-action="settings"]')!.click();
      expect(root.querySelector('[data-action="back"]')!.attrs.get('aria-label')).toBe('Back to pause');
      vi.stubGlobal('navigator', { getGamepads: () => [
        { connected: true, buttons: [{ pressed: false }, { pressed: true }], axes: [] },
      ] });
      view.onFrame?.();
      expect(root.querySelector('[data-action="resume"]')).not.toBeNull();
      expect(doc.activeElement).toBe(root.querySelector('[data-action="settings"]'));
    } finally { menu.dispose(); }
  });

  it('wraps modal Tab within visible enabled controls and leaves browser shortcuts alone', () => {
    const { menu, doc, win, root, setScreen } = setup();
    try {
      const play = root.querySelector('[data-action="play"]')!;
      const party = root.querySelector('[data-action="party"]')!;
      const settings = root.querySelector('[data-action="settings"]')!;
      const tab = (shiftKey = false, ctrlKey = false): boolean => {
        const preventDefault = vi.fn();
        win.dispatch('keydown', { code: 'Tab', shiftKey, ctrlKey, preventDefault });
        return preventDefault.mock.calls.length > 0;
      };
      expect(doc.activeElement).toBe(play);
      expect(tab()).toBe(false);
      expect(tab(true)).toBe(true);
      expect(doc.activeElement).toBe(settings);
      expect(tab(false, true)).toBe(false);
      expect(tab()).toBe(true);
      expect(doc.activeElement).toBe(play);

      party.setAttribute('disabled', '');
      settings.hidden = true;
      expect(tab(true)).toBe(true);
      expect(doc.activeElement).toBe(play);
      settings.hidden = false;
      settings.visibility = 'hidden';
      expect(tab(true)).toBe(true);
      expect(doc.activeElement).toBe(play);
      setScreen('playing');
      expect(tab()).toBe(false);
    } finally { menu.dispose(); }
  });

  it.each(['title', 'pause'])('restores the Party launcher when returning to %s', origin => {
    const { menu, doc, win, root, setScreen } = setup();
    try {
      setScreen(origin);
      root.querySelector<ButtonStub>('[data-action="party"]')!.click();
      win.dispatch('keydown', { code: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(doc.activeElement).toBe(root.querySelector('[data-action="party"]'));
    } finally { menu.dispose(); }
  });

  it('shows the Billy Isle art and presents Play before optional saved progress', () => {
    const { menu, root, game, setScreen } = setup();
    try {
      expect(root.innerHTML).toMatch(/<img[^>]*07_key_art\.png[^>]*alt="Gigga-Goat"/);
      expect(root.innerHTML.indexOf('data-action="play"')).toBeLessThan(
        root.innerHTML.indexOf('class="gg-title-progress"'));
      expect(root.innerHTML).toContain('20 CUD COINS');
      expect(root.innerHTML).not.toContain('GEAR REWARD');

      game.rules.wallet.coins = 0;
      setScreen('title');
      expect(root.innerHTML).not.toContain('class="gg-title-progress"');
      expect(root.innerHTML).toContain('QUICK START');
    } finally { menu.dispose(); }
  });

  it('sets the gameplay orbit when Play or Launch Round starts a session', () => {
    const { menu, game, view, root, setScreen } = setup();
    try {
      expect(view.alignCameraForPlay).not.toHaveBeenCalled();
      expect(root.innerHTML).toContain('<dt>Move</dt><dd>WASD or arrows · Left stick</dd>');

      root.querySelector<ButtonStub>('[data-action="play"]')!.click();
      expect(view.alignCameraForPlay).toHaveBeenCalledTimes(1);
      expect(view.input.requestPointerLock).toHaveBeenCalledTimes(1);
      expect(view.paused).toBe(false);

      setScreen('pause');
      root.querySelector<ButtonStub>('[data-action="resume"]')!.click();
      expect(view.alignCameraForPlay).toHaveBeenCalledTimes(1);
      expect(view.paused).toBe(false);

      setScreen('party');
      root.querySelector<ButtonStub>('[data-action="start-party"]')!.click();
      expect(view.alignCameraForPlay).toHaveBeenCalledTimes(2);
      expect(game.party.start.mock.invocationCallOrder[0]!)
        .toBeLessThan(view.alignCameraForPlay.mock.invocationCallOrder[1]!);
      expect(view.paused).toBe(false);
    } finally { menu.dispose(); }
  });

  it('updates each party objective and venue in place and launches the selected round', () => {
    const { menu, doc, game, root } = setup();
    try {
      root.querySelector<ButtonStub>('[data-action="party"]')!.click();
      const select = root.querySelector<SelectStub>('[id="gg-mode"]')!;
      const venue = root.querySelector('[data-party-venue]')!;
      const objective = root.querySelector('[data-party-objective]')!;
      expect(venue.textContent).toBe('Billy Isle · start in Hoofington');
      expect(objective.textContent).toContain('sea rises');
      select.focus();

      select.value = 'king-of-the-peak';
      root.dispatch('change', select);
      expect(venue.textContent).toBe('Mt. Gigga summit');
      expect(objective.textContent).toContain(MODE_DEFAULTS.peakTargetScore + ' points');

      select.value = 'hay-heist';
      root.dispatch('change', select);
      expect(venue.textContent).toBe('Crane Yard · haul lane');
      expect(objective.textContent).toContain(MODE_DEFAULTS.hayTargetScore + ' deliveries');
      expect(objective.textContent).not.toContain('tide');
      expect(doc.activeElement).toBe(select);
      expect(root.querySelector('[id="gg-mode"]')).toBe(select);

      root.querySelector<ButtonStub>('[data-action="start-party"]')!.click();
      expect(game.party.start).toHaveBeenCalledWith('hay-heist', 3, 'normal');
    } finally { menu.dispose(); }
  });

  it('protects an active gig before launching a party and keeps setup when going back', () => {
    const { menu, doc, win, game, root, view, setScreen } = setup();
    try {
      const catalog = new GigCatalog(generateIsland({ resolution: 97 }));
      const director = new GigDirector(catalog);
      director.accept(catalog.board('mt-gigga', 0).offers[0]!.id);
      game.gigs.active = director.active;
      root.querySelector<ButtonStub>('[data-action="play"]')!.click();
      const key = (code: string): void => win.dispatch('keydown', {
        code, repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      });
      key('KeyP');
      const select = root.querySelector<SelectStub>('[id="gg-mode"]')!;
      select.value = 'king-of-the-peak';
      root.dispatch('change', select);

      const confirm = () => root.querySelector<ButtonStub>('[data-action="start-party"]')!.click();
      confirm();
      expect(game.party.start).not.toHaveBeenCalled();
      expect(root.innerHTML).toContain('SUMMIT SPRINT');
      expect(root.innerHTML).toContain('King of the Peak');
      expect(root.innerHTML).toContain('clear this attempt’s progress');
      expect(doc.activeElement).toBe(root.querySelector('[data-action="keep-gig"]'));
      key('Escape');
      expect(root.innerHTML).toContain('<option value="king-of-the-peak" selected>');
      expect(doc.activeElement).toBe(root.querySelector('[data-action="start-party"]'));
      confirm();
      root.querySelector<ButtonStub>('[data-action="keep-gig"]')!.click();
      expect(view.paused).toBe(false);
      expect(game.gigs.active?.status).toBe('running');
      expect(game.party.start).not.toHaveBeenCalled();

      setScreen('pause');
      root.querySelector<ButtonStub>('[data-action="party"]')!.click();
      confirm();
      root.querySelector<ButtonStub>('[data-action="keep-gig"]')!.click();
      expect(view.paused).toBe(true);
      expect(doc.activeElement).toBe(root.querySelector('[data-action="party"]'));
      expect(game.gigs.active?.status).toBe('running');
      expect(game.party.start).not.toHaveBeenCalled();

      root.querySelector<ButtonStub>('[data-action="resume"]')!.click();
      key('KeyP');
      confirm();
      root.querySelector<ButtonStub>('[data-action="confirm-party"]')!.click();
      expect(game.party.start).toHaveBeenCalledExactlyOnceWith('king-of-the-peak', 3, 'normal');
    } finally { menu.dispose(); }
  });

  it('shows real contract targets and accepts only the offer selected on the Hoofington board', () => {
    const { menu, doc, game, root, view } = setup();
    try {
      const island = generateIsland({ resolution: 97 });
      const catalog = new GigCatalog(island, island.seed);
      const board = catalog.board('hoofington', 0);
      Object.assign(game, { island });
      game.gigs.catalog = catalog;
      game.gigs.director.board.mockReturnValue(board);
      game.gigs.nearBoard.mockReturnValue('hoofington');

      root.querySelector<ButtonStub>('[data-action="play"]')!.click();
      expect(view.onInteract?.()).toBe(true);
      expect(root.innerHTML).toContain('MAKE CUD COINS');
      expect(root.innerHTML).toContain('Hay Haul');
      expect(root.innerHTML).toContain('Mow-Down');
      expect(root.innerHTML).toContain('icons/hay_floor');
      expect(root.innerHTML).toContain('gg-board-grass');

      for (const offer of board.offers) {
        const { config, info } = catalog.build(offer);
        expect(root.innerHTML).toContain(offer.difficulty[0]!.toUpperCase() + offer.difficulty.slice(1));
        expect(root.innerHTML).toContain(info.baseCoins + ' base coins');
        if (config.kind === 'hay-haul') expect(root.innerHTML).toContain('Deliver ' + config.required + ' bales');
        if (config.kind === 'mow-down') expect(root.innerHTML).toContain('Graze ' + config.patches.length + ' grass patches');
      }

      const choices = root.querySelectorAll<ButtonStub>('[data-board-offer]');
      expect(choices).toHaveLength(2);
      expect(choices.map(choice => choice.attrs.get('aria-pressed'))).toEqual(['true', 'false']);
      const confirm = root.querySelectorAll<ButtonStub>('[data-action^="offer:"]');
      expect(confirm).toHaveLength(1);
      expect(confirm[0]!.dataset.action).toBe('offer:' + board.offers[0]!.id);
      choices[1]!.focus();
      choices[1]!.click();
      expect(choices.map(choice => choice.attrs.get('aria-pressed'))).toEqual(['false', 'true']);
      expect(doc.activeElement).toBe(choices[1]);
      expect(root.querySelector('[data-board-note]')?.textContent)
        .toBe(catalog.info(board.offers[1]!.gigId).instruction);
      expect(game.gigs.accept).not.toHaveBeenCalled();

      confirm[0]!.click();
      expect(game.gigs.accept).toHaveBeenCalledExactlyOnceWith(board.offers[1]!.id);
      expect(view.paused).toBe(false);
    } finally { menu.dispose(); }
  });

  it('reuses the quick-start bindings in the Controls tab and returns directly to pause', () => {
    const { menu, doc, win, root, view, setScreen } = setup();
    try {
      expect(root.innerHTML).toContain('QUICK START');
      for (const action of ['Move', 'Lick', 'Headbutt', 'Toggle Hay-Build']) {
        expect(root.innerHTML).toContain('<dt>' + action + '</dt>');
      }

      setScreen('pause');
      expect(root.innerHTML).toContain('CONTROLS &amp; SETTINGS');
      root.querySelector<ButtonStub>('[data-action="settings"]')!.click();
      expect(root.innerHTML).toContain('aria-labelledby="gg-tab-controls"');
      expect(root.innerHTML).toContain('<td>Hold right mouse</td><td>Hold LB or LT</td>');
      expect(root.innerHTML).toContain('<td>Hold, then release left mouse</td><td>Hold, then release RT</td>');
      expect(root.innerHTML).toContain('<td>B</td><td>Y</td>');
      expect(root.innerHTML).toContain('<td>1–4</td><td>D-pad</td>');
      expect(root.innerHTML).toContain('<td>Left click in Hay-Build</td><td>RT in Hay-Build</td>');
      expect(root.querySelector('[data-setting-toggle]')).not.toBeNull();

      vi.stubGlobal('navigator', { getGamepads: () => [
        { connected: true, buttons: [], axes: [0, 0, 0, .7] },
      ] });
      expect(root.querySelector('.gg-shell-panel')!.scrollTop).toBe(0);
      view.onFrame?.();
      expect(root.querySelector('.gg-shell-panel')!.scrollTop).toBeCloseTo(9.8);

      win.dispatch('keydown', { code: 'Escape', repeat: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(root.querySelector('[data-action="resume"]')).not.toBeNull();
      expect(doc.activeElement).toBe(root.querySelector('[data-action="settings"]'));
    } finally { menu.dispose(); }
  });

  it('puts the gameplay controls jump before mouse tuning and lets keyboard and gamepad reach it', () => {
    const { menu, doc, win, root, view, setScreen } = setup();
    try {
      setScreen('settings');
      const jump = root.querySelector<ButtonStub>('[data-action="gameplay-controls"]')!;
      const reference = root.querySelector('#gg-gameplay-controls')!;
      expect(jump.attrs.get('aria-controls')).toBe(reference.id);
      expect(root.innerHTML.indexOf('data-action="gameplay-controls"'))
        .toBeLessThan(root.innerHTML.indexOf('id="gg-setting-mouseSensitivity"'));
      const intoView = vi.spyOn(reference, 'scrollIntoView');

      for (let i = 0; i < 2; i++) {
        win.dispatch('keydown', { code: 'ArrowDown', preventDefault: vi.fn() });
      }
      expect(doc.activeElement).toBe(jump);
      jump.click();
      expect(doc.activeElement).toBe(reference);
      expect(intoView).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
      const preventDefault = vi.fn();
      win.dispatch('keydown', { code: 'ArrowDown', preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
      win.dispatch('keydown', { code: 'Tab', preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(doc.activeElement).toBe(root.querySelector('[data-action="back"]'));

      jump.focus();
      vi.stubGlobal('navigator', { getGamepads: () => [
        { connected: true, buttons: [{ pressed: true }], axes: [] },
      ] });
      view.onFrame?.();
      expect(intoView).toHaveBeenCalledTimes(2);
      expect(doc.activeElement).toBe(reference);
    } finally { menu.dispose(); }
  });

  it('shows delivery progress and lets the eligible retry exit through results acknowledgement', () => {
    const { menu, doc, game, root, setScreen, view } = setup();
    try {
      const catalog = new GigCatalog(generateIsland({ resolution: 97 }));
      const director = new GigDirector(catalog);
      const offer = director.board('hoofington').offers.find(entry => entry.gigId === 'hay-haul')!;
      const contract = director.accept(offer.id);
      if (contract.config.kind !== 'hay-haul') throw new Error('Expected Hay Haul');
      const frame = { goat: { position: contract.start, size: 1 } };
      for (let i = 0; i < contract.maxTicks; i++) director.step(frame);
      const failed = director.active!;
      expect(failed.status).toBe('failed');
      const resultGame = Object.assign(game, {
        pendingGigResult: failed as GigRun | null, acknowledgeGigResult: vi.fn(),
      });
      Object.assign(game.gigs.director, { personalBests: [] });
      const gigs = Object.assign(game.gigs, {
        retryableOffer: offer as GigOffer | null,
        retryFailed: vi.fn(() => { resultGame.pendingGigResult = null; }),
      });
      setScreen('gig-results');
      expect(root.innerHTML).toContain('<strong>0 / ' + contract.config.required + '</strong><span>BALES DELIVERED</span>');
      expect(root.innerHTML).toContain('Time up');
      const retry = root.querySelector<ButtonStub>('[data-action="retry-gig"]')!;
      expect(retry).not.toBeNull();
      expect(doc.activeElement).toBe(retry);
      expect(root.querySelector('[data-action="play"]')).not.toBeNull();
      expect(root.querySelector('[data-action="title"]')).not.toBeNull();
      retry.click();
      expect(gigs.retryFailed).toHaveBeenCalledOnce();
      expect(resultGame.acknowledgeGigResult).toHaveBeenCalledOnce();
      expect(view.paused).toBe(false);

      resultGame.pendingGigResult = failed;
      gigs.retryableOffer = null;
      setScreen('gig-results');
      expect(root.querySelector('[data-action="retry-gig"]')).toBeNull();
      expect(root.innerHTML).toContain('BALES DELIVERED');
    } finally { menu.dispose(); }
  });

  it('names the owned Gold reward on a completed gig result', () => {
    const { menu, game, root, setScreen } = setup();
    try {
      const catalog = new GigCatalog(generateIsland({ resolution: 97 }));
      const director = new GigDirector(catalog);
      const setup = director.startPractice('demolition-contract', 'hard');
      if (setup.config.kind !== 'demolition-contract') throw new Error('Expected Demolition');
      const pieces = setup.config.pieces;
      director.step({
        goat: { position: setup.start, size: .6 },
        props: pieces.map(piece => ({
          id: piece.id, position: { ...piece.start, x: piece.start.x + 5 },
        })),
        abilities: [{ type: 'headbutt', targetId: pieces[0]!.id }],
      });
      const result = director.active!;
      expect(result.rating).toBe('gold');
      Object.assign(game, { pendingGigResult: result });
      Object.assign(game.gigs.director, { personalBests: director.personalBests, ownedCosmetics: director.ownedCosmetics });

      setScreen('gig-results');
      expect(root.innerHTML).toContain('<strong>GOLD REWARD</strong> · Safety Third Horns');

      result.rating = 'silver';
      setScreen('gig-results');
      expect(root.innerHTML).not.toContain('Safety Third Horns');
    } finally { menu.dispose(); }
  });

  it('keeps checkpoint names intact in results and requires a confirmed water landing', () => {
    const { menu, game, root, setScreen } = setup();
    try {
      const director = new GigDirector(new GigCatalog(generateIsland({ resolution: 97 })));
      Object.assign(game.gigs.director, { personalBests: [] });
      const round = director.startPractice('beacon-bleat', 'easy');
      for (let tick = 0; tick < round.maxTicks; tick++) {
        director.step({ goat: { position: round.start, size: .6 } });
      }
      const result = Object.assign(game, { pendingGigResult: director.active! });
      setScreen('gig-results');
      expect(root.innerHTML).toContain('<strong>0 / 2</strong><span>CHECKPOINTS</span>');

      const dive = director.startPractice('splash-dive', 'easy');
      for (let tick = 0; tick < dive.maxTicks; tick++) {
        director.step({ goat: { position: dive.start, size: .6 } });
      }
      result.pendingGigResult = director.active!;
      setScreen('gig-results');
      expect(root.innerHTML).toContain('<strong>MISSED</strong><span>WATER LANDING</span>');
    } finally { menu.dispose(); }
  });

  it('labels a simultaneous Rising Tide tie and shows survival without countdown time', () => {
    const { menu, doc, game, root, win, setScreen, view, resizeStandings } = setup();
    try {
      const match = readyMatch({ mode: 'rising-tide', config: {
        countdownTicks: 120, submergeTicks: 1,
      } }, ['player', 'bot-1', 'bot-2']);
      for (let i = 0; i < 120; i++) match.step();
      for (let i = 1; i <= 90; i++) {
        match.step(frame(goat('player', 0, 0, i === 90 ? -1 : 10),
          goat('bot-1', 0, 0, i === 90 ? -1 : 10),
          goat('bot-2', 0, 0, i === 30 ? -1 : 10)));
      }
      expect(match.phase).toBe('results');
      game.party.match = match;
      setScreen('party-results');
      const html = root.innerHTML;
      expect(html).toContain('YOU TIED FOR FIRST');
      expect(html.match(/>#1<\/strong>\s*<span class="gg-result-tie">TIE/g)).toHaveLength(2);
      expect(html).toMatch(/<li data-result-you>[^]*?<strong class="gg-result-you">YOU<\/strong>/);
      expect(html).toContain('1.5 s survived');
      expect(html).toContain('0.5 s survived');
      expect(html).toContain('Final tide 0 m');
      expect(html).not.toMatch(/\d+ pts/);
      expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="gg-party-result-title"/);
      expect(html).toMatch(/<\/ol>\s*<div class="gg-options">\s*<button[^>]*data-action="leave-party"/);

      const standings = root.querySelector('.gg-results')!;
      const panel = root.querySelector('.gg-shell-panel')!;
      const hint = root.querySelector('[data-results-scroll-hint]')!;
      const back = root.querySelector('[data-action="leave-party"]')!;
      const title = root.querySelector('[data-action="title"]')!;
      expect(doc.activeElement).toBe(back);
      expect(hint.hidden).toBe(true);
      expect(standings.tabIndex).toBe(-1);
      const idlePage = vi.fn();
      win.dispatch('keydown', { code: 'PageDown', repeat: false, preventDefault: idlePage });
      expect(idlePage).not.toHaveBeenCalled();

      standings.scrollHeight = 350;
      resizeStandings();
      expect(hint.hidden).toBe(false);
      expect(standings.tabIndex).toBe(0);
      for (const [code, scroll] of [['PageDown', 100], ['PageUp', 0]] as const) {
        const preventDefault = vi.fn();
        win.dispatch('keydown', { code, repeat: false, preventDefault });
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(standings.scrollTop).toBe(scroll);
        expect(panel.scrollTop).toBe(0);
        expect(doc.activeElement).toBe(back);
      }
      vi.stubGlobal('navigator', { getGamepads: () => [
        { connected: true, buttons: [], axes: [0, 0, 0, .5] },
      ] });
      view.onFrame?.();
      expect(standings.scrollTop).toBe(7);
      expect(panel.scrollTop).toBe(0);

      title.focus();
      const tabDefault = vi.fn();
      win.dispatch('keydown', { code: 'Tab', preventDefault: tabDefault });
      expect(tabDefault).toHaveBeenCalledOnce();
      expect(doc.activeElement).toBe(standings);
      standings.clientHeight = standings.scrollHeight;
      resizeStandings();
      expect(hint.hidden).toBe(true);
      expect(standings.tabIndex).toBe(-1);
      expect(doc.activeElement).toBe(back);
      win.dispatch('keydown', { code: 'ArrowDown', repeat: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(doc.activeElement).toBe(title);
      win.dispatch('keydown', { code: 'Escape', repeat: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(game.party.returnToFreeRoam).toHaveBeenCalledOnce();
    } finally { menu.dispose(); }
  });

  it('shows the final perch for Rising Tide survivors with the same survival time', () => {
    const { menu, game, root, setScreen } = setup();
    try {
      const match = readyMatch({ mode: 'rising-tide', config: {
        durationTicks: 60, overtimeTicks: 60,
      } }, ['player', 'bot-1']);
      for (let i = 0; i < 120; i++) {
        match.step(frame(goat('player', 0, 0, 7.5), goat('bot-1', 0, 0, 9.25)));
      }
      expect(match.phase).toBe('results');
      game.party.match = match;
      setScreen('party-results');
      expect(root.innerHTML).toContain('YOU PLACED #2');
      expect(root.innerHTML.match(/2.0 s survived/g)).toHaveLength(3);
      expect(root.innerHTML).toContain('7.50 m final head height');
      expect(root.innerHTML).toContain('9.25 m final head height');
      expect(root.innerHTML).not.toContain('TIE</span>');
    } finally { menu.dispose(); }
  });

  it('shows real Peak points and who held the summit at the finish', () => {
    const { menu, game, root, setScreen } = setup();
    try {
      const match = readyMatch({ mode: 'king-of-the-peak', config: {
        peakTargetScore: 5, peakPointsPerSecond: 5,
      } }, ['player', 'bot-1']);
      for (let i = 0; i < 60; i++) {
        match.step(frame(goat('player'), goat('bot-1', 40, 0)));
      }
      expect(match.phase).toBe('results');
      game.party.match = match;
      game.party.title = 'King of the Peak';
      setScreen('party-results');
      expect(root.innerHTML).toContain('YOU WON');
      expect(root.innerHTML).toContain('5 peak points · Round time 1.0 s');
      expect(root.innerHTML.match(/Held summit at finish/g)).toHaveLength(1);
      expect(root.innerHTML).toContain('0 peak points');
      expect(root.innerHTML).not.toContain('TIE</span>');
    } finally { menu.dispose(); }
  });

  it('uses Hay Heist team deliveries and distinguishes teammates from tied teams', () => {
    const { menu, game, root, setScreen } = setup();
    const ids = ['player', 'bot-1', 'bot-2'];
    try {
      const match = readyMatch({ mode: 'hay-heist', config: {
        hayPerTeam: 1, hayTargetScore: 1,
      } }, ids);
      const blueBale = match.bales.find(bale => bale.homeTeam === 'blue')!.position;
      const redBarn = match.view().arena.barns.find(barn => barn.teamId === 'red')!.position;
      const bots = [goat('bot-1'), goat('bot-2')];
      match.step({ ...frame(goat('player', blueBale.x, blueBale.z), ...bots),
        intents: { player: { tongue: true } } });
      match.step({ ...frame(goat('player', redBarn.x, redBarn.z), ...bots),
        intents: { player: { tongue: true } } });
      expect(match.phase).toBe('results');
      expect(match.placements.map(place => place.rank)).toEqual([1, 1, 2]);
      game.party.match = match;
      game.party.title = 'Hay Heist';
      setScreen('party-results');
      expect(root.innerHTML).toContain('YOUR TEAM WON');
      expect(root.innerHTML).toMatch(/<li data-result-you>[^]*?RED TEAM[^]*?YOU/);
      expect(root.innerHTML).toContain('1 bale delivered');
      expect(root.innerHTML).toContain('0 bales delivered');
      expect(root.innerHTML).not.toContain('TIE</span>');
      expect(root.innerHTML.match(/<li/g)).toHaveLength(2);

      const tied = readyMatch({ mode: 'hay-heist', config: {
        durationTicks: 1, overtimeTicks: 1,
      } }, ids);
      for (let i = 0; i < 2; i++) tied.step(frame(goat('player'), ...bots));
      expect(tied.phase).toBe('results');
      game.party.match = tied;
      setScreen('party-results');
      expect(root.innerHTML).toContain('YOUR TEAM TIED FOR FIRST');
      expect(root.innerHTML.match(/>#1<\/strong>\s*<span class="gg-result-tie">TIE/g)).toHaveLength(2);
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
