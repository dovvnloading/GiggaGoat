import type { Game } from './Game';
import type { GameView } from './GameView';
import type { GameAudio } from './GameAudio';
import { saveGame, type GameSettings } from './Persistence';
import { hudObjectiveParts } from './GameHudState';
import { MODE_DEFAULTS, TICKS_PER_SECOND, type ModeId, type Difficulty as BotDifficulty } from '../modes';
import type { PoiId } from '../world';
import { HUD_SPRITES, hudSpriteImage } from './HudSprites';
import { gigBoardGoal, gigBoardIcon } from './GigBoardPresentation';
import { MENU_SPRITES, menuSkin, menuSpriteUrl, type MenuSpriteName } from './MenuSprites';
import titleArt from '../../docs/art/hifi/07_key_art.png?url';

type Screen = 'title' | 'playing' | 'pause' | 'party' | 'party-confirm' | 'settings' |
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
.gg-shell input.gg-slider{--gg-thumb:34px;--gg-thumb-radius:17px;
  --gg-fill-stop:calc(var(--gg-thumb-radius) + (100% - var(--gg-thumb)) * var(--gg-ratio));
  --gg-track-fill:linear-gradient(180deg,#fff3 0%,transparent 59%,#27112738 100%),
    linear-gradient(90deg,#93ed2f 0 var(--gg-fill-stop),#3d283e var(--gg-fill-stop) 100%);
  --gg-thumb-art:var(--gg-sprite) -200px -3px/383px 42px no-repeat;
  appearance:none;-webkit-appearance:none;flex:1;min-width:0;margin:0;
  height:42px;border:0;border-radius:11px;padding:0;cursor:pointer;background:transparent}
.gg-shell input.gg-slider::-webkit-slider-runnable-track{box-sizing:border-box;
  height:26px;border:2px solid #f4c772;border-radius:100px;background:var(--gg-track-fill);
  box-shadow:inset 0 2px 4px #2d1923,0 1px 2px #190d2f}
.gg-shell input.gg-slider::-moz-range-track{box-sizing:border-box;
  height:26px;border:2px solid #f4c772;border-radius:100px;background:var(--gg-track-fill);
  box-shadow:inset 0 2px 4px #2d1923,0 1px 2px #190d2f}
.gg-shell input.gg-slider::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;
  width:var(--gg-thumb);height:var(--gg-thumb);margin-top:-6px;border:0;border-radius:50%;
  background:var(--gg-thumb-art);box-shadow:0 2px 2px #261328d9}
.gg-shell input.gg-slider::-moz-range-thumb{width:var(--gg-thumb);height:var(--gg-thumb);
  border:0;border-radius:50%;background:var(--gg-thumb-art);box-shadow:0 2px 2px #261328d9}
.gg-shell output{min-width:52px;text-align:right;color:#ffe153;font-size:15px;font-variant-numeric:tabular-nums}
.gg-shell .gg-board-offers{display:grid;gap:7px;margin:0 0 10px}
.gg-shell .gg-board-choice{
  position:relative;display:grid;grid-template-columns:39px minmax(0,1fr);align-items:center;gap:9px;
  width:100%;min-height:58px;padding:5px 8px;border:10px solid transparent;
  border-image:var(--gg-sprite) 48 fill / 10px / 0 stretch;
  border-radius:11px;background:transparent;color:#fff1d7;text-align:left
}
.gg-shell .gg-board-choice:hover{background:#63507c50}
.gg-shell .gg-board-choice[aria-pressed="true"]::after{
  content:"";position:absolute;inset:-3px;border:2px solid #ffd16e;border-radius:9px;pointer-events:none
}
.gg-shell .gg-board-choice strong{display:block;color:#ffe092;font-size:clamp(14px,2.4vw,18px);line-height:1.08}
.gg-shell .gg-board-icon{width:34px;height:34px;object-fit:contain;justify-self:center}
.gg-shell .gg-board-grass{display:grid;place-items:center;font:700 31px/1 "Segoe UI Symbol",system-ui,sans-serif;color:#c0f38b}
.gg-shell .gg-board-meta{display:flex;flex-wrap:wrap;gap:1px 10px;margin-top:4px;line-height:1.2;font-size:clamp(10px,1.4vw,12px)}
.gg-shell .gg-board-difficulty{color:#c8e4fb}
.gg-shell .gg-board-coins{color:#ffedaf}
.gg-shell .gg-board-note{margin:0 0 8px;padding:4px 8px;border-left:2px solid #ffc962;font-size:12px}
.gg-shell .gg-board-refresh{margin:7px 0 0;font-size:11px;color:#e6d6ec}
.gg-shell .gg-board-actions{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
.gg-shell .gg-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:18px 0}
.gg-shell .gg-stat{display:flex;flex-direction:column;justify-content:center;align-items:center;
  min-width:0;min-height:90px;padding:3px 5px;border:14px solid transparent;
  border-image:var(--gg-sprite) 48 fill / 14px / 0 stretch;text-align:center;
  color:#fff3db;font-size:clamp(9px,1.05vw,12px)}
.gg-shell .gg-stat strong{display:block;color:#ffe147;font-size:clamp(17px,2.1vw,24px);line-height:1.1}
.gg-shell .gg-gig-progress strong{font-size:clamp(13px,2.1vw,24px)}
.gg-shell .gg-gig-progress span{margin-top:2px}
.gg-shell .gg-gig-result-return{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.gg-shell .gg-party-results-panel{display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;
  gap:clamp(8px,1.5dvh,14px);overflow:hidden}
.gg-shell .gg-party-results-head h2{margin:4px 0 9px}
.gg-shell .gg-results{min-height:0;list-style:none;margin:0;padding:2px 3px 2px 2px;
  overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable}
.gg-shell .gg-results li{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:3px 10px;
  padding:7px 10px;border-radius:8px;background:#ffffff19;font-size:clamp(11px,1.45vw,14px)}
.gg-shell .gg-results li+li{margin-top:4px}
.gg-shell .gg-results li[data-result-you]{background:#4b3248;box-shadow:inset 0 0 0 1px #ffd477}
.gg-shell .gg-results:focus-visible{outline:2px solid #ffe44b;outline-offset:-2px}
.gg-shell .gg-party-results-panel .gg-options{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:9px;padding:3px}
.gg-shell .gg-party-results-panel .gg-art-button{min-height:54px;padding:2px 8px;
  border-width:13px;border-image-width:13px}
.gg-shell .gg-party-results-panel footer{margin:0;padding:0 3px}
.gg-shell .gg-result-label{display:flex;align-items:baseline;gap:6px}
.gg-shell .gg-result-rank{color:#ffe092;font-variant-numeric:tabular-nums}
.gg-shell .gg-result-tie,.gg-shell .gg-result-you{color:#fff0a2;font-size:.78em;letter-spacing:.55px}
.gg-shell .gg-result-measure{display:flex;flex-wrap:wrap;column-gap:6px;align-items:baseline}
.gg-shell .gg-result-measure small{color:#e3cfe9}
.gg-shell .gg-party-outcome{display:grid;gap:2px;margin:0}
.gg-shell .gg-party-outcome strong{font-size:clamp(18px,2.8vw,27px);color:#ffe092;line-height:1.1}
.gg-shell .gg-party-outcome span{font-size:clamp(11px,1.4vw,14px);color:#f0ddeb}
.gg-shell footer{margin-top:14px;color:#e0cfea;font-size:clamp(10px,1.15vw,12px);line-height:1.5}
.gg-shell .gg-title-panel{width:min(1160px,100%)}
.gg-shell .gg-title-layout{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(238px,1fr);
  gap:clamp(12px,2.2vw,28px);align-items:center}
.gg-shell h1.gg-title-art{margin:0;border-radius:12px;overflow:hidden;background:#2e5984}
.gg-shell .gg-title-art img{width:100%;height:auto;display:block}
.gg-shell .gg-title-actions{min-width:0}
.gg-shell .gg-title-actions .gg-art-button{min-height:56px;padding:2px 12px;border-width:14px;border-image-width:14px}
.gg-shell .gg-title-progress{display:flex;gap:6px;align-items:center;margin:8px 0;
  color:#f7e8d1;font-size:clamp(11px,1.1vw,14px)}
.gg-shell .gg-title-progress img{width:19px;height:19px;object-fit:contain}
.gg-shell .gg-title-actions .gg-quick-start{margin-top:10px}
.gg-shell .gg-quick-start{min-width:0;padding:8px 10px;border:1px solid #b794a466;border-radius:9px;background:#151b3870}
.gg-shell .gg-quick-start h2{font-size:clamp(13px,1.45vw,16px);line-height:1.2;margin:0 0 6px;letter-spacing:0}
.gg-shell .gg-quick-start dl{display:grid;gap:5px;margin:0}
.gg-shell .gg-quick-start dt{color:#fff3d6;font-size:12px}
.gg-shell .gg-quick-start dd{margin:0;color:#e6d6ec;font-size:11px;line-height:1.28;font-weight:700}
.gg-shell .gg-party-grid{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
.gg-shell .gg-party-brief{min-width:0;padding:8px 10px;border-left:2px solid #ffc962;background:#151b3870;border-radius:0 6px 6px 0}
.gg-shell .gg-party-brief strong{display:block;color:#ffe092;font-size:13px}
.gg-shell .gg-party-brief p{margin:4px 0 0;font-size:13px;line-height:1.28}
.gg-shell .gg-control-jump{display:flex;align-items:center;justify-content:space-between;
  gap:8px;width:100%;min-height:42px;margin:0 0 14px;padding:3px 8px;
  border:9px solid transparent;border-image:var(--gg-sprite) 42 fill / 9px / 0 stretch;
  background:transparent;color:#ffedbd;font-size:13px;text-align:left}
.gg-shell .gg-control-table{width:100%;border-collapse:collapse;scroll-margin-block-start:5px;
  font-size:clamp(11px,1.25vw,13px);line-height:1.3;text-shadow:none}
.gg-shell .gg-control-table:focus-visible{outline:2px solid #ffe44b;outline-offset:2px}
.gg-shell .gg-control-table caption{margin-bottom:7px;font-size:14px;color:#ffe092;text-align:left}
.gg-shell .gg-control-table :is(th,td){padding:5px;text-align:left;vertical-align:top;border-bottom:1px solid #e8cf993b}
.gg-shell .gg-control-table thead{color:#ffe092;background:#19173194}
.gg-shell .gg-control-table td{color:#fff3e8;font-weight:700}
.gg-shell .gg-settings-head{display:flex;align-items:start;justify-content:space-between;gap:12px}
.gg-shell .gg-settings-back{display:inline-flex;align-items:center;flex:0 0 auto;
  min-height:44px;border:0;border-radius:9px;padding:0 6px 0 40px;color:#fff7df;
  background:var(--gg-sprite) left center/34px 34px no-repeat;
  font-size:13px;text-shadow:1px 2px #493277;transition:transform .08s}
.gg-shell .gg-settings-back:hover{color:#ffe092}
.gg-shell .gg-settings-back:active{transform:translateY(1px)}
.gg-shell .gg-settings-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:5px;margin:1px 0 13px}
.gg-shell .gg-tab{display:grid;place-items:center;min-width:0;min-height:49px;
  padding:4px 1px;border:11px solid transparent;
  border-image:var(--gg-sprite) 42 fill / 11px / 0 stretch;
  background:transparent;color:#fff5df;text-shadow:1px 2px #493277;
  font-size:clamp(11px,1.3vw,14px);letter-spacing:.2px;text-align:center}
.gg-shell .gg-tab[aria-selected="true"]{color:#4c2b1a;text-shadow:0 1px #ffe39c}
.gg-shell .gg-tab>span{pointer-events:none}
.gg-shell .gg-settings-content{min-height:210px;padding:4px 2px}
.gg-shell .gg-settings-content>.gg-setting{margin:0 0 20px}
.gg-shell .gg-settings-content select{appearance:none;padding-right:26px;background:transparent}
.gg-shell .gg-setting-row{display:flex;align-items:center;justify-content:space-between;
  min-height:64px;gap:14px;margin-bottom:16px;font-size:13px;letter-spacing:.7px}
.gg-shell .gg-switch{flex:0 0 auto;width:106px;height:54px;padding:0;border:0;
  background:var(--gg-sprite) center/100% 100% no-repeat}
.gg-shell .gg-check{flex:0 0 auto;width:48px;height:48px;padding:0;border:0;
  background:var(--gg-sprite) center/100% 100% no-repeat}
.gg-shell .gg-settings-note{margin:7px 0 0;font-size:12px;line-height:1.4;color:#dfd0e8}
.gg-shell .gg-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap}
@media(max-height:660px) and (min-width:511px){
 .gg-shell .gg-title-actions .gg-art-button{min-height:54px;padding:2px 9px;border-width:14px;border-image-width:14px}
}
@media(max-height:460px) and (min-width:511px){
 .gg-shell .gg-party-grid{gap:7px 10px;margin:7px 0 9px}
 .gg-shell .gg-party-brief{padding:5px 7px}
 .gg-shell .gg-party-actions{grid-template-columns:1fr 1fr}
 .gg-shell :is(.gg-party-actions,.gg-board-actions) .gg-art-button{min-height:47px;padding:2px 8px;border-width:13px;border-image-width:13px}
}
@media(max-height:460px){
 .gg-shell .gg-party-results-panel{padding:8px 12px;border-width:20px;border-image-width:20px}
 .gg-shell .gg-party-results-head h2{margin:2px 0 5px}
 .gg-shell .gg-party-results-panel .gg-art-button{min-height:44px;border-width:10px;border-image-width:10px}
 .gg-shell .gg-party-results-panel .gg-results li{padding:5px 8px}
}
@media(max-width:510px){
 .gg-shell{padding:6px}
 .gg-shell-panel{width:100%;max-height:calc(100dvh - 12px);border-width:20px;
   border-image-width:20px;padding:8px 10px}
 .gg-shell h1{font-size:44px}
 .gg-shell .gg-grid{grid-template-columns:1fr;gap:7px}
 .gg-shell .gg-stats{gap:2px}
 .gg-shell .gg-stat{min-height:79px;border-width:10px;border-image-width:10px}
 .gg-shell .gg-art-button{min-height:59px;font-size:13px}
 .gg-shell .gg-title-layout{grid-template-columns:minmax(0,1fr)}
 .gg-shell .gg-quick-start dl{grid-template-columns:repeat(2,minmax(0,1fr))}
 .gg-shell .gg-control-table :is(th,td){padding:4px}
 .gg-shell .gg-tab{min-height:44px;border-width:9px;border-image-width:9px}
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
type SettingsTab = 'controls' | 'video' | 'audio';
const SETTINGS_TABS: readonly SettingsTab[] = ['controls', 'video', 'audio'];
const nice = (value: string): string => value.replace(/-/g, ' ').toUpperCase();

const PARTY_ROUNDS: Record<ModeId, { name: string; venue: string; objective: string }> = {
  'rising-tide': {
    name: 'Rising Tide', venue: 'Billy Isle · start in Hoofington',
    objective: 'As the sea rises, follow amber arrows uphill. Outlast the other goats.',
  },
  'king-of-the-peak': {
    name: 'King of the Peak', venue: 'Mt. Gigga summit',
    objective: `Get closer to the summit center than your rivals. First to ${MODE_DEFAULTS.peakTargetScore} points wins.`,
  },
  'hay-heist': {
    name: 'Hay Heist', venue: 'Crane Yard · haul lane',
    objective: `Steal rival hay and bring it to your barn. First team to ${MODE_DEFAULTS.hayTargetScore} deliveries wins.`,
  },
};

const GAMEPLAY_BINDINGS: readonly {
  action: string; keyboard: string; gamepad: string; quick?: boolean;
}[] = [
  { action: 'Move', keyboard: 'WASD or arrows', gamepad: 'Left stick', quick: true },
  { action: 'Look', keyboard: 'Mouse or IJKL', gamepad: 'Right stick', quick: true },
  { action: 'Jump / flip', keyboard: 'Space', gamepad: 'A', quick: true },
  { action: 'Lick', keyboard: 'Hold right mouse', gamepad: 'Hold LB or LT', quick: true },
  { action: 'Headbutt', keyboard: 'Hold, then release left mouse', gamepad: 'Hold, then release RT', quick: true },
  { action: 'Toggle Hay-Build', keyboard: 'B', gamepad: 'Y', quick: true },
  { action: 'Select build piece', keyboard: '1–4', gamepad: 'D-pad' },
  { action: 'Place build piece', keyboard: 'Left click in Hay-Build', gamepad: 'RT in Hay-Build' },
  { action: 'Sprint', keyboard: 'Shift', gamepad: 'RB' },
  { action: 'Reel tongue', keyboard: 'R', gamepad: 'Press right stick' },
  { action: 'Fling', keyboard: 'F', gamepad: 'Press left stick' },
  { action: 'Bleat / open gig board', keyboard: 'E', gamepad: 'X' },
  { action: 'Graze in Mow-Down', keyboard: 'G', gamepad: 'X' },
  { action: 'Flop', keyboard: 'Q', gamepad: 'B' },
  { action: 'Capture mouse', keyboard: 'C', gamepad: '—' },
  { action: 'Turn without mouse capture', keyboard: 'Hold cursor at window edge', gamepad: '—' },
  { action: 'Open party picker', keyboard: 'P', gamepad: 'Pause → Party Modes' },
  { action: 'Pause', keyboard: 'Esc', gamepad: 'Start' },
  { action: 'Performance overlay', keyboard: 'F3', gamepad: '—' },
];

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
  private readonly resultLayout = typeof ResizeObserver === 'undefined' ? null :
    new ResizeObserver(() => this.syncPartyResultsScroll());
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
        this.selectSettingsTab(tab.dataset.tab as SettingsTab);
        return;
      }
      const toggle = target.closest<HTMLButtonElement>('[data-setting-toggle]');
      if (toggle) {
        this.settings.invertY = !this.settings.invertY;
        this.view.applySettings(this.settings);
        this.audio?.playMenuCue('ui-click');
        this.save();
        this.render();
        this.root.querySelector<HTMLButtonElement>('[data-setting-toggle]')?.focus();
        return;
      }
      const offer = target.closest<HTMLButtonElement>('[data-board-offer]');
      if (offer) {
        this.selectBoardOffer(offer);
        return;
      }
      if (target.closest('[data-fullscreen]')) {
        this.audio?.playMenuCue('ui-click');
        void this.toggleFullscreen();
        return;
      }
      const button = target.closest<HTMLButtonElement>('[data-action]');
      if (button) {
        const mouseClick = event.isTrusted && event.detail > 0 &&
          (!('pointerType' in event) || event.pointerType === 'mouse');
        this.action(button.dataset.action ?? '', mouseClick);
      }
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
      if (element.id === 'gg-mode' || element.id === 'gg-bots' || element.id === 'gg-difficulty') {
        if (element.id === 'gg-mode') this.selectPartyMode(element.value);
        else if (element.id === 'gg-bots') this.botCount = Number(element.value);
        else this.difficulty = element.value as BotDifficulty;
        this.audio?.playMenuCue('ui-click');
      } else if (element.type !== 'range') this.editSetting(element);
    });
    this.root.addEventListener('input', event => {
      const element = event.target as HTMLInputElement;
      if (element.type === 'range') this.editSetting(element);
    });
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
        this.pause();
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
    if (this.screen === 'gig-results' && next !== 'gig-results') {
      this.game.acknowledgeGigResult();
      this.save();
    }
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
    if (!document.hidden && (next === 'gig-results' || next === 'party-results')) {
      this.audio?.playResultAudio(next === 'gig-results' ? 'gig' : 'party');
    } else {
      this.audio?.setMenuOpen(this.view.paused);
    }
    this.view.input.setActive(next === 'playing');
    this.view.hud.setVisible(next === 'playing');
    if (next !== 'playing' && document.pointerLockElement === this.view.renderer.domElement) {
      document.exitPointerLock();
    }
    this.render();
  }
  private resume(mouseClick = false): void {
    this.setScreen('playing');
    // Escape can release capture without delivering a keydown. A subsequent
    // deliberate mouse click on a menu action supplies a new capture gesture.
    if (mouseClick || !this.pointerLockNeedsUserRequest) {
      void this.view.input.requestPointerLock();
    }
  }
  private pause(): void {
    this.audio?.playMenuCue('ui-back');
    this.setScreen('pause');
  }
  private action(key: string, mouseClick = false): void {
    if (key !== 'back' && key !== 'pause') this.audio?.playMenuCue('ui-confirm');
    if (key === 'play') {
      this.view.alignCameraForPlay();
      this.resume(mouseClick);
    } else if (key === 'resume') this.resume(mouseClick);
    else if (key === 'pause') this.pause();
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
    } else if (key === 'gameplay-controls') {
      const reference = this.root.querySelector<HTMLElement>('#gg-gameplay-controls');
      reference?.focus({ preventScroll: true });
      reference?.scrollIntoView({ block: 'start' });
    } else if (key === 'back') this.back(mouseClick);
    else if (key === 'keep-gig' && this.screen === 'party-confirm') {
      if (this.partyReturn === 'playing') this.resume(mouseClick);
      else this.setScreen(this.partyReturn);
    } else if (key === 'start-party' || key === 'confirm-party') {
      const confirmed = key === 'confirm-party';
      if (this.screen !== (confirmed ? 'party-confirm' : 'party')) return;
      if (!confirmed && this.game.gigs.active?.status === 'running') {
        this.setScreen('party-confirm');
        return;
      }
      try {
        this.game.party.start(this.mode, this.botCount, this.difficulty);
        this.view.alignCameraForPlay();
        this.resume(mouseClick);
      } catch (error) { this.error(error); }
    } else if (key.startsWith('offer:')) {
      try {
        this.game.gigs.accept(key.slice(6));
        const id = this.game.gigs.active?.setup.offer.gigId;
        if (id === 'rooftop-express' || id === 'summit-sprint') this.view.alignCameraForPlay();
        this.save();
        this.resume(mouseClick);
      } catch (error) { this.error(error); }
    } else if (key === 'retry-gig' && this.screen === 'gig-results') {
      try {
        this.game.gigs.retryFailed();
        const id = this.game.gigs.active?.setup.offer.gigId;
        if (id === 'rooftop-express' || id === 'summit-sprint') this.view.alignCameraForPlay();
        // The new attempt replaces the failed one. Leaving results saves the
        // running attempt through the same acknowledgement path as Free Roam.
        this.resume(mouseClick);
      } catch (error) { this.error(error); }
    } else if (key === 'leave-party') {
      this.game.party.returnToFreeRoam();
      this.save();
      this.resume(mouseClick);
    } else if (key === 'abandon-gig') {
      this.game.gigs.abandon();
      this.save();
      this.resume(mouseClick);
    }
  }
  private error(error: unknown): void {
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = error instanceof Error ? error.message : 'Action unavailable';
    this.root.querySelector('.gg-shell-panel')?.prepend(message);
  }
  private back(mouseClick = false): void {
    if (this.screen === 'title') return;
    if (this.screen === 'party-results') {
      this.action('leave-party', mouseClick);
      return;
    }
    this.audio?.playMenuCue('ui-back');
    if (this.screen === 'party-confirm') this.setScreen('party');
    else if (this.screen === 'party') this.setScreen(this.partyReturn);
    else if (this.screen === 'settings') this.setScreen(this.settingsReturn);
    else if (this.screen === 'board') this.resume(mouseClick);
    else if (this.screen === 'pause') this.resume(mouseClick);
    else if (this.screen === 'gig-results') this.resume(mouseClick);
    else this.setScreen('title');
  }
  private onKey(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.screen === 'playing') this.pause();
      else this.back();
      return;
    }
    if (this.screen === 'playing') {
      if (event.code === 'KeyP' && !this.game.party.match) {
        event.preventDefault(); this.action('party');
      }
      return;
    }
    if (event.code === 'PageUp' || event.code === 'PageDown') {
      const region = this.menuScrollRegion();
      if (region) {
        event.preventDefault();
        const direction = event.code === 'PageDown' ? 1 : -1;
        region.scrollBy(0, direction * Math.max(24, region.clientHeight - 24));
        return;
      }
    }
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      const focused = document.activeElement;
      if (this.screen === 'party-results' && focused === this.root.querySelector('.gg-results')) return;
      if (focused?.id === 'gg-gameplay-controls') return;
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
  private selectSettingsTab(tab: SettingsTab): void {
    this.settingsTab = tab;
    this.audio?.playMenuCue('ui-click');
    this.render();
    this.root.querySelector<HTMLButtonElement>('[data-tab="' + tab + '"]')?.focus();
  }

  /** D-pad / stick left and right edit tabs, native selects and ranges without a mouse. */
  private adjustFocused(direction: number): boolean {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && active.dataset.tab) {
      const current = SETTINGS_TABS.indexOf(active.dataset.tab as SettingsTab);
      this.selectSettingsTab(SETTINGS_TABS[
        (current + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length]!);
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
      element.style.setProperty('--gg-ratio', String((Number(element.value) - min) / (max - min)));
    }
    const output = element.parentElement?.querySelector<HTMLOutputElement>('output');
    if (output) output.textContent = isVolume ? Math.round(Number(element.value) * 100) + '%' :
      key === 'fov' ? this.settings.fov + '°' : this.settings.mouseSensitivity.toFixed(2) + '×';
    this.view.applySettings(this.settings);
    if (isVolume) this.audio?.setVolumes(this.settings);
    this.audio?.playMenuCue('ui-click');
    this.save();
  }
  private interact(): boolean {
    if (this.screen !== 'playing') return false;
    const poi = this.game.gigs.nearBoard();
    if (!poi) return false;
    this.boardPoi = poi;
    this.audio?.playMenuCue('ui-confirm');
    this.setScreen('board');
    return true;
  }
  private syncPartyResultsScroll(): void {
    if (this.screen !== 'party-results') return;
    const standings = this.root.querySelector<HTMLElement>('.gg-results');
    const hint = this.root.querySelector<HTMLElement>('[data-results-scroll-hint]');
    if (!standings || !hint) return;
    const scrollable = standings.scrollHeight > standings.clientHeight;
    hint.hidden = !scrollable;
    standings.tabIndex = scrollable ? 0 : -1;
    if (!scrollable && document.activeElement === standings) {
      this.root.querySelector<HTMLButtonElement>('[data-action="leave-party"]')?.focus();
    }
  }

  private menuScrollRegion(): HTMLElement | null {
    if (this.screen === 'party-results') {
      const standings = this.root.querySelector<HTMLElement>('.gg-results');
      return standings?.tabIndex === 0 ? standings : null;
    }
    if (this.screen === 'settings' && this.settingsTab === 'controls') {
      return this.root.querySelector('.gg-shell-panel');
    }
    return null;
  }

  /** Poll menu controls and surface results on every browser animation frame. */
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
      const scroll = pad.axes[3] ?? 0;
      if (Math.abs(scroll) > .2) this.menuScrollRegion()?.scrollBy(0, scroll * 14);
      if (menu && !this.padMenu) {
        if (this.screen === 'playing') this.pause(); else this.back();
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
    if (this.screen === 'playing' && this.game.pendingGigResult) {
      this.save();
      this.setScreen('gig-results');
    }
    if (this.game.physics.stepCount - this.lastSavedTick >= 600) {
      this.lastSavedTick = this.game.physics.stepCount;
      this.save();
    }
  }
  private titleBody(): string {
    const coins = this.game.rules.wallet.coins;
    const gear = this.game.gigs.director.ownedCosmetics.length;
    const progress = [coins > 0 && coins.toLocaleString('en-US') + ' CUD COINS',
      gear > 0 && gear + (gear === 1 ? ' GEAR REWARD' : ' GEAR REWARDS')].filter(Boolean);
    return `<div class="gg-title-layout">
      <h1 class="gg-title-art"><img src="${titleArt}" alt="Gigga-Goat" width="1672" height="941" fetchpriority="high"></h1>
      <div class="gg-title-actions">
        <div class="gg-shell-eyebrow">BILLY ISLE</div>
        <p>Explore Billy Isle, wreak havoc, and take on gigs.</p>
        <div class="gg-options">${menuButton('play','▶ PLAY · FREE ROAM',true)}
          ${menuButton('party','⚡ PARTY MODES')}
          ${menuButton('settings','⚙ SETTINGS')}</div>
        ${progress.length ? `<p class="gg-title-progress">
          ${coins > 0 ? hudSpriteImage(HUD_SPRITES.cudCoin, '') : ''}${progress.join(' · ')}</p>` : ''}
        <section class="gg-quick-start" aria-labelledby="gg-quick-start">
          <h2 id="gg-quick-start">QUICK START</h2>
          <dl>${GAMEPLAY_BINDINGS.filter(binding => binding.quick).map(binding =>
          `<div><dt>${binding.action}</dt><dd>${binding.keyboard} · ${binding.gamepad}</dd></div>`).join('')}</dl>
        </section>
      </div></div>`;
  }
  private selectPartyMode(value: string): void {
    if (!Object.hasOwn(PARTY_ROUNDS, value)) return;
    this.mode = value as ModeId;
    const { venue, objective } = PARTY_ROUNDS[this.mode];
    const venueLabel = this.root.querySelector('[data-party-venue]');
    const objectiveLabel = this.root.querySelector('[data-party-objective]');
    if (venueLabel) venueLabel.textContent = venue;
    if (objectiveLabel) objectiveLabel.textContent = objective;
  }

  private partyBody(): string {
    const selected = PARTY_ROUNDS[this.mode];
    return `<div class="gg-shell-eyebrow">SOLO VS PHYSICS-DRIVEN BOTS</div><h2>START A PARTY</h2>
      <div class="gg-grid gg-party-grid">
      <label class="gg-select-label">ROUND<select id="gg-mode" aria-describedby="gg-party-brief" ${menuSkin(MENU_SPRITES.stat)}>
        ${Object.entries(PARTY_ROUNDS).map(([id, round]) =>
          `<option value="${id}" ${id === this.mode ? 'selected' : ''}>${round.name}</option>`).join('')}
      </select></label>
      <div class="gg-party-brief" id="gg-party-brief" aria-live="polite" aria-atomic="true">
        <strong data-party-venue>${selected.venue}</strong>
        <p data-party-objective>${selected.objective}</p>
      </div>
      <label class="gg-select-label">BOT GOATS<select id="gg-bots" ${menuSkin(MENU_SPRITES.stat)}>
        ${[3,4,5,6,7].map(n=>`<option value="${n}" ${n===this.botCount?'selected':''}>${n} bots</option>`).join('')}
      </select></label>
      <label class="gg-select-label">BOT SKILL<select id="gg-difficulty" ${menuSkin(MENU_SPRITES.stat)}>
        <option value="easy" ${this.difficulty==='easy'?'selected':''}>Easy · chill</option>
        <option value="normal" ${this.difficulty==='normal'?'selected':''}>Normal · lively</option>
        <option value="hard" ${this.difficulty==='hard'?'selected':''}>Hard · ruthless</option>
      </select></label></div>
      <div class="gg-options gg-party-actions">${menuButton('start-party','⚡ LAUNCH ROUND',true)}
      ${menuButton('back','← BACK')}</div>`;
  }
  private partyConfirmBody(): string {
    const gig = this.game.gigs.active?.setup.info.title ?? 'your current gig';
    return `<h2 id="gg-party-confirm-title">LEAVE CURRENT GIG?</h2>
      <p id="gg-party-confirm-detail">Starting ${esc(PARTY_ROUNDS[this.mode].name)}
        will abandon ${esc(gig)} and clear this attempt’s progress.</p>
      <div class="gg-options">${menuButton('keep-gig','← KEEP CURRENT GIG',true)}
        ${menuButton('confirm-party','⚡ ABANDON &amp; LAUNCH')}</div>`;
  }
  private settingsBody(): string {
    const s = this.settings;
    const slider = (key: string, label: string, min: number, max: number, step: number,
      value: number, output: string): string => {
      const ratio = (value - min) / (max - min);
      return `<label class="gg-setting">${label}<div class="gg-range">` +
        `<input class="gg-slider" id="gg-setting-${key}" type="range" min="${min}" max="${max}"` +
        ` step="${step}" value="${value}" ${menuSkin(MENU_SPRITES.slider, '--gg-ratio:' + ratio + ';')}>` +
        `<output for="gg-setting-${key}">${output}</output></div></label>`;
    };
    const tabs = SETTINGS_TABS.map(tab => {
      const selected = tab === this.settingsTab;
      const normal = selected ? MENU_SPRITES.yellowNormal : MENU_SPRITES.purpleNormal;
      const hover = selected ? MENU_SPRITES.yellowHover : MENU_SPRITES.purpleHover;
      const pressed = selected ? MENU_SPRITES.yellowPressed : MENU_SPRITES.purplePressed;
      return `<button type="button" role="tab" id="gg-tab-${tab}" data-tab="${tab}"` +
        ` aria-selected="${selected}" aria-controls="gg-settings-panel" class="gg-tab"` +
        ` ${menuSkin(normal)} data-sprite-normal="${normal}"` +
        ` data-sprite-hover="${hover}" data-sprite-pressed="${pressed}">` +
        `<span>${nice(tab)}</span></button>`;
    }).join('');
    const controls = `<button type="button" data-action="gameplay-controls" class="gg-control-jump"` +
      ` aria-controls="gg-gameplay-controls" ${menuSkin(MENU_SPRITES.purpleNormal)}` +
      ` data-sprite-normal="${MENU_SPRITES.purpleNormal}" data-sprite-hover="${MENU_SPRITES.purpleHover}"` +
      ` data-sprite-pressed="${MENU_SPRITES.purplePressed}">Gameplay controls <span aria-hidden="true">↓</span></button>` +
      slider('mouseSensitivity', 'MOUSE SENSITIVITY', .25, 3, .05,
        s.mouseSensitivity, s.mouseSensitivity.toFixed(2) + '×') +
      `<div class="gg-setting-row"><span id="gg-invert-label">INVERT CAMERA Y</span>` +
      `<button type="button" class="gg-switch" role="switch" aria-labelledby="gg-invert-label"` +
      ` aria-checked="${s.invertY}" data-setting-toggle="invertY"` +
      ` ${menuSkin(s.invertY ? MENU_SPRITES.toggleOn : MENU_SPRITES.toggleOff)}>` +
      `<span class="gg-visually-hidden">${s.invertY ? 'On' : 'Off'}</span></button></div>` +
      `<table class="gg-control-table" id="gg-gameplay-controls" tabindex="-1"><caption>GAMEPLAY CONTROLS</caption>` +
      `<thead><tr><th scope="col">Action</th><th scope="col">Keyboard &amp; mouse</th><th scope="col">Gamepad</th></tr></thead><tbody>` +
      GAMEPLAY_BINDINGS.map(binding =>
        `<tr><th scope="row">${binding.action}</th><td>${binding.keyboard}</td><td>${binding.gamepad}</td></tr>`).join('') +
      `</tbody></table>`;
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
    const volumeSlider = (key: 'volume' | 'musicVolume' | 'effectsVolume', label: string): string => {
      const pct = Math.round(s[key] * 100);
      return slider(key, label, 0, 1, .01, pct / 100, pct + '%');
    };
    const audio = volumeSlider('volume', 'MASTER VOLUME') +
      volumeSlider('musicVolume', 'MUSIC VOLUME') + volumeSlider('effectsVolume', 'EFFECTS VOLUME');
    const content = this.settingsTab === 'controls' ? controls :
      this.settingsTab === 'video' ? video : audio;
    const backTarget = this.settingsReturn === 'pause' ? 'pause' : 'title';
    return `<div class="gg-settings-head"><div><div class="gg-shell-eyebrow">TUNE YOUR GOAT</div>` +
      `<h2>SETTINGS</h2></div><button type="button" data-action="back" class="gg-settings-back"` +
      ` aria-label="Back to ${backTarget}" ${menuSkin(MENU_SPRITES.back)}>Back</button></div>` +
      `<nav class="gg-settings-tabs" role="tablist" aria-label="Settings sections">${tabs}</nav>` +
      `<div class="gg-settings-content" role="tabpanel" id="gg-settings-panel"` +
      ` aria-labelledby="gg-tab-${this.settingsTab}">${content}</div>` +
      `<p class="gg-settings-note">Changes apply immediately and save with your game.</p>`;
  }
  private selectBoardOffer(choice: HTMLButtonElement): void {
    const offerId = choice.dataset.boardOffer;
    const accept = this.root.querySelector<HTMLButtonElement>('[data-action^="offer:"]');
    const note = this.root.querySelector('[data-board-note]');
    if (!offerId || !accept || !note) return;
    for (const candidate of this.root.querySelectorAll('[data-board-offer]')) {
      candidate.setAttribute('aria-pressed', String(candidate === choice));
    }
    note.textContent = choice.dataset.boardInstruction ?? '';
    accept.setAttribute('data-action', 'offer:' + offerId);
    this.audio?.playMenuCue('ui-click');
  }

  private boardBody(): string {
    const poi = this.boardPoi;
    const board = poi ? this.game.gigs.director.board(poi) : null;
    const offers = board?.offers.map(offer => this.game.gigs.catalog.build(offer)) ?? [];
    const first = offers[0];
    const titleCase = (value: string): string =>
      value.toLowerCase().replace(/(^|[ \-])[a-z]/g, part => part.toUpperCase());
    const choices = offers.map(({ offer, info, config }, index) =>
      `<button type="button" class="gg-board-choice" aria-pressed="${index === 0}"
        data-board-offer="${esc(offer.id)}" data-board-instruction="${esc(info.instruction)}"
        ${menuSkin(MENU_SPRITES.stat)}>
        ${gigBoardIcon(config.kind)}
        <span><strong>${esc(titleCase(info.title))}</strong><span class="gg-board-meta">
          <span class="gg-board-difficulty">${esc(titleCase(offer.difficulty))}</span>
          <span>${esc(gigBoardGoal(config))}</span>
          <span class="gg-board-coins">${info.baseCoins} base coins</span>
        </span></span>
      </button>`).join('');
    return `<div class="gg-shell-eyebrow">GIG BOARD · ${esc(nice(poi ?? ''))}</div><h2>MAKE CUD COINS</h2>
      ${first ? `<div class="gg-board-offers" role="group" aria-label="Available contracts">${choices}</div>
      <p class="gg-board-note" data-board-note aria-live="polite">${esc(first.info.instruction)}</p>` : '<p>Board is refreshing.</p>'}
      <div class="gg-options gg-board-actions">
        ${first ? menuButton('offer:' + esc(first.offer.id), '▶ ACCEPT CONTRACT', true) : ''}
        ${menuButton('back','← NOT NOW')}
      </div>
      ${board ? `<p class="gg-board-refresh">Offers rotate after ${Math.ceil(board.refreshInTicks / 60)}s of play</p>` : ''}`;
  }
  private gigResultsBody(): string {
    const run = this.game.pendingGigResult;
    if (!run) return '';
    const best = this.game.gigs.director.personalBests.find(b =>
      b.gigId === run.setup.offer.gigId && b.difficulty === run.setup.offer.difficulty);
    const success = run.status === 'completed';
    const status = success ? 'GIG CLEARED' + (run.rating ? ' · ' + nice(run.rating) : '') : 'GIG ENDED';
    const canRetry = this.game.gigs.retryableOffer !== null;
    const cosmetic = run.setup.info.cosmetic;
    const goldReward = success && run.rating === 'gold' &&
      this.game.gigs.director.ownedCosmetics.includes(cosmetic.id);
    const objective = run.objective;
    const progress = hudObjectiveParts(objective);
    if (objective.kind === 'deliver') progress.unit = 'BALES DELIVERED';
    if (objective.kind === 'displace') progress.unit = 'KG MOVED';
    if (objective.kind === 'splash') {
      progress.measure = objective.splashed ? objective.drop.toFixed(1) + 'm' : 'MISSED';
      progress.unit = 'WATER LANDING';
    }
    return `<div class="gg-shell-eyebrow">${status}</div>
      <h2>${esc(run.setup.info.title)}</h2>
      ${goldReward ? `<p><strong>GOLD REWARD</strong> · ${esc(cosmetic.name)}</p>` : ''}
      ${success ? '' : `<p>${esc(run.failReason ?? 'Try a different route and go again.')}</p>`}
      <div class="gg-stats">
        <div class="gg-stat gg-gig-progress" ${menuSkin(MENU_SPRITES.stat)}>
          <strong>${esc(progress.measure)}</strong><span>${esc(progress.unit)}</span></div>
        <div class="gg-stat" ${menuSkin(MENU_SPRITES.stat)}><strong>+${run.payout ?? 0}</strong>CUD COINS</div>
        <div class="gg-stat" ${menuSkin(MENU_SPRITES.stat)}><strong>${(run.elapsedTicks/60).toFixed(1)}s</strong>TIME</div>
      </div>
      <p>${best ? 'PERSONAL BEST: '+nice(best.rating)+' · '+(best.ticks/60).toFixed(1)+'s' : 'PERSONAL BEST: not yet'}</p>
      <div class="gg-options">${canRetry ? menuButton('retry-gig','↻ RETRY CONTRACT',true) :
        menuButton('play','▶ BACK TO FREE ROAM',true)}
      ${canRetry ? `<div class="gg-gig-result-return">${menuButton('play','▶ FREE ROAM')}${menuButton('title','⌂ TITLE')}</div>` :
        menuButton('title','⌂ TITLE')}</div>`;
  }
  private partyResultsBody(): string {
    const match = this.game.party.match;
    if (!match) return '';
    const { mode, players, placements, teamPlacements, tick, playTicks, peak } = match.toJSON();
    const teams = mode === 'hay-heist';
    const rising = mode === 'rising-tide';
    const playerTeam = players.find(player => player.id === 'player')?.teamId;
    const timed = (ticks: number): string => (ticks / TICKS_PER_SECOND).toFixed(1) + ' s';
    // Eliminations are stamped in absolute ticks. Play time excludes the countdown.
    const activeStart = tick - playTicks;
    const survivors = rising ? players.filter(player => player.eliminatedAt === null).length : 0;
    const rows: Array<{ rank: number; name: string; you: boolean; measure: string; detail?: string }> =
      teams ? teamPlacements.map(team => ({
        rank: team.rank, name: nice(team.teamId) + ' TEAM', you: team.teamId === playerTeam,
        measure: team.score + (team.score === 1 ? ' bale delivered' : ' bales delivered'),
      })) : placements.map(place => {
        const player = players.find(entry => entry.id === place.playerId);
        const row = { rank: place.rank, name: player?.name ?? place.playerId, you: place.playerId === 'player' };
        if (rising) {
          const survived = (player?.eliminatedAt ?? tick) - activeStart;
          let detail: string | undefined;
          if (player?.eliminatedAt === null) {
            detail = survivors === 1 ? 'Last goat standing' : player.headY.toFixed(2) + ' m final head height';
          } else if (survivors > 0 && player?.eliminatedAt === tick) {
            detail = 'Eliminated on the final rise';
          }
          return { ...row, measure: timed(survived) + ' survived', detail };
        }
        return { ...row, measure: place.score + ' peak points',
          detail: peak?.ownerId === place.playerId ? 'Held summit at finish' : undefined };
      });
    const rankCounts = new Map<number, number>();
    for (const row of rows) rankCounts.set(row.rank, (rankCounts.get(row.rank) ?? 0) + 1);
    const yours = rows.find(row => row.you);
    const tied = (rank: number): boolean => (rankCounts.get(rank) ?? 0) > 1;
    let outcome = 'ROUND COMPLETE';
    if (yours) {
      if (yours.rank === 1) {
        outcome = tied(1) ? (teams ? 'YOUR TEAM TIED FOR FIRST' : 'YOU TIED FOR FIRST') :
          (teams ? 'YOUR TEAM WON' : 'YOU WON');
      } else {
        outcome = (teams ? 'YOUR TEAM' : 'YOU') +
          (tied(yours.rank) ? ' TIED AT #' : ' PLACED #') + yours.rank;
      }
    }
    const summary = rising ? 'Final tide ' + match.tideLevel + ' m' :
      !teams ? 'Round time ' + timed(playTicks) : '';
    return `<header class="gg-party-results-head">
      <div class="gg-shell-eyebrow">ROUND COMPLETE</div><h2 id="gg-party-result-title">${esc(this.game.party.title)}</h2>
      <div class="gg-party-outcome"><strong>${outcome}</strong>
      <span>${esc([yours?.measure, summary].filter(Boolean).join(' · '))}</span></div></header>
      <ol class="gg-results" aria-label="Placements" tabindex="-1">${rows.map(row => `
        <li${row.you ? ' data-result-you' : ''}>
          <div class="gg-result-label"><strong class="gg-result-rank">#${row.rank}</strong>
          ${tied(row.rank) ? '<span class="gg-result-tie">TIE</span>' : ''}
          <span>${row.you && !teams ? '<strong class="gg-result-you">YOU</strong>' : esc(row.name)}</span>
          ${row.you && teams ? '<strong class="gg-result-you">YOU</strong>' : ''}</div>
          <div class="gg-result-measure"><strong>${esc(row.measure)}</strong>
          ${row.detail ? `<small>${esc(row.detail)}</small>` : ''}</div>
        </li>`).join('')}</ol>
      <div class="gg-options">${menuButton('leave-party','▶ FREE ROAM',true)}
      ${menuButton('title','⌂ TITLE')}</div>`;
  }
  private render(): void {
    this.resultLayout?.disconnect();
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
         ${menuButton('settings','⚙ CONTROLS &amp; SETTINGS')}${menuButton('title','⌂ QUIT TO TITLE')}</div>` :
      this.screen === 'party' ? this.partyBody() :
      this.screen === 'party-confirm' ? this.partyConfirmBody() :
      this.screen === 'settings' ? this.settingsBody() :
      this.screen === 'board' ? this.boardBody() :
      this.screen === 'gig-results' ? this.gigResultsBody() : this.partyResultsBody();
    const partyResults = this.screen === 'party-results';
    const panel = this.screen === 'title' ? 'gg-shell-panel gg-title-panel' :
      partyResults ? 'gg-shell-panel gg-party-results-panel' : 'gg-shell-panel';
    const dialogLabel = partyResults ? ' aria-labelledby="gg-party-result-title"' :
      this.screen === 'party-confirm' ?
        ' aria-labelledby="gg-party-confirm-title" aria-describedby="gg-party-confirm-detail"' : '';
    const footer = partyResults
      ? '<span data-results-scroll-hint hidden>PgUp/PgDn or right stick scroll · </span>Esc or B back'
      :
      'Enter / click select · ↑↓ navigate · Gamepad A select, B back · Esc back' +
      (this.screen === 'settings' && this.settingsTab === 'controls' ? ' · PgUp/PgDn or right stick scroll' : '');
    this.root.innerHTML = `<section class="${panel}" role="dialog" aria-modal="true"${dialogLabel} ${menuSkin(MENU_SPRITES.panel)}>${body}
      <footer>${footer}</footer></section>`;
    this.syncFullscreen();
    if (partyResults) {
      this.syncPartyResultsScroll();
      const standings = this.root.querySelector('.gg-results');
      if (standings) this.resultLayout?.observe(standings);
    }
    this.root.querySelector<HTMLElement>('button')?.focus();
  }
  dispose(): void {
    this.save();
    this.resultLayout?.disconnect();
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('pagehide', this.pageHide);
    document.removeEventListener('fullscreenchange', this.fullscreenChange);
    document.removeEventListener('pointerlockchange', this.pointerLockChange);
    this.root.remove(); this.style.remove();
    this.view.onFrame = null; this.view.onInteract = null;
  }
}
