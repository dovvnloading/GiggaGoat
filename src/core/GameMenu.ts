import type { Game } from './Game';
import type { GameView } from './GameView';
import { saveGame, type GameSettings } from './Persistence';
import type { ModeId, Difficulty as BotDifficulty } from '../modes';
import type { PoiId } from '../world';

type Screen = 'title' | 'playing' | 'pause' | 'party' | 'settings' |
  'board' | 'gig-results' | 'party-results';
const CSS = `
.gg-shell{position:absolute;inset:0;z-index:15;display:grid;place-items:center;
  font:700 16px/1.5 system-ui,Arial,sans-serif;color:#fff7de;text-shadow:0 2px 2px #27244299;
  background:linear-gradient(125deg,#13152aaf,#241b3ab3 64%,#13152ab0)}
.gg-shell *{box-sizing:border-box}
.gg-shell-panel{width:min(580px,calc(100vw - 26px));max-height:calc(100dvh - 30px);
  overflow:auto;border:3px solid #ffe5a1;border-radius:25px;padding:clamp(19px,4vw,32px);
  background:linear-gradient(148deg,#40316aeF,#1c2543f6);
  box-shadow:0 12px 0 #141327a0,0 30px 90px #12142c88}
.gg-shell-eyebrow{font-size:12px;letter-spacing:3px;color:#a9dffd;text-transform:uppercase}
.gg-shell h1{font-size:clamp(36px,7vw,66px);color:#ffd833;line-height:.98;
  margin:10px 0 14px;font-weight:1000;letter-spacing:-2px;
  -webkit-text-stroke:1px #9c6033;text-shadow:3px 5px 0 #703f94}
.gg-shell h2{font-size:clamp(26px,5vw,40px);line-height:1.05;color:#ffd833;margin:10px 0 18px}
.gg-shell p{margin:6px 0 15px;font-size:14px;color:#ebe5ff}
.gg-shell .gg-options{display:grid;gap:9px}
.gg-shell button,.gg-shell select,.gg-shell input{font:inherit}
.gg-shell button{border:2px solid #ffffff7a;background:#694bc2;color:#fff;border-radius:13px;
  padding:12px 17px;text-align:left;cursor:pointer;font-weight:950;transition:transform .1s,background .1s}
.gg-shell button:hover,.gg-shell button:focus-visible{background:#986df1;outline:3px solid #ffd833;outline-offset:2px;transform:translateY(-1px)}
.gg-shell button.gg-primary{background:#ffd833;color:#292240;border-color:#fff4c9;text-shadow:none}
.gg-shell button.gg-primary:hover,.gg-shell button.gg-primary:focus-visible{background:#fff2a8}
.gg-shell .gg-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
.gg-shell label{display:grid;gap:5px;font-size:12px;letter-spacing:.9px}
.gg-shell select,.gg-shell input[type=range]{width:100%;accent-color:#ffd833}
.gg-shell select{padding:12px;background:#fff7df;border:0;border-radius:10px;color:#241e38}
.gg-shell .gg-range{display:flex;align-items:center;gap:9px}
.gg-shell input[type=range]{min-width:0;flex:1}
.gg-shell output{min-width:42px;text-align:right;color:#ffd833}
.gg-shell .gg-offer{border:2px solid #ffffff38;padding:12px;border-radius:14px;margin:9px 0;background:#151b38a6}
.gg-shell .gg-offer strong{color:#ffd833;font-size:19px}
.gg-shell .gg-offer p{margin:4px 0 10px}
.gg-shell .gg-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:18px 0}
.gg-shell .gg-stat{border:1px solid #ffffff55;border-radius:10px;background:#181c3baa;padding:12px;text-align:center}
.gg-shell .gg-stat strong{display:block;color:#ffd833;font-size:20px}
.gg-shell .gg-results{list-style:none;margin:8px 0 20px;padding:0;max-height:34vh;overflow:auto}
.gg-shell .gg-results li{display:flex;justify-content:space-between;padding:7px 10px;margin:4px 0;
  border-radius:8px;background:#ffffff19}
.gg-shell footer{margin-top:17px;color:#d0cceb;font-size:11px;line-height:1.6}
@media(max-width:510px){.gg-shell .gg-grid{grid-template-columns:1fr}.gg-shell-panel{padding:16px}.gg-shell .gg-stats{gap:4px}}
`;
const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const menuButton = (action: string, label: string, primary = false): string =>
  `<button type="button" data-action="${action}" class="${primary ? 'gg-primary' : ''}">${label}</button>`;
const nice = (value: string): string => value.replace(/-/g, ' ').toUpperCase();

export class GameMenu {
  readonly root = document.createElement('div');
  private readonly style = document.createElement('style');
  private screen: Screen = 'title';
  private settingsReturn: Screen = 'title';
  private partyReturn: Screen = 'title';
  private boardPoi: PoiId | null = null;
  private mode: ModeId = 'rising-tide';
  private botCount = 3;
  private difficulty: BotDifficulty = 'normal';
  private lastGigAttempt = 0;
  private lastSavedTick = 0;
  private padDirection = 0;
  private padAccept = false;
  private padBack = false;
  private padMenu = false;
  private readonly keyHandler: (e: KeyboardEvent) => void;
  private readonly pageHide: () => void;

  constructor(private readonly host: HTMLElement, private readonly game: Game,
    private readonly view: GameView, public settings: GameSettings) {
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root.className = 'gg-shell';
    this.root.setAttribute('aria-label', 'Gigga-Goat menus');
    host.appendChild(this.root);
    this.root.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
      if (button) this.action(button.dataset.action ?? '');
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
    this.view.onFrame = () => this.frame();
    this.view.onInteract = () => this.interact();
    this.view.applySettings(settings);
    this.render();
  }

  private save(): void { saveGame(this.game, this.settings); }
  private setScreen(next: Screen): void {
    this.screen = next;
    this.view.paused = next !== 'playing';
    this.view.hud.setVisible(next === 'playing');
    if (next !== 'playing' && document.pointerLockElement === this.view.renderer.domElement) {
      document.exitPointerLock();
    }
    this.render();
  }
  private resume(): void {
    this.setScreen('playing');
    // This is invoked from a real menu button/key interaction.
    void this.view.renderer.domElement.requestPointerLock?.();
  }
  private action(key: string): void {
    if (key === 'play' || key === 'resume') this.resume();
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
      this.setScreen('settings');
    } else if (key === 'back') this.back();
    else if (key === 'start-party') {
      try {
        this.game.party.start(this.mode, this.botCount, this.difficulty);
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
      if (event.code === 'KeyP') {
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
    }
  }
  private navigate(direction: number): void {
    const items = [...this.root.querySelectorAll<HTMLElement>('button,select,input')];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    items[(current + direction + items.length) % items.length]!.focus();
  }
  private editSetting(element: HTMLInputElement | HTMLSelectElement): void {
    if (!element.id.startsWith('gg-setting-')) return;
    const key = element.id.slice('gg-setting-'.length);
    if (key === 'mouseSensitivity') this.settings.mouseSensitivity = Number(element.value);
    else if (key === 'fov') this.settings.fov = Number(element.value);
    else if (key === 'volume') this.settings.volume = Number(element.value);
    else if (key === 'invertY') this.settings.invertY = element.value === 'yes';
    else if (key === 'graphics') this.settings.graphics = element.value as GameSettings['graphics'];
    const output = element.parentElement?.querySelector<HTMLOutputElement>('output');
    if (output) output.textContent = key === 'volume' ? Math.round(this.settings.volume * 100) + '%' :
      key === 'fov' ? this.settings.fov + '°' : this.settings.mouseSensitivity.toFixed(2) + '×';
    this.view.applySettings(this.settings);
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
      const select = !!buttons[0]?.pressed;
      const back = !!buttons[1]?.pressed;
      const menu = !!buttons[9]?.pressed;
      if (menu && !this.padMenu) {
        if (this.screen === 'playing') this.setScreen('pause'); else this.back();
      }
      if (this.screen !== 'playing') {
        if (dir && dir !== this.padDirection) this.navigate(dir);
        if (select && !this.padAccept) {
          const active = document.activeElement as HTMLElement;
          if (this.root.contains(active)) active.click();
          else this.root.querySelector<HTMLButtonElement>('button')?.click();
        }
        if (back && !this.padBack) this.back();
      }
      this.padDirection = dir; this.padAccept = select;
      this.padBack = back; this.padMenu = menu;
    } else {
      this.padDirection = 0; this.padAccept = false; this.padBack = false; this.padMenu = false;
    }
    if (this.screen === 'playing' && this.game.party.match?.phase === 'results') {
      this.setScreen('party-results');
    }
    const gig = this.game.gigs.active;
    if (this.screen === 'playing' && gig && gig.status !== 'running' &&
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
      <div class="gg-stats"><div class="gg-stat"><strong>${this.game.rules.wallet.coins}</strong>CUD COINS</div>
      <div class="gg-stat"><strong>${this.game.gigs.director.ownedCosmetics.length}</strong>GIG GEAR</div>
      <div class="gg-stat"><strong>3</strong>PARTY MODES</div></div>
      <div class="gg-options">${menuButton('play','▶ PLAY · FREE ROAM',true)}
      ${menuButton('party','⚡ PARTY MODES')}
      ${menuButton('settings','⚙ SETTINGS')}</div>
      <footer>WASD move · mouse look · SPACE jump · E job boards · P party · ESC pause</footer>`;
  }
  private partyBody(): string {
    return `<div class="gg-shell-eyebrow">SOLO VS PHYSICS-DRIVEN BOTS</div><h2>START A PARTY</h2>
      <p>Everyone gets the same moves. Outsmart the bots, stay above the tide and claim the top spot.</p>
      <div class="gg-grid">
      <label>ROUND<select id="gg-mode">
        <option value="rising-tide" ${this.mode==='rising-tide'?'selected':''}>Rising Tide · survive</option>
        <option value="king-of-the-peak" ${this.mode==='king-of-the-peak'?'selected':''}>King of the Peak · capture</option>
        <option value="hay-heist" ${this.mode==='hay-heist'?'selected':''}>Hay Heist · steal hay</option>
      </select></label>
      <label>BOT GOATS<select id="gg-bots">
        ${[3,4,5,6,7].map(n=>`<option value="${n}" ${n===this.botCount?'selected':''}>${n} bots</option>`).join('')}
      </select></label>
      <label>BOT SKILL<select id="gg-difficulty">
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
      value: number, output: string) => `<label>${label}<div class="gg-range">
      <input id="gg-setting-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
      <output>${output}</output></div></label>`;
    return `<div class="gg-shell-eyebrow">TUNE YOUR GOAT</div><h2>SETTINGS</h2>
      <div class="gg-options">
      ${slider('mouseSensitivity','MOUSE SENSITIVITY',.25,3,.05,s.mouseSensitivity,s.mouseSensitivity.toFixed(2)+'×')}
      <label>INVERT CAMERA Y<select id="gg-setting-invertY">
        <option value="no" ${!s.invertY?'selected':''}>Off</option>
        <option value="yes" ${s.invertY?'selected':''}>On</option></select></label>
      ${slider('fov','FIELD OF VIEW',55,95,1,s.fov,s.fov+'°')}
      <label>GRAPHICS QUALITY<select id="gg-setting-graphics">
        ${(['low','medium','high'] as const).map(q => `<option value="${q}" ${s.graphics===q?'selected':''}>${nice(q)}</option>`).join('')}
      </select></label>
      ${slider('volume','VOLUME · AUDIO CONNECTOR COMING LATER',0,1,.05,s.volume,Math.round(s.volume*100)+'%')}
      ${menuButton('back','← BACK',true)}</div>
      <footer>Settings save automatically. Volume is remembered for the upcoming audio integration.</footer>`;
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
      ${menuButton('back','← NOT NOW')}</div>`;
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
        <div class="gg-stat"><strong>${esc(nice(run.rating ?? 'no medal'))}</strong>RATING</div>
        <div class="gg-stat"><strong>+${run.payout ?? 0}</strong>CUD COINS</div>
        <div class="gg-stat"><strong>${(run.elapsedTicks/60).toFixed(1)}s</strong>TIME</div>
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
    this.root.innerHTML = `<section class="gg-shell-panel" role="dialog" aria-modal="true">${body}
      <footer>ENTER / CLICK select · ↑↓ navigate · GAMEPAD A select, B back · ESC back</footer></section>`;
    this.root.querySelector<HTMLElement>('button')?.focus();
  }
  dispose(): void {
    this.save();
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('pagehide', this.pageHide);
    this.root.remove(); this.style.remove();
    this.view.onFrame = null; this.view.onInteract = null;
  }
}
