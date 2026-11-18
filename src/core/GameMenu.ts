import type { Game } from './Game';
import type { GameView } from './GameView';
import type { GameAudio } from './GameAudio';
import { saveGame, type GameSettings } from './Persistence';
import type { ModeId, Difficulty as BotDifficulty } from '../modes';
import type { PoiId } from '../world';
import { HUD_SPRITES, hudSpriteImage } from './HudSprites';
import { MENU_SPRITES, menuSkin, menuSpriteUrl, type MenuSpriteName } from './MenuSprites';

type Screen = 'title' | 'playing' | 'pause' | 'party' | 'settings' |
  'board' | 'gig-results' | 'party-results';
const CSS = `
/* The frame, stat cards, tabs and action buttons are nine-sliced sprite PNGs.
   Text and interactive values remain real HTML above the art. */
.gg-shell{position:absolute;inset:0;z-index:15;display:grid;place-items:center;
  padding:12px;background:linear-gradient(120deg,#121632bf,#242044c4 66%,#16182fc4);
  font:900 15px/1.3 "Trebuchet MS","Arial Rounded MT Bold","Arial Black",system-ui,sans-serif;
  color:#fff4d6;text-shadow:1px 2px 1px #42304a,0 3px 3px #2c2148ad;
  -webkit-font-smoothing:antialiased}
.gg-shell *{box-sizing:border-box}
.gg-shell [hidden]{display:none!important}
.gg-shell-panel{position:relative;width:min(610px,100%);max-height:calc(100dvh - 24px);
  min-width:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;
  padding:clamp(10px,2.5vw,22px) clamp(13px,3vw,26px);
  border:27px solid transparent;border-image:var(--gg-sprite) 62 fill / 27px / 0 stretch;
  background:transparent;filter:drop-shadow(0 11px 1px #17132aa0) drop-shadow(0 24px 32px #1111269a)}
.gg-shell-eyebrow{font-size:11px;letter-spacing:2.2px;color:#a8e0ff;text-transform:uppercase}
.gg-shell h1{font-size:clamp(42px,7vw,69px);color:#ffdc40;line-height:.94;
  margin:8px 0 16px;font-weight:1000;letter-spacing:-2px;-webkit-text-stroke:1px #954931;
  text-shadow:2px 3px 0 #9b4a35,4px 6px 0 #643a95}
.gg-shell h2{font-size:clamp(27px,5vw,43px);line-height:1.05;color:#ffdc40;
  margin:7px 0 13px;letter-spacing:-.6px;text-shadow:2px 3px #673884}
.gg-shell p{margin:7px 0 15px;font-size:14px;line-height:1.44;color:#fff0e6}
.gg-shell .gg-options{display:grid;gap:7px}
.gg-shell button,.gg-shell select,.gg-shell input{font:inherit}
.gg-shell button{cursor:pointer;font-weight:1000;touch-action:manipulation}
.gg-shell .gg-art-button{display:flex;align-items:center;width:100%;min-height:68px;
  padding:5px 16px;border:18px solid transparent;
  border-image:var(--gg-sprite) 42 fill / 18px / 0 stretch;background:transparent;
  color:#fff9e4;text-align:left;font-size:clamp(13px,1.45vw,17px);letter-spacing:.3px;
  text-shadow:1px 2px 0 #493277;transition:transform .09s}
.gg-shell .gg-art-button.gg-primary{color:#432d28;text-shadow:0 1px #fff1b7}
.gg-shell .gg-art-button:active{transform:translateY(2px) scale(.99)}
.gg-shell button:focus-visible,.gg-shell select:focus-visible,
.gg-shell input:focus-visible{outline:3px solid #ffe44b;outline-offset:2px}
.gg-shell .gg-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0 18px}
.gg-shell label{display:grid;gap:7px;font-size:12px;letter-spacing:.7px}
.gg-shell select{width:100%;min-width:0;min-height:48px;color:#fff3da;
  border:12px solid transparent;border-image:var(--gg-sprite) 52 fill / 12px / 0 stretch;
  background:#302250;accent-color:#ffe248;padding:2px 5px}
.gg-shell select option{background:#302250;color:#fff4d6}
.gg-shell label.gg-select-label{position:relative}
.gg-shell label.gg-select-label::after{content:"▾";position:absolute;right:15px;
  bottom:12px;color:#ffe257;font-size:17px;pointer-events:none;text-shadow:1px 1px #45243f}
.gg-shell .gg-range{display:flex;align-items:center;gap:13px}
.gg-shell input.gg-slider{appearance:none;-webkit-appearance:none;flex:1;min-width:0;
  height:29px;border:3px solid #b87437;border-radius:30px;cursor:pointer;
  background:linear-gradient(90deg,#96f62c 0 var(--gg-pct),#48303f var(--gg-pct) 100%);
  box-shadow:inset 0 2px 4px #261821,0 0 0 2px #f7c875}
.gg-shell input.gg-slider::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;
  width:42px;height:42px;border:0;background:var(--gg-sprite) 56.6% center/380px 42px no-repeat;
  filter:drop-shadow(0 2px 1px #31203c)}
.gg-shell input.gg-slider::-moz-range-thumb{width:42px;height:42px;border:0;
  background:var(--gg-sprite) 56.6% center/380px 42px no-repeat}
.gg-shell output{min-width:52px;text-align:right;color:#ffe153;font-size:15px;font-variant-numeric:tabular-nums}
.gg-shell .gg-offer{border:2px solid #b794a466;padding:10px;border-radius:14px;margin:9px 0;background:#151b38a6}
.gg-shell .gg-offer strong{color:#ffdb40;font-size:19px}
.gg-shell .gg-offer p{margin:4px 0 10px}
.gg-shell .gg-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:18px 0}
.gg-shell .gg-stat{display:flex;flex-direction:column;justify-content:center;align-items:center;
  min-width:0;min-height:90px;padding:3px 5px;border:14px solid transparent;
  border-image:var(--gg-sprite) 48 fill / 14px / 0 stretch;text-align:center;
  color:#fff3db;font-size:clamp(9px,1.05vw,12px)}
.gg-shell .gg-stat-line{display:flex;gap:3px;align-items:center;justify-content:center}
.gg-shell .gg-stat strong{display:block;color:#ffe147;font-size:clamp(17px,2.1vw,24px);line-height:1.1}
.gg-shell .gg-stat-coin{width:26px;height:26px;object-fit:contain}
.gg-shell .gg-results{list-style:none;margin:8px 0 20px;padding:0;max-height:34vh;overflow:auto}
.gg-shell .gg-results li{display:flex;justify-content:space-between;padding:7px 10px;margin:4px 0;
  border-radius:8px;background:#ffffff19}
.gg-shell footer{margin-top:14px;color:#e0cfea;font-size:10px;line-height:1.6}
.gg-shell .gg-settings-head{display:flex;align-items:start;justify-content:space-between;gap:12px}
.gg-shell .gg-icon-button{display:grid;place-items:center;flex:0 0 auto;
  width:53px;height:53px;border:0;padding:0;color:#fff7df;
  background:var(--gg-sprite) center/contain no-repeat;transition:transform .08s}
.gg-shell .gg-icon-button:hover{transform:scale(1.06)}
.gg-shell .gg-icon-button:active{transform:scale(.96)}
.gg-shell .gg-settings-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:3px;margin:1px 0 13px}
.gg-shell .gg-tab{display:grid;place-items:end center;min-width:0;min-height:62px;
  padding:9px 2px 6px;border:17px solid transparent;
  border-image:var(--gg-sprite) 47 fill / 17px / 0 stretch;
  background:transparent;color:#fff5df;text-shadow:1px 2px #6f3d30;
  font-size:clamp(10px,1.15vw,13px);letter-spacing:.2px}
.gg-shell .gg-tab[aria-selected="true"]{color:#4c2b1a;text-shadow:0 1px #ffe39c}
.gg-shell .gg-tab>span{display:block;transform:translateY(8px);pointer-events:none}
.gg-shell .gg-settings-content{min-height:210px;padding:4px 2px}
.gg-shell .gg-settings-content>.gg-setting{margin:0 0 20px}
.gg-shell .gg-setting-row{display:flex;align-items:center;justify-content:space-between;
  min-height:64px;gap:14px;margin-bottom:16px;font-size:13px;letter-spacing:.7px}
.gg-shell .gg-switch{flex:0 0 auto;width:106px;height:54px;padding:0;border:0;
  background:var(--gg-sprite) center/100% 100% no-repeat}
.gg-shell .gg-check{flex:0 0 auto;width:48px;height:48px;padding:0;border:0;
  background:var(--gg-sprite) center/100% 100% no-repeat}
.gg-shell .gg-settings-bottom{display:flex;align-items:center;gap:12px;margin-top:7px}
.gg-shell .gg-settings-bottom span{font-size:11px;line-height:1.4;color:#dfd0e8}
.gg-shell .gg-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap}
@media(max-width:510px){
 .gg-shell{padding:6px}
 .gg-shell-panel{width:100%;max-height:calc(100dvh - 12px);border-width:20px;
   border-image-width:20px;padding:8px 10px}
 .gg-shell h1{font-size:44px}
 .gg-shell .gg-grid{grid-template-columns:1fr;gap:7px}
 .gg-shell .gg-stats{gap:2px}
 .gg-shell .gg-stat{min-height:79px;border-width:10px;border-image-width:10px}
 .gg-shell .gg-stat-coin{width:20px;height:20px}
 .gg-shell .gg-art-button{min-height:59px;font-size:13px}
 .gg-shell footer{font-size:9px}
 .gg-shell .gg-tab{min-height:54px;border-width:13px;border-image-width:13px}
}
`;
const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const menuButton = (action: string, label: string, primary = false): string => {
  const normal = primary ? MENU_SPRITES.yellowNormal : MENU_SPRITES.purpleNormal;
  const hover = primary ? MENU_SPRITES.yellowHover : MENU_SPRITES.purpleHover;
  const pressed = primary ? MENU_SPRITES.yellowPressed : MENU_SPRITES.purplePressed;
  return `<button type="button" data-action="${action}" class="gg-art-button ${primary ? 'gg-primary' : ''}"` +
    ` ${menuSkin(normal)} data-sprite-normal="${normal}" data-sprite-hover="${hover}"` +
    ` data-sprite-pressed="${pressed}"><span>${label}</span></button>`;
};
const iconButton = (name: MenuSpriteName, label: string): string =>
  `<button type="button" data-action="back" class="gg-icon-button" aria-label="${label}"` +
  ` title="${label}" ${menuSkin(name)}><span class="gg-visually-hidden">${label}</span></button>`;
type SettingsTab = 'controls' | 'video' | 'audio';
const SETTINGS_TABS: readonly SettingsTab[] = ['controls', 'video', 'audio'];
const nice = (value: string): string => value.replace(/-/g, ' ').toUpperCase();

export class GameMenu {
  readonly root = document.createElement('div');
  private readonly style = document.createElement('style');
  private screen: Screen = 'title';
  private settingsReturn: Screen = 'title';
  private settingsTab: SettingsTab = 'controls';
  private partyReturn: Screen = 'title';
  private boardPoi: PoiId | null = null;
  private mode: ModeId = 'rising-tide';
  private botCount = 3;
  private difficulty: BotDifficulty = 'normal';
  private lastGigAttempt = 0;
  private lastSavedTick = 0;
  private padDirection = 0;
  private padHorizontal = 0;
  private padAccept = false;
  private padBack = false;
  private padMenu = false;
  private readonly keyHandler: (e: KeyboardEvent) => void;
  private readonly pageHide: () => void;
  private readonly fullscreenChange: () => void;
  private readonly pointerLockChange: () => void;
  private wasPointerLocked = false;
  private pointerLockNeedsUserRequest = false;

  constructor(private readonly host: HTMLElement, private readonly game: Game,
    private readonly view: GameView, public settings: GameSettings,
    private readonly audio?: GameAudio) {
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root.className = 'gg-shell';
    this.root.setAttribute('aria-label', 'Gigga-Goat menus');
    host.appendChild(this.root);
    this.root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const tab = target.closest<HTMLButtonElement>('[data-tab]');
      if (tab) {
        this.settingsTab = tab.dataset.tab as SettingsTab;
        this.render();
        this.root.querySelector<HTMLButtonElement>('[data-tab="' + this.settingsTab + '"]')?.focus();
        return;
      }
      const toggle = target.closest<HTMLButtonElement>('[data-setting-toggle]');
      if (toggle) {
        this.settings.invertY = !this.settings.invertY;
        this.view.applySettings(this.settings);
        this.audio?.queueCue({ sound: 'ui-click' });
        this.save();
        this.render();
        this.root.querySelector<HTMLButtonElement>('[data-setting-toggle]')?.focus();
        return;
      }
      if (target.closest('[data-fullscreen]')) {
        void this.toggleFullscreen();
        return;
      }
      const button = target.closest<HTMLButtonElement>('[data-action]');
      if (button) this.action(button.dataset.action ?? '');
    });
    // Pointer, native keyboard focus, and gamepad .focus() all use the same PNG states.
    this.root.addEventListener('focusin', event =>
      this.swapButtonSprite(this.spriteButton(event.target), 'hover'));
    this.root.addEventListener('focusout', event => {
      const button = this.spriteButton(event.target);
      this.swapButtonSprite(button, button?.matches(':hover') ? 'hover' : 'normal');
    });
    this.root.addEventListener('pointerover', event =>
      this.swapButtonSprite(this.spriteButton(event.target), 'hover'));
    this.root.addEventListener('pointerout', event => {
      const button = this.spriteButton(event.target);
      if (button && !button.contains(event.relatedTarget as Node | null))
        this.swapButtonSprite(button, document.activeElement === button ? 'hover' : 'normal');
    });
    this.root.addEventListener('pointerdown', event =>
      this.swapButtonSprite(this.spriteButton(event.target), 'pressed'));
    for (const name of ['pointerup', 'pointercancel'] as const) {
      this.root.addEventListener(name, event => {
        const button = this.spriteButton(event.target);
        this.swapButtonSprite(button, button?.matches(':hover') || document.activeElement === button ?
          'hover' : 'normal');
      });
    }
    this.root.addEventListener('keydown', event => {
      if (event.code === 'Enter' || event.code === 'Space')
        this.swapButtonSprite(this.spriteButton(event.target), 'pressed');
    });
    this.root.addEventListener('keyup', event => {
      if (event.code === 'Enter' || event.code === 'Space')
        this.swapButtonSprite(this.spriteButton(event.target), 'hover');
    });
    this.root.addEventListener('change', event => {
      const element = event.target as HTMLInputElement | HTMLSelectElement;
      if (element.id === 'gg-mode') this.mode = element.value as ModeId;
      if (element.id === 'gg-bots') this.botCount = Number(element.value);
      if (element.id === 'gg-difficulty') this.difficulty = element.value as BotDifficulty;
      this.editSetting(element);
    });
    this.root.addEventListener('input', event =>
      this.editSetting(event.target as HTMLInputElement));
    this.keyHandler = event => this.onKey(event);
    window.addEventListener('keydown', this.keyHandler, true);
    this.pageHide = () => { this.save(); };
    window.addEventListener('pagehide', this.pageHide);
    this.fullscreenChange = () => this.syncFullscreen();
    document.addEventListener('fullscreenchange', this.fullscreenChange);
    // Escape is consumed by Chrome when it first releases pointer lock, so its
    // keydown event may never reach onKey. Still pause when the player unlocks.
    this.pointerLockChange = () => {
      // Remember locks acquired during gameplay only. An asynchronous unlock
      // from the gig board or another overlay must never pause a newly resumed game.
      if (this.screen !== 'playing') {
        this.wasPointerLocked = false;
        return;
      }
      const locked = document.pointerLockElement === this.view.renderer.domElement;
      if (this.wasPointerLocked && !locked) {
        this.pointerLockNeedsUserRequest = true;
        this.setScreen('pause');
      }
      if (locked) this.pointerLockNeedsUserRequest = false;
      this.wasPointerLocked = locked;
    };
    document.addEventListener('pointerlockchange', this.pointerLockChange);
    this.view.onFrame = () => this.frame();
    this.view.onInteract = () => this.interact();
    this.view.applySettings(settings);
    this.audio?.setVolumes(settings);
    this.setScreen('title');
  }

  private save(): void { saveGame(this.game, this.settings); }
  private setScreen(next: Screen): void {
    this.screen = next;
    // Leaving gameplay intentionally can asynchronously release pointer lock.
    // Forget that lock before a later menu action resumes the game.
    if (next !== 'playing') {
      this.wasPointerLocked = false;
      if (document.pointerLockElement === this.view.renderer.domElement) {
        this.pointerLockNeedsUserRequest = true;
      }
    }
    this.view.paused = next !== 'playing';
    this.audio?.setPaused(this.view.paused || !!document.hidden);
    this.view.input.setActive(next === 'playing');
    this.view.hud.setVisible(next === 'playing');
    if (next !== 'playing' && document.pointerLockElement === this.view.renderer.domElement) {
      document.exitPointerLock();
    }
    this.render();
  }
  private resume(): void {
    this.setScreen('playing');
    // Chrome rejects immediate pointer-lock reacquisition after Escape with a
    // SecurityError. Resume with unlocked mouse look so C can request capture.
    if (!this.pointerLockNeedsUserRequest) {
      void this.view.input.requestPointerLock();
    }
  }
  private action(key: string): void {
    if (key !== 'back') this.audio?.queueCue({ sound: key === 'pause' ? 'ui-back' : 'ui-confirm' });
    if (key === 'play') {
      this.view.alignCameraForPlay();
      this.resume();
    } else if (key === 'resume') this.resume();
    else if (key === 'pause') this.setScreen('pause');
    else if (key === 'title') {
      this.game.party.returnToFreeRoam();
      this.game.gigs.abandon();
      this.save();
      this.setScreen('title');
    } else if (key === 'party') {
      this.partyReturn = this.screen;
      this.setScreen('party');
    } else if (key === 'settings') {
      this.settingsReturn = this.screen;
      this.settingsTab = 'controls';
      this.setScreen('settings');
    } else if (key === 'back') this.back();
    else if (key === 'start-party') {
      try {
        this.game.party.start(this.mode, this.botCount, this.difficulty);
        this.view.alignCameraForPlay();
        this.resume();
      } catch (error) { this.error(error); }
    } else if (key.startsWith('offer:')) {
      try {
        this.game.gigs.accept(key.slice(6));
        this.save();
        this.resume();
      } catch (error) { this.error(error); }
    } else if (key === 'leave-party') {
      this.game.party.returnToFreeRoam();
      this.save();
      this.resume();
    } else if (key === 'abandon-gig') {
      this.game.gigs.abandon();
      this.save();
      this.resume();
    }
  }
  private error(error: unknown): void {
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = error instanceof Error ? error.message : 'Action unavailable';
    this.root.querySelector('.gg-shell-panel')?.prepend(message);
  }
  private back(): void {
    if (this.screen === 'title') return;
    this.audio?.queueCue({ sound: 'ui-back' });
    if (this.screen === 'party') this.setScreen(this.partyReturn);
    else if (this.screen === 'settings') this.setScreen(this.settingsReturn);
    else if (this.screen === 'board') this.resume();
    else if (this.screen === 'pause') this.resume();
    else if (this.screen === 'gig-results') this.resume();
    else if (this.screen === 'party-results') this.action('leave-party');
    else this.setScreen('title');
  }
  private onKey(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.screen === 'playing') this.setScreen('pause');
      else this.back();
      return;
    }
    if (this.screen === 'playing') {
      if (event.code === 'KeyP' && !this.game.party.match) {
        event.preventDefault(); this.action('party');
      }
      return;
    }
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && focused.type === 'range') return;
      if (focused instanceof HTMLSelectElement) return;
      event.preventDefault();
      this.navigate(event.code === 'ArrowDown' ? 1 : -1);
    } else if (this.screen === 'settings' &&
      (event.code === 'ArrowLeft' || event.code === 'ArrowRight') &&
      document.activeElement instanceof HTMLButtonElement &&
      document.activeElement.dataset.tab) {
      event.preventDefault();
      this.adjustFocused(event.code === 'ArrowRight' ? 1 : -1);
    }
  }
  private navigate(direction: number): void {
    const items = [...this.root.querySelectorAll<HTMLElement>('button,select,input')];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    items[(current + direction + items.length) % items.length]!.focus();
  }
  /** D-pad / stick left and right edit tabs, native selects and ranges without a mouse. */
  private adjustFocused(direction: number): boolean {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && active.dataset.tab) {
      const current = SETTINGS_TABS.indexOf(active.dataset.tab as SettingsTab);
      this.settingsTab = SETTINGS_TABS[(current + direction + SETTINGS_TABS.length) %
        SETTINGS_TABS.length]!;
      this.render();
      this.root.querySelector<HTMLButtonElement>('[data-tab="' + this.settingsTab + '"]')?.focus();
      return true;
    }
    if (active instanceof HTMLSelectElement) {
      active.selectedIndex = (active.selectedIndex + direction + active.options.length) %
        active.options.length;
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (active instanceof HTMLInputElement && active.type === 'range') {
      const step = Number(active.step) || 1;
      const min = Number(active.min), max = Number(active.max);
      active.value = String(Math.max(min, Math.min(max,
        Math.round((Number(active.value) + direction * step - min) / step) * step + min)));
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  }

  /** Only buttons with three artwork states swap; toggles and icon buttons stay stateful. */
  private spriteButton(target: EventTarget | null): HTMLButtonElement | null {
    return (target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-sprite-normal]') ?? null;
  }
  private swapButtonSprite(button: HTMLButtonElement | null,
    state: 'normal' | 'hover' | 'pressed'): void {
    if (!button) return;
    const name = button.dataset[state === 'normal' ? 'spriteNormal' :
      state === 'hover' ? 'spriteHover' : 'spritePressed'] as MenuSpriteName | undefined;
    if (!name) return;
    button.dataset.sprite = name;
    button.style.setProperty('--gg-sprite', "url('" + menuSpriteUrl(name) + "')");
  }
  private syncFullscreen(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-fullscreen]');
    if (!button) return;
    const enabled = !!document.fullscreenElement;
    const name = enabled ? MENU_SPRITES.checkboxChecked : MENU_SPRITES.checkboxEmpty;
    button.setAttribute('aria-checked', String(enabled));
    button.dataset.sprite = name;
    button.style.setProperty('--gg-sprite', "url('" + menuSpriteUrl(name) + "')");
  }
  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) { this.error(error); }
    this.syncFullscreen();
  }

  private editSetting(element: HTMLInputElement | HTMLSelectElement): void {
    if (!element.id.startsWith('gg-setting-')) return;
    const key = element.id.slice('gg-setting-'.length);
    if (key === 'mouseSensitivity') this.settings.mouseSensitivity = Number(element.value);
    else if (key === 'fov') this.settings.fov = Number(element.value);
    else if (key === 'volume') this.settings.volume = Number(element.value);
    else if (key === 'musicVolume') this.settings.musicVolume = Number(element.value);
    else if (key === 'effectsVolume') this.settings.effectsVolume = Number(element.value);
    else if (key === 'invertY') this.settings.invertY = element.value === 'yes';
    else if (key === 'graphics') this.settings.graphics = element.value as GameSettings['graphics'];
    const isVolume = key === 'volume' || key === 'musicVolume' || key === 'effectsVolume';
    if (element instanceof HTMLInputElement && element.type === 'range') {
      const min = Number(element.min), max = Number(element.max);
      element.style.setProperty('--gg-pct', ((Number(element.value) - min) /
        (max - min) * 100) + '%');
    }
    const output = element.parentElement?.querySelector<HTMLOutputElement>('output');
    if (output) output.textContent = isVolume ? Math.round(Number(element.value) * 100) + '%' :
      key === 'fov' ? this.settings.fov + '°' : this.settings.mouseSensitivity.toFixed(2) + '×';
    this.view.applySettings(this.settings);
    if (isVolume) this.audio?.setVolumes(this.settings);
    this.audio?.queueCue({ sound: 'ui-click' });
    this.save();
  }
  private interact(): boolean {
    if (this.screen !== 'playing') return false;
    const poi = this.game.gigs.nearBoard();
    if (!poi) return false;
    this.boardPoi = poi;
    this.setScreen('board');
    return true;
  }
  /** Called once per render frame for menu pad navigation and terminal result transitions. */
  private frame(): void {
    const pad = navigator.getGamepads?.().find(p => p?.connected);
    if (pad) {
      const buttons = pad.buttons;
      const dir = buttons[13]?.pressed || (pad.axes[1] ?? 0) > .6 ? 1 :
        buttons[12]?.pressed || (pad.axes[1] ?? 0) < -.6 ? -1 : 0;
      const horizontal = buttons[15]?.pressed || (pad.axes[0] ?? 0) > .65 ? 1 :
        buttons[14]?.pressed || (pad.axes[0] ?? 0) < -.65 ? -1 : 0;
      const select = !!buttons[0]?.pressed;
      const back = !!buttons[1]?.pressed;
      const menu = !!buttons[9]?.pressed;
      if (menu && !this.padMenu) {
        if (this.screen === 'playing') this.setScreen('pause'); else this.back();
      }
      if (this.screen !== 'playing') {
        if (dir && dir !== this.padDirection) this.navigate(dir);
        if (horizontal && horizontal !== this.padHorizontal) this.adjustFocused(horizontal);
        if (select && !this.padAccept) {
          const active = document.activeElement as HTMLElement;
          if (this.root.contains(active)) {
            if (active instanceof HTMLButtonElement && active.dataset.tab) active.click();
            else if (!this.adjustFocused(1)) active.click();
          } else this.root.querySelector<HTMLButtonElement>('button')?.click();
        }
        if (back && !this.padBack) this.back();
      }
      this.padDirection = dir; this.padHorizontal = horizontal; this.padAccept = select;
      this.padBack = back; this.padMenu = menu;
    } else {
      this.padDirection = 0; this.padHorizontal = 0;
      this.padAccept = false; this.padBack = false; this.padMenu = false;
    }
    if (this.screen === 'playing' && this.game.party.match?.phase === 'results') {
      this.setScreen('party-results');
    }
    const gig = this.game.gigs.active;
    if (this.screen === 'playing' && gig &&
      (gig.status === 'completed' || gig.status === 'failed') &&
      gig.attemptId !== this.lastGigAttempt) {
      this.lastGigAttempt = gig.attemptId;
      this.save();
      this.setScreen('gig-results');
    }
    if (this.game.physics.stepCount - this.lastSavedTick >= 600) {
      this.lastSavedTick = this.game.physics.stepCount;
      this.save();
    }
  }
  private titleBody(): string {
    return `<div class="gg-shell-eyebrow">BILLY ISLE · AN OPEN WORLD OF BAD IDEAS</div>
      <h1>GIGGA<br>GOAT!</h1>
      <p>Cause chaos. Grow huge. Pick up paid gigs. Or challenge seven other goats while the tide climbs.</p>
      <div class="gg-stats">
        <div class="gg-stat" ${menuSkin(MENU_SPRITES.stat)}>
          <div class="gg-stat-line">${hudSpriteImage(HUD_SPRITES.cudCoin, 'gg-stat-coin')}<strong>${this.game.rules.wallet.coins}</strong></div>
          <span>CUD COINS</span></div>
        <div class="gg-stat" ${menuSkin(MENU_SPRITES.stat)}>
          <strong>${this.game.gigs.director.ownedCosmetics.length}</strong><span>GIG GEAR</span></div>
        <div class="gg-stat" ${menuSkin(MENU_SPRITES.stat)}>
          <strong>3</strong><span>PARTY MODES</span></div>
      </div>
      <div class="gg-options">${menuButton('play','▶ PLAY · FREE ROAM',true)}
      ${menuButton('party','⚡ PARTY MODES')}
      ${menuButton('settings','⚙ SETTINGS')}</div>
      <footer>WASD or arrows move · Mouse or IJKL look · C capture mouse · Space jump · E job boards · P party · Esc pause</footer>`;
  }
  private partyBody(): string {
    return `<div class="gg-shell-eyebrow">SOLO VS PHYSICS-DRIVEN BOTS</div><h2>START A PARTY</h2>
      <p>Everyone gets the same moves. Outsmart the bots, stay above the tide and claim the top spot.</p>
      <div class="gg-grid">
      <label class="gg-select-label">ROUND<select id="gg-mode" ${menuSkin(MENU_SPRITES.stat)}>
        <option value="rising-tide" ${this.mode==='rising-tide'?'selected':''}>Rising Tide · survive</option>
        <option value="king-of-the-peak" ${this.mode==='king-of-the-peak'?'selected':''}>King of the Peak · capture</option>
        <option value="hay-heist" ${this.mode==='hay-heist'?'selected':''}>Hay Heist · steal hay</option>
      </select></label>
      <label class="gg-select-label">BOT GOATS<select id="gg-bots" ${menuSkin(MENU_SPRITES.stat)}>
        ${[3,4,5,6,7].map(n=>`<option value="${n}" ${n===this.botCount?'selected':''}>${n} bots</option>`).join('')}
      </select></label>
      <label class="gg-select-label">BOT SKILL<select id="gg-difficulty" ${menuSkin(MENU_SPRITES.stat)}>
        <option value="easy" ${this.difficulty==='easy'?'selected':''}>Easy · chill</option>
        <option value="normal" ${this.difficulty==='normal'?'selected':''}>Normal · lively</option>
        <option value="hard" ${this.difficulty==='hard'?'selected':''}>Hard · ruthless</option>
      </select></label></div>
      <div class="gg-options">${menuButton('start-party','⚡ LAUNCH ROUND',true)}
      ${menuButton('back','← BACK')}</div>`;
  }
  private settingsBody(): string {
    const s = this.settings;
    const slider = (key: string, label: string, min: number, max: number, step: number,
      value: number, output: string): string => {
      const pct = ((value - min) / (max - min) * 100).toFixed(2);
      return `<label class="gg-setting">${label}<div class="gg-range">` +
        `<input class="gg-slider" id="gg-setting-${key}" type="range" min="${min}" max="${max}"` +
        ` step="${step}" value="${value}" ${menuSkin(MENU_SPRITES.slider, '--gg-pct:' + pct + '%;')}>` +
        `<output for="gg-setting-${key}">${output}</output></div></label>`;
    };
    const tabs = SETTINGS_TABS.map((tab, index) => {
      const selected = tab === this.settingsTab;
      const normal = selected ? MENU_SPRITES.tabGold :
        index === 0 ? MENU_SPRITES.tabBrown : MENU_SPRITES.tabPurple;
      return `<button type="button" role="tab" id="gg-tab-${tab}" data-tab="${tab}"` +
        ` aria-selected="${selected}" aria-controls="gg-settings-panel" class="gg-tab"` +
        ` ${menuSkin(normal)} data-sprite-normal="${normal}"` +
        ` data-sprite-hover="${MENU_SPRITES.tabGold}" data-sprite-pressed="${MENU_SPRITES.tabGold}">` +
        `<span>${nice(tab)}</span></button>`;
    }).join('');
    const controls = slider('mouseSensitivity', 'MOUSE SENSITIVITY', .25, 3, .05,
      s.mouseSensitivity, s.mouseSensitivity.toFixed(2) + '×') +
      `<div class="gg-setting-row"><span id="gg-invert-label">INVERT CAMERA Y</span>` +
      `<button type="button" class="gg-switch" role="switch" aria-labelledby="gg-invert-label"` +
      ` aria-checked="${s.invertY}" data-setting-toggle="invertY"` +
      ` ${menuSkin(s.invertY ? MENU_SPRITES.toggleOn : MENU_SPRITES.toggleOff)}>` +
      `<span class="gg-visually-hidden">${s.invertY ? 'On' : 'Off'}</span></button></div>`;
    const video = slider('fov', 'FIELD OF VIEW', 55, 95, 1, s.fov, s.fov + '°') +
      `<label class="gg-setting gg-select-label">GRAPHICS QUALITY<select id="gg-setting-graphics"` +
      ` ${menuSkin(MENU_SPRITES.stat)}>` +
      (['low', 'medium', 'high'] as const).map(q =>
        `<option value="${q}" ${s.graphics === q ? 'selected' : ''}>${nice(q)}</option>`).join('') +
      `</select></label>` +
      `<div class="gg-setting-row"><span id="gg-fullscreen-label">FULLSCREEN</span>` +
      `<button type="button" class="gg-check" role="checkbox" data-fullscreen` +
      ` aria-labelledby="gg-fullscreen-label" aria-checked="${!!document.fullscreenElement}"` +
      ` ${menuSkin(document.fullscreenElement ? MENU_SPRITES.checkboxChecked : MENU_SPRITES.checkboxEmpty)}>` +
      `<span class="gg-visually-hidden">Toggle fullscreen</span></button></div>`;
    const audio = slider('volume', 'MASTER VOLUME', 0, 1, .05, s.volume,
      Math.round(s.volume * 100) + '%') +
      slider('musicVolume', 'MUSIC VOLUME', 0, 1, .05, s.musicVolume,
        Math.round(s.musicVolume * 100) + '%') +
      slider('effectsVolume', 'EFFECTS VOLUME', 0, 1, .05, s.effectsVolume,
        Math.round(s.effectsVolume * 100) + '%');
    const content = this.settingsTab === 'controls' ? controls :
      this.settingsTab === 'video' ? video : audio;
    return `<div class="gg-settings-head"><div><div class="gg-shell-eyebrow">TUNE YOUR GOAT</div>` +
      `<h2>SETTINGS</h2></div>${iconButton(MENU_SPRITES.close, 'Close settings')}</div>` +
      `<nav class="gg-settings-tabs" role="tablist" aria-label="Settings sections">${tabs}</nav>` +
      `<div class="gg-settings-content" role="tabpanel" id="gg-settings-panel"` +
      ` aria-labelledby="gg-tab-${this.settingsTab}">${content}</div>` +
      `<div class="gg-settings-bottom">${iconButton(MENU_SPRITES.back, 'Back')}` +
      `<span>Changes apply immediately and save with your game.</span></div>`;
  }
  private boardBody(): string {
    const poi = this.boardPoi;
    const board = poi ? this.game.gigs.director.board(poi) : null;
    const buttons = board?.offers.map(offer => {
      const info = this.game.gigs.catalog.info(offer.gigId);
      return `<div class="gg-offer"><strong>${esc(info.title)} · ${nice(offer.difficulty)}</strong>
        <p>${esc(info.instruction)}</p>
        ${menuButton('offer:'+esc(offer.id), 'ACCEPT · '+info.baseCoins+'+ COINS', true)}</div>`;
    }).join('') ?? '';
    return `<div class="gg-shell-eyebrow">GIG BOARD · ${esc(poi ?? '')}</div><h2>MAKE CUD COINS</h2>
      <p>Pick a contract. Skill and speed turn bronze into gold — and unlock new gear.</p>
      ${buttons || '<p>Board is refreshing.</p>'}
      <p>New offers in ${Math.ceil((board?.refreshInTicks ?? 0)/60)} seconds</p>
      ${menuButton('back','← NOT NOW')}`;
  }
  private gigResultsBody(): string {
    const run = this.game.gigs.active;
    if (!run) return '';
    const best = this.game.gigs.director.personalBests.find(b =>
      b.gigId === run.setup.offer.gigId && b.difficulty === run.setup.offer.difficulty);
    const success = run.status === 'completed';
    return `<div class="gg-shell-eyebrow">${success?'GIG CLEARED':'GIG ENDED'}</div>
      <h2>${esc(run.setup.info.title)}</h2>
      <p>${esc(success?'That was a solid run. Now go cause more trouble.':
        run.failReason ?? 'Try a different route and go again.')}</p>
      <div class="gg-stats">
        <div class="gg-stat" ${menuSkin(MENU_SPRITES.stat)}><strong>${esc(nice(run.rating ?? 'no medal'))}</strong>RATING</div>
        <div class="gg-stat" ${menuSkin(MENU_SPRITES.stat)}><strong>+${run.payout ?? 0}</strong>CUD COINS</div>
        <div class="gg-stat" ${menuSkin(MENU_SPRITES.stat)}><strong>${(run.elapsedTicks/60).toFixed(1)}s</strong>TIME</div>
      </div>
      <p>${best ? 'PERSONAL BEST: '+nice(best.rating)+' · '+(best.ticks/60).toFixed(1)+'s' : 'PERSONAL BEST: not yet'}</p>
      <div class="gg-options">${menuButton('play','▶ BACK TO FREE ROAM',true)}
      ${menuButton('title','⌂ TITLE')}</div>`;
  }
  private partyResultsBody(): string {
    const match = this.game.party.match;
    if (!match) return '';
    const players = match.players;
    const sorted = match.placements.slice().sort((a,b)=>a.rank-b.rank || a.playerId.localeCompare(b.playerId));
    return `<div class="gg-shell-eyebrow">ROUND COMPLETE</div><h2>${esc(this.game.party.title)}</h2>
      <p>${esc(sorted.some(p=>p.playerId==='player' && p.rank===1)?'TOP GOAT! Incredible positioning.':'Every splash teaches you something.')}</p>
      <ol class="gg-results">${sorted.map(p=>`<li><span>#${p.rank} · ${esc(players.find(g=>g.id===p.playerId)?.name ?? p.playerId)}</span>
        <strong>${p.score} pts</strong></li>`).join('')}</ol>
      <div class="gg-options">${menuButton('leave-party','▶ RETURN TO FREE ROAM',true)}
      ${menuButton('title','⌂ TITLE')}</div>`;
  }
  private render(): void {
    if (this.screen === 'playing') { this.root.hidden = true; this.root.style.display='none'; return; }
    this.root.hidden = false; this.root.style.display = 'grid';
    const body = this.screen === 'title' ? this.titleBody() :
      this.screen === 'pause' ?
        `<div class="gg-shell-eyebrow">TAKE FIVE</div><h2>PAUSED</h2>
         <p>${this.game.party.match ? esc(this.game.party.title) : 'BILLY ISLE'} ·
          ${this.game.rules.wallet.coins} CUD COINS</p>
         <div class="gg-options">${menuButton('resume','▶ RESUME',true)}
         ${this.game.gigs.active?.status === 'running' ? menuButton('abandon-gig','✕ ABANDON GIG') : ''}
         ${this.game.party.match ? '' : menuButton('party','⚡ PARTY MODES')}
         ${menuButton('settings','⚙ SETTINGS')}${menuButton('title','⌂ QUIT TO TITLE')}</div>` :
      this.screen === 'party' ? this.partyBody() :
      this.screen === 'settings' ? this.settingsBody() :
      this.screen === 'board' ? this.boardBody() :
      this.screen === 'gig-results' ? this.gigResultsBody() : this.partyResultsBody();
    this.root.innerHTML = `<section class="gg-shell-panel" role="dialog" aria-modal="true" ${menuSkin(MENU_SPRITES.panel)}>${body}
      <footer>ENTER / CLICK select · ↑↓ navigate · GAMEPAD A select, B back · ESC back</footer></section>`;
    this.syncFullscreen();
    this.root.querySelector<HTMLElement>('button')?.focus();
  }
  dispose(): void {
    this.save();
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('pagehide', this.pageHide);
    document.removeEventListener('fullscreenchange', this.fullscreenChange);
    document.removeEventListener('pointerlockchange', this.pointerLockChange);
    this.root.remove(); this.style.remove();
    this.view.onFrame = null; this.view.onInteract = null;
  }
}
