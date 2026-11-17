import type { Game } from './Game';
import { HUD_PIECES, deriveHudState, projectHudMap } from './GameHudState';
import { buildArtwork, goatArtwork, renderHudMinimap } from './HudArtwork';
import { planGoatSafeHud, type ScreenRect } from './HudOcclusion';
import { fitGigCardText } from './GigCardLayout';
import { HUD_SPRITES, hudSpriteImage, hudSpriteVariables } from './HudSprites';

const CSS = `
.gg-ui{position:absolute;inset:0;z-index:4;pointer-events:none;user-select:none;overflow:hidden;color:#fff9df;font-family:"Trebuchet MS","Arial Rounded MT Bold","Arial Black",system-ui,sans-serif;font-weight:900;text-shadow:1px 2px 1px #493049,0 3px 3px #38253b9a;-webkit-font-smoothing:antialiased}
.gg-ui *{box-sizing:border-box}
.gg-ui [hidden]{display:none!important}
.gg-ui img{display:block;object-fit:contain;pointer-events:none;user-select:none}
.gg-meter,.gg-map-panel,.gg-gig-card,.gg-stamina,.gg-hotbar{filter:drop-shadow(0 5px 2px #281b4890)}
/* Composited panel art stays in its natural proportions. The only painted
   interiors are live state (meter, stamina and charge) over the empty sprites. */
.gg-meter{position:absolute;left:clamp(12px,1.35vw,25px);top:clamp(10px,1.2vw,21px);width:clamp(365px,31.5vw,535px);height:clamp(150px,11.8vw,205px);background:var(--gg-sizeMeterFrame) center/100% 100% no-repeat}
.gg-meter-label{position:absolute;left:15%;right:14%;top:5%;height:18%;display:grid;place-items:center;white-space:nowrap;color:#ffdd40;font-size:clamp(16px,1.6vw,26px);line-height:1;letter-spacing:.5px;-webkit-text-stroke:.65px #8c4251;text-shadow:2px 3px 0 #74304a,0 -1px #fff4a9}
.gg-meter-icons{position:absolute;left:9%;right:8%;top:15%;height:48%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:end}
.gg-meter-stage{position:relative;min-width:0;height:100%;display:flex;justify-content:center;align-items:end;opacity:.82;transition:opacity .14s,transform .14s}
.gg-meter-stage .gg-goat-art{width:90%;height:84%;object-position:center bottom;filter:drop-shadow(0 2px 1px #44254c9c)}
.gg-meter-stage:nth-child(2) .gg-goat-art{height:100%}
.gg-meter-stage:nth-child(3) .gg-goat-art{height:110%}
.gg-meter-stage:nth-child(4) .gg-goat-art{height:131%;width:110%}
.gg-meter-stage.is-active{opacity:1;transform:translateY(-3px);filter:drop-shadow(0 0 7px #ffef81)}
.gg-meter-track{position:absolute;left:6%;right:5.8%;top:58%;height:14.8%;border-radius:99px;background:#3d3041dd;overflow:visible;box-shadow:inset 0 2px 4px #241b33}
.gg-meter-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#52f143 0%,#d9f130 33%,#ffb52f 65%,#ff3653 100%);box-shadow:inset 0 2px 3px #fff8b6;transition:width .12s linear}
.gg-meter-ticks{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,transparent 25%,#6a3445 25%,#6a3445 25.6%,transparent 25.6%,transparent 50%,#6a3445 50%,#6a3445 50.6%,transparent 50.6%,transparent 75%,#6a3445 75%,#6a3445 75.6%,transparent 75.6%);opacity:.7}
.gg-meter-arrow{position:absolute;top:100%;left:0;transform:translateX(-50%) rotate(180deg);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:13px solid #fff9be;filter:drop-shadow(0 2px 1px #592944);transition:left .12s linear}
.gg-meter-stage-labels{position:absolute;left:8%;right:6%;top:80%;height:13%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:center}
.gg-meter-stage-labels span{text-align:center;white-space:nowrap;color:#fff8dd;font-size:clamp(12px,1.1vw,19px);line-height:1;text-shadow:1px 2px 1px #42304f}
.gg-meter-stage-labels span.is-active{color:#fffbd1;text-shadow:0 0 7px #fff5ac,1px 2px 1px #56264a}
.gg-meter-caption{position:absolute;top:98%;left:8%;right:8%;display:flex;justify-content:space-between;gap:8px;color:#fff0ae;font-size:clamp(8px,.67vw,11px);letter-spacing:.3px;white-space:nowrap}
/* The star, rays, purple combo badge and brown score ribbon are one sprite. */
.gg-combo{position:absolute;left:50%;top:clamp(4px,.7vw,12px);transform:translateX(-50%);width:clamp(377px,32.3vw,545px);height:clamp(155px,12.7vw,217px);background:var(--gg-scoreStarburst) center/100% 100% no-repeat;text-align:center}
.gg-combo-title{position:absolute;left:8%;top:19%;width:64%;height:47%;display:flex;align-items:center;justify-content:center;overflow:hidden;overflow-wrap:anywhere;line-height:.93;transform:rotate(-5deg);font-style:italic;letter-spacing:-.7px;color:#ffcd36;font-size:clamp(22px,2.35vw,39px);-webkit-text-stroke:1.2px #802847;text-shadow:2px 3px 0 #682a46,4px 4px 0 #fff2a4,5px 6px 0 #4d2c61}
.gg-combo-count{position:absolute;left:73%;top:22%;width:22%;height:38%;display:grid;place-items:center;transform:rotate(-7deg);color:#fff8e3;font-size:clamp(10px,1.12vw,17px);line-height:1.12;white-space:pre-line;overflow-wrap:normal;text-shadow:1px 2px #4a2358}
.gg-score-ribbon{position:absolute;left:11%;right:21%;bottom:6%;height:28%;display:grid;place-items:center}
.gg-score{font-variant-numeric:tabular-nums;font-size:clamp(27px,2.55vw,44px);letter-spacing:1px;color:#fff8df;text-shadow:2px 3px #3d203c}
.gg-score-caption{position:absolute;left:32%;right:34%;bottom:1%;font-size:clamp(7px,.58vw,10px);letter-spacing:.4px;color:#fff0ba;white-space:nowrap}
/* Live SVG terrain is clipped inside the transparent PNG ring. */
.gg-map-panel{position:absolute;right:clamp(8px,1.15vw,22px);top:clamp(6px,.7vw,12px);width:clamp(190px,17vw,290px);aspect-ratio:311/337}
.gg-map-frame{position:absolute;left:4.5%;top:7.5%;width:91%;height:76%;overflow:hidden;border-radius:50%;background:#8abd75}
.gg-map-frame svg{width:100%;height:100%;display:block}
.gg-map-skin{position:absolute;inset:0;background:var(--gg-minimapRing) center/100% 100% no-repeat}
.gg-map-north{position:absolute;top:1%;left:42%;width:16%;height:16%}
.gg-compass{width:100%;height:100%}
.gg-map-location{position:absolute;left:12%;right:12%;bottom:5%;height:13%;display:grid;place-items:center;white-space:nowrap;font-size:clamp(11px,1.25vw,19px);color:#fff5d4;letter-spacing:.1px}
.gg-gig-card{position:absolute;right:clamp(10px,1.2vw,23px);top:clamp(234px,19vw,316px);width:clamp(280px,23.5vw,390px);height:clamp(150px,12.4vw,208px);background:var(--gg-gigCard) center/100% 100% no-repeat}
.gg-gig-header{position:absolute;top:9%;left:27%;right:9%;height:19%;display:grid;place-items:center;color:#ffcc43;font-size:clamp(15px,1.4vw,23px);white-space:nowrap;letter-spacing:.3px;-webkit-text-stroke:.6px #623645;text-shadow:2px 3px #583147}
.gg-gig-clipboard{position:absolute;left:-17%;top:-33%;width:clamp(45px,4vw,67px);height:clamp(48px,4.5vw,72px)}
.gg-gig-clipboard img{width:100%;height:100%}
/* The checkbox is painted into gig_card.png. Copy an adjacent, empty part of
   that same cream sprite over it; only draw a live box for a running gig. */
.gg-gig-checkbox-mask{position:absolute;left:8.3%;top:50.2%;width:10.7%;height:24%;background:var(--gg-gigCard) 27% 67%/935% 417% no-repeat;pointer-events:none}
.gg-gig-checkbox{position:absolute;left:9.2%;top:52%;width:8.5%;height:18%;border:clamp(2px,.21vw,3px) solid #58331f;border-radius:5px;background:#fff2d34d;box-shadow:0 1px 1px #6a411744;pointer-events:none}
/* The sprite ribbon reaches below the CURRENT GIG text box (~43% of the art).
   Start the live copy below that painted edge while keeping room above the footer. */
.gg-gig-paper{position:absolute;left:20.5%;right:10%;top:47%;bottom:20%;display:flex;flex-direction:column;align-items:stretch;gap:1px;min-width:0;min-height:0;color:#4e312b;text-shadow:none}
.gg-gig-title{flex:0 0 auto;font-size:clamp(9px,.77vw,13px);font-weight:1000;line-height:1.12;text-transform:uppercase;letter-spacing:.2px;color:#a55c30;margin:0;min-width:0;overflow-wrap:anywhere}
.gg-gig-task{flex:0 1 auto;min-height:0;min-width:0;font-size:clamp(11px,.98vw,16px);line-height:1.13;font-weight:1000;margin:0;overflow-wrap:anywhere}
.gg-gig-detail{flex:0 0 auto;min-width:0;font-size:clamp(8px,.66vw,11px);line-height:1.12;color:#93543e;overflow-wrap:anywhere;white-space:normal}
.gg-gig-footer{position:absolute;left:20%;right:12%;bottom:9%;height:10%;display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:0;color:#fff2ad;font-size:clamp(8px,.7vw,11px);white-space:nowrap;text-shadow:1px 2px #583147}
.gg-gig-wallet{display:flex;align-items:center;gap:3px;flex-shrink:0;min-width:0}
.gg-gig-footer [data-mode]{flex-shrink:0;text-align:right}
.gg-coin{width:clamp(13px,1.25vw,19px);height:clamp(13px,1.25vw,19px);flex-shrink:0}
/* Progress is a live masked conic arc painted on top of the illustrated ring. */
.gg-stamina{position:absolute;left:clamp(11px,1.5vw,29px);bottom:clamp(10px,1.5vw,26px);width:clamp(138px,12.7vw,215px);aspect-ratio:243/252;background:var(--gg-staminaRing) center/100% 100% no-repeat}
.gg-stamina-progress{position:absolute;inset:8%;border-radius:50%;background:conic-gradient(from -90deg,#9aff33 0 var(--gg-stamina,100%),#3c304c var(--gg-stamina,100%) 100%);-webkit-mask:radial-gradient(farthest-side,transparent 60%,#000 63% 84%,transparent 87%);mask:radial-gradient(farthest-side,transparent 60%,#000 63% 84%,transparent 87%)}
.gg-stamina-inner{position:absolute;inset:23% 17% 17%;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gg-hoof{width:56%;height:55%;filter:drop-shadow(0 2px 1px #422c3b)}
.gg-stamina-label{margin-top:2px;color:#ffe8ad;font-size:clamp(13px,1.2vw,20px);line-height:1.1;transform:rotate(6deg);text-shadow:2px 2px #4b2840}
.gg-stamina-value{font-size:clamp(8px,.72vw,12px);color:#fff7c9;margin-top:2px}
.gg-hotbar{position:absolute;left:50%;bottom:clamp(3px,.6vw,10px);transform:translateX(-50%);width:clamp(500px,40vw,665px);height:clamp(126px,10.35vw,186px);background:var(--gg-hotbarTray) center/100% 100% no-repeat}
.gg-hotbar-header{position:absolute;left:30%;right:24%;top:9%;height:23%;display:grid;place-items:center;padding-left:38px;color:#ffe4a3;font-size:clamp(17px,1.42vw,24px);line-height:1;white-space:nowrap;letter-spacing:.5px;text-shadow:2px 3px #5b2e42}
.gg-hotbar-slots{position:absolute;left:11%;right:11%;top:37%;height:54%;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1.8%}
.gg-slot{position:relative;min-width:0;min-height:0;border:11px solid transparent;border-image:var(--gg-hotbarSlot) 44 fill / 11px / 0 stretch}
.gg-slot.is-selected{border-image-source:var(--gg-hotbarSlotSelected);z-index:1;filter:drop-shadow(0 0 4px #ffe450)}
.gg-slot.is-empty .gg-piece-art{opacity:.55}
.gg-slot-key{position:absolute;z-index:4;left:-14%;top:-16%;width:clamp(23px,2vw,34px);height:clamp(24px,2.1vw,36px);display:grid;place-items:center;border:8px solid transparent;border-image:var(--gg-keyBadge) 32 fill / 8px / 0 stretch;color:#633c26;font-size:clamp(11px,.94vw,16px);line-height:1;text-shadow:none}
.gg-piece-art{position:absolute;width:74%;height:76%;left:13%;top:9%;filter:drop-shadow(0 3px 2px #3d2528a0)}
.gg-slot-count{position:absolute;right:3%;bottom:0;z-index:3;font-size:clamp(12px,1.04vw,18px);line-height:1;color:#fff7da;text-shadow:2px 2px #33243e}
.gg-slot-name{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden;white-space:nowrap}
.gg-hotbar-foot{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden;white-space:nowrap}
.gg-hotbar-charge{position:absolute;left:16%;right:16%;bottom:4.5%;height:3px;border-radius:6px;background:#442742;overflow:hidden}
.gg-hotbar-charge>div{height:100%;width:0;background:linear-gradient(90deg,#f6a32c,#fff071);transition:width .12s linear}
/* The prompt, key badge and slot art are genuine nine-slice border images. */
.gg-board-hint,.gg-hint{position:absolute;left:50%;top:clamp(184px,14.5vw,232px);transform:translateX(-50%);display:flex;flex-wrap:nowrap;align-items:center;justify-content:center;gap:6px;width:max-content;max-width:82vw;min-height:37px;padding:1px 11px;border:13px solid transparent;border-image:var(--gg-promptPill) 37 fill / 13px / 0 stretch;text-align:center;color:#5a352c;font-size:clamp(11px,.88vw,14px);line-height:1.15;text-shadow:none;white-space:nowrap}
.gg-board-hint{top:clamp(219px,17vw,275px)}
.gg-prompt-key{display:grid;place-items:center;flex:0 0 auto;min-width:28px;height:26px;padding:0 5px;border:7px solid transparent;border-image:var(--gg-keyBadge) 31 fill / 7px / 0 stretch;color:#603827;text-shadow:none}
.gg-prompt-copy{flex:0 0 auto;white-space:nowrap}
.gg-prompt-mouse{font-family:"Segoe UI Symbol","Apple Color Emoji",system-ui,sans-serif;font-size:13px;line-height:1}
.gg-debug{position:absolute;left:20px;top:230px;background:#192542e8;border:2px solid #b7dfbc;border-radius:12px;padding:10px;font:12px/1.5 monospace;white-space:pre;color:#d7ffc9;text-shadow:none}
@media(max-width:1380px){
 .gg-meter{left:12px;top:13px}
 .gg-map-panel{right:10px}
 .gg-gig-card{right:9px}
 .gg-meter-caption{display:none}
 .gg-hotbar-foot{display:none}
}
@media(max-width:760px){
 .gg-meter{left:6px;top:8px;width:min(270px,51vw);height:clamp(105px,21vw,128px)}
 .gg-meter-label{font-size:clamp(10px,2vw,15px)}
 .gg-meter-stage-labels span{font-size:9px}
 .gg-meter-arrow{border-left-width:5px;border-right-width:5px;border-top-width:8px}
 .gg-combo{left:35%;top:130px;width:min(290px,56vw);height:126px}
 .gg-combo-title{font-size:clamp(16px,3.6vw,24px);-webkit-text-stroke:.6px #802847}
 .gg-combo-count{font-size:8px}
 .gg-score{font-size:clamp(18px,4vw,28px)}
 .gg-map-panel{top:5px;right:5px;width:clamp(115px,27vw,160px)}
 .gg-map-location{font-size:9px}
 .gg-gig-card{top:clamp(172px,39vw,265px);right:6px;width:min(235px,39vw);height:clamp(115px,24vw,146px)}
 .gg-gig-header{font-size:clamp(10px,2.2vw,14px)}
 .gg-gig-clipboard{width:29px;height:34px}
 .gg-gig-task{font-size:clamp(9px,2vw,12px)}
 .gg-gig-title,.gg-gig-detail{font-size:7px}
 .gg-gig-footer{font-size:7px}
 .gg-stamina{left:7px;bottom:125px;width:102px}
 .gg-stamina-label{font-size:11px}.gg-stamina-value{font-size:8px}
 .gg-hotbar{width:calc(100% - 9px);height:115px;bottom:2px}
 .gg-hotbar-header{font-size:clamp(12px,3vw,19px)}
 .gg-slot{border-width:7px;border-image-width:7px}
 .gg-slot-key{width:21px;height:23px;font-size:10px;border-width:5px;border-image-width:5px}
 .gg-slot-count{font-size:10px}.gg-slot-name{font-size:6px}
 .gg-board-hint,.gg-hint{top:164px;font-size:9px;white-space:normal;max-width:54vw;padding:0 5px;width:auto;flex-wrap:wrap}
 .gg-prompt-copy{flex:0 1 auto;white-space:normal}
 .gg-board-hint{top:208px}.gg-prompt-key{min-width:22px;height:22px}
 .gg-debug{top:280px;left:5px;font-size:9px}
}
@media(max-height:680px) and (min-width:761px){
 .gg-combo{height:155px}.gg-gig-card{top:207px}.gg-stamina{width:130px}
 .gg-hotbar{height:125px}
}
`;

/** Sampled from renderer.info after a submitted frame (renderMs is CPU submit time). */
export interface FramePerformance {
  fps: number;
  frameMs: number;
  physicsMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  pixelRatio: number;
}

export class GameHud {
  private readonly root = document.createElement('div');
  private readonly styles = document.createElement('style');
  private readonly fill: HTMLElement;
  private readonly meterText: HTMLElement;
  private readonly tier: HTMLElement;
  private readonly needle: HTMLElement;
  private readonly stages: HTMLElement[];
  private readonly stageLabels: HTMLElement[];
  private readonly comboTitle: HTMLElement;
  private readonly comboCount: HTMLElement;
  private readonly comboInfo: HTMLElement;
  private readonly score: HTMLElement;
  private readonly place: HTMLElement;
  private readonly mapCanvas: SVGElement;
  private playerArrow: SVGElement | null = null;
  private mapOrigin: { x: number; z: number } | null = null;
  private mapZone = '';
  private readonly stamina: HTMLElement;
  private readonly staminaNumber: HTMLElement;
  private readonly charge: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly buildStatus: HTMLElement;
  private readonly slots: HTMLElement[];
  private readonly quantities: Array<HTMLElement | null>;
  private readonly supply: HTMLElement;
  private readonly stageElements: HTMLElement[];
  private readonly materials: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly gigCard: HTMLElement;
  private readonly gigCheckbox: HTMLElement;
  private gigLayoutKey = '';
  private readonly gigTitle: HTMLElement;
  private readonly gigTask: HTMLElement;
  private readonly gigDetail: HTMLElement;
  private readonly board: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly panels: Array<{ id: string; element: HTMLElement }>;

  constructor(host: HTMLElement) {
    this.styles.textContent = CSS + '\n.gg-ui{' + hudSpriteVariables() + '}';
    document.head.appendChild(this.styles);
    this.root.className = 'gg-ui';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Gigga-Goat game HUD');
    const stages = ['Kid', 'Billy', 'Big', 'GIGGA'] as const;
    const stageHtml = stages.map(name =>
      '<span class="gg-meter-stage" data-stage="' + name + '">' +
      goatArtwork(name) + '</span>').join('');
    const stageLabels = stages.map(name =>
      '<span data-stage-label="' + name + '">' + name.toUpperCase() + '</span>').join('');

    const hotbar = HUD_PIECES.map(piece =>
      '<div class="gg-slot" data-sprite="' + HUD_SPRITES.hotbarSlot +
      '" data-sprite-selected="' + HUD_SPRITES.hotbarSlotSelected +
      '" data-slot="' + piece.type + '" title="' + piece.label + '">' +
      '<span class="gg-slot-key" data-sprite="' + HUD_SPRITES.keyBadge + '">' +
      piece.key + '</span>' + buildArtwork(piece.type) +
      '<span class="gg-slot-name">' + piece.label + '</span>' +
      '<span class="gg-slot-count" data-quantity>×0</span></div>').join('');
    this.root.innerHTML =
      '<section class="gg-meter" data-sprite="' + HUD_SPRITES.sizeMeterFrame +
      '" aria-label="Gigga size meter">' +
      '<div class="gg-meter-label">GIGGA SIZE METER</div>' +
      '<div class="gg-meter-icons">' + stageHtml + '</div>' +
      '<div class="gg-meter-track"><div class="gg-meter-fill" data-fill></div>' +
      '<div class="gg-meter-ticks"></div><div class="gg-meter-arrow" data-needle></div></div>' +
      '<div class="gg-meter-stage-labels">' + stageLabels + '</div>' +
      '<div class="gg-meter-caption"><span>CHAOS MAKES YOU BIGGER</span>' +
      '<span><b data-tier>KID</b> · <b data-meter>0 / 100</b></span></div></section>' +
      '<section class="gg-combo" data-sprite="' + HUD_SPRITES.scoreStarburst +
      '" aria-label="Chaos combo and score">' +
      '<div class="gg-combo-title" data-combo-title>GIGGA-GOAT!</div>' +
      '<div class="gg-combo-count" data-combo-count>START A COMBO!</div>' +
      '<div class="gg-score-ribbon"><strong class="gg-score" data-score>0</strong></div>' +
      '<div class="gg-score-caption" data-combo-info>STYLE SCORE</div></section>' +
      '<section class="gg-map-panel" data-sprite="' + HUD_SPRITES.minimapRing +
      '" aria-label="Island minimap">' +
      '<div class="gg-map-frame"><svg data-map viewBox="0 0 280 280" aria-hidden="true"></svg></div>' +
      '<div class="gg-map-skin" aria-hidden="true"></div>' +
      '<div class="gg-map-north" aria-label="North">' +
      hudSpriteImage(HUD_SPRITES.compassN, 'gg-compass') + '</div>' +
      '<div class="gg-map-location"><strong data-place>HOOFINGTON</strong></div></section>' +
      '<section class="gg-gig-card" data-sprite="' + HUD_SPRITES.gigCard +
      '" data-gig-card aria-label="Current gig">' +
      '<div class="gg-gig-header"><span class="gg-gig-clipboard">' +
      hudSpriteImage(HUD_SPRITES.gigClipboard, 'gg-clipboard-art') +
      '</span>CURRENT GIG</div>' +
      '<span class="gg-gig-checkbox-mask" aria-hidden="true"></span>' +
      '<span class="gg-gig-checkbox" data-gig-checkbox aria-hidden="true" hidden></span>' +
      '<div class="gg-gig-paper"><h2 class="gg-gig-title" data-gig-title>YOUR NEXT GIG</h2>' +
      '<p class="gg-gig-task" data-gig-task></p>' +
      '<small class="gg-gig-detail" data-gig-detail></small></div>' +
      '<div class="gg-gig-footer"><span class="gg-gig-wallet">' +
      hudSpriteImage(HUD_SPRITES.cudCoin, 'gg-coin') +
      '<span data-wallet>0 CUD COINS</span></span><span data-mode>FREE ROAM</span></div></section>' +
      '<section class="gg-stamina" data-sprite="' + HUD_SPRITES.staminaRing +
      '" data-stamina aria-label="Stamina">' +
      '<div class="gg-stamina-progress" aria-hidden="true"></div>' +
      '<div class="gg-stamina-inner">' +
      hudSpriteImage(HUD_SPRITES.staminaHooves, 'gg-hoof') +
      '<strong class="gg-stamina-label">STAMINA</strong>' +
      '<span class="gg-stamina-value" data-stamina-number>100</span></div></section>' +
      '<section class="gg-hotbar" data-sprite="' + HUD_SPRITES.hotbarTray +
      '" data-hotbar aria-label="Hay-Build hotbar">' +
      '<div class="gg-hotbar-header">HAY-BUILD</div>' +
      '<div class="gg-hotbar-slots">' + hotbar +
      '<div class="gg-slot gg-supply" data-sprite="' + HUD_SPRITES.hotbarSlot +
      '" title="Materials in your inventory">' +
      '<span class="gg-slot-key" data-sprite="' + HUD_SPRITES.keyBadge + '">5</span>' +
      buildArtwork('supplies') +
      '<span class="gg-slot-name">SUPPLIES</span><span class="gg-slot-count" data-supply>×0</span></div></div>' +
      '<div class="gg-hotbar-foot"><span class="gg-build-tip" data-build-status>B TO BUILD · 1–4 SELECT</span>' +
      '<strong data-materials></strong></div><div class="gg-hotbar-charge"><div data-charge></div></div></section>' +
      '<div class="gg-board-hint" data-sprite="' + HUD_SPRITES.promptPill +
      '" data-board-hint hidden><span class="gg-prompt-key" data-sprite="' +
      HUD_SPRITES.keyBadge + '">E</span><span class="gg-prompt-copy">GOAT GIGS · GAMEPAD X</span></div>' +
      '<div class="gg-hint" data-sprite="' + HUD_SPRITES.promptPill +
      '" data-hint><span class="gg-prompt-key gg-prompt-mouse" data-sprite="' +
      HUD_SPRITES.keyBadge + '" aria-hidden="true">🖱</span>' +
      '<span class="gg-prompt-copy" data-hint-copy>CLICK TO PLAY · MOUSE TO LOOK</span></div>' +
      '<div class="gg-debug" data-debug hidden></div>';
    host.appendChild(this.root);
    const get = (name: string): HTMLElement => {
      const element = this.root.querySelector<HTMLElement>('[data-' + name + ']');
      if (!element) throw new Error('HUD element missing: ' + name);
      return element;
    };
    this.fill = get('fill'); this.meterText = get('meter'); this.tier = get('tier');
    this.needle = get('needle');
    this.stages = Array.from(this.root.querySelectorAll<HTMLElement>('[data-stage]'));
    this.stageLabels = Array.from(this.root.querySelectorAll<HTMLElement>('[data-stage-label]'));
    this.stageElements = this.stages.concat(this.stageLabels);
    this.comboTitle = get('combo-title'); this.comboCount = get('combo-count');
    this.comboInfo = get('combo-info'); this.score = get('score');
    this.place = get('place');
    const map = this.root.querySelector<SVGElement>('[data-map]');
    if (!map) throw new Error('HUD minimap missing');
    this.mapCanvas = map;
    this.stamina = get('stamina'); this.staminaNumber = get('stamina-number');
    this.charge = get('charge'); this.mode = get('mode');
    this.buildStatus = get('build-status'); this.materials = get('materials');
    this.slots = Array.from(this.root.querySelectorAll<HTMLElement>('[data-slot]'));
    this.quantities = this.slots.map(element => element.querySelector<HTMLElement>('[data-quantity]'));
    this.supply = get('supply');
    this.hint = get('hint'); this.debug = get('debug'); this.wallet = get('wallet');
    this.gigCard = get('gig-card'); this.gigCheckbox = get('gig-checkbox');
    this.gigTitle = get('gig-title'); this.gigTask = get('gig-task');
    this.gigDetail = get('gig-detail'); this.board = get('board-hint');
    this.hotbar = get('hotbar');
    const panel = (id: string, selector: string): { id: string; element: HTMLElement } => {
      const element = this.root.querySelector<HTMLElement>(selector);
      if (!element) throw new Error('HUD panel missing: ' + selector);
      return { id, element };
    };
    this.panels = [
      panel('meter', '.gg-meter'), panel('combo', '.gg-combo'),
      panel('map', '.gg-map-panel'), panel('gig', '.gg-gig-card'),
      panel('stamina', '.gg-stamina'), panel('hotbar', '.gg-hotbar'),
      panel('debug', '.gg-debug'),
    ];
  }

  private updateMap(game: Game, location: string): void {
    const position = game.goat.torso.translation();
    const site = game.island.pois.find(poi => poi.name.toUpperCase() === location);
    const zone = site?.id ?? 'open-island';
    if (!this.mapOrigin || this.mapZone !== zone ||
      Math.hypot(position.x - this.mapOrigin.x, position.z - this.mapOrigin.z) > 96) {
      this.mapOrigin = site ? { x: site.center.x, z: site.center.z } :
        { x: position.x, z: position.z };
      // When far from a site's centre, follow the goat rather than clipping the marker.
      if (Math.hypot(position.x - this.mapOrigin.x, position.z - this.mapOrigin.z) > 96) {
        this.mapOrigin = { x: position.x, z: position.z };
      }
      this.mapZone = zone;
      this.mapCanvas.innerHTML = renderHudMinimap(game.island, this.mapOrigin);
      this.playerArrow = this.mapCanvas.querySelector<SVGElement>('[data-player]');
    }
    if (this.playerArrow && this.mapOrigin) {
      const point = projectHudMap(position, this.mapOrigin);
      const degrees = game.goat.locomotion.heading * 180 / Math.PI;
      this.playerArrow.setAttribute('transform', 'translate(' + point.x.toFixed(1) + ' ' +
        point.y.toFixed(1) + ') rotate(' + degrees.toFixed(0) + ')');
    }
  }

  private updatePartyCard(game: Game): void {
    const match = game.party.match;
    if (!match) return;
    const view = match.view();
    const you = view.players.find(p => p.id === 'player');
    const seconds = Math.max(0, Math.ceil((view.config.durationTicks -
      match.toJSON().playTicks) / 60));
    let task = '', detail = '';
    if (view.mode === 'rising-tide') {
      const alive = view.players.filter(p => p.eliminatedAt === null).length;
      task = alive + ' GOATS LEFT · SEA ' + view.tideLevel.toFixed(1) + 'm';
      const tide = match.toJSON().tide;
      const until = tide ? Math.ceil((tide.nextRiseTick - tide.modeTicks) / 60) : 0;
      detail = match.phase === 'countdown' ? 'GET READY!' :
        'NEXT RISE ' + Math.max(0, until) + 's · ' +
        (until <= view.config.tideWarningTicks / 60 ? 'TIDE WARNING!' : 'FIND HIGH GROUND');
    } else if (view.mode === 'king-of-the-peak') {
      task = 'YOUR SCORE ' + (you?.score ?? 0) + ' · GOAL ' + view.config.peakTargetScore;
      const peak = match.toJSON().peak;
      detail = match.phase === 'countdown' ? 'GET READY TO CLIMB!' :
        peak?.contested ? 'PEAK CONTESTED · PUSH THEM OUT!' :
        peak?.ownerId === 'player' ? 'YOU CONTROL THE ZONE!' :
        peak?.ownerId ? 'PEAK HELD BY ' +
          (view.players.find(p => p.id === peak.ownerId)?.name ?? 'A RIVAL').toUpperCase() :
          'ZONE EMPTY · CLIMB TO CAPTURE!';
    } else {
      task = Object.entries(view.teamScores)
        .map(([team, score]) => team.toUpperCase() + ' ' + score).join(' · ');
      detail = 'STEAL ENEMY HAY · ' +
        (match.getEffects('player').carryingBaleId ? 'CARRYING!' : 'HOLD LICK TO PICK UP');
    }
    this.gigTask.textContent = task;
    this.gigDetail.textContent = detail + ' · ' + seconds + 's';
  }


  /** Move transient prompts above the projected goat, then hide any remaining
   * fixed panel whose painted bounds would obscure its visible silhouette.
   * Visibility preserves layout measurements, so panels reappear as soon as
   * the player/camera moves clear on the next render frame. */
  private clearGoat(goat: ScreenRect | null): void {
    if (!goat || this.root.clientWidth === 0 || this.root.clientHeight === 0) {
      for (const panel of this.panels) panel.element.style.visibility = 'visible';
      for (const prompt of [this.board, this.hint]) {
        prompt.style.visibility = 'visible';
        prompt.style.removeProperty('left');
        prompt.style.removeProperty('top');
      }
      return;
    }

    const paintedBox = (element: HTMLElement): ScreenRect => {
      const initial = element.getBoundingClientRect();
      const result = { left: initial.left, top: initial.top,
        right: initial.right, bottom: initial.bottom };
      // These labels/ornaments extend beyond the containing panel border.
      element.querySelectorAll<HTMLElement>(
        '.gg-meter-label,.gg-meter-icons,.gg-map-north,.gg-map-location,.gg-gig-clipboard,.gg-hotbar-header'
      ).forEach(child => {
        const edge = child.getBoundingClientRect();
        result.left = Math.min(result.left, edge.left);
        result.top = Math.min(result.top, edge.top);
        result.right = Math.max(result.right, edge.right);
        result.bottom = Math.max(result.bottom, edge.bottom);
      });
      return result;
    };
    const viewport = this.root.getBoundingClientRect();
    const panels = this.panels.filter(({ element }) => !element.hidden)
      .map(({ id, element }) => ({ id, rect: paintedBox(element) }));
    const candidates = [
      { id: 'board', element: this.board },
      { id: 'hint', element: this.hint },
    ].filter(({ element }) => !element.hidden && element.style.display !== 'none');
    const layout = planGoatSafeHud(goat, viewport, panels,
      candidates.map(({ id, element }) => {
        const rect = element.getBoundingClientRect();
        return { id, width: rect.width, height: rect.height };
      }));
    for (const panel of this.panels) {
      panel.element.style.visibility = layout.hiddenPanels.has(panel.id) ? 'hidden' : 'visible';
    }
    for (const { id, element } of candidates) {
      const rect = layout.prompts.get(id);
      element.style.visibility = rect ? 'visible' : 'hidden';
      if (rect) {
        element.style.bottom = 'auto';
        element.style.left = ((rect.left + rect.right) / 2 - viewport.left) + 'px';
        element.style.top = (rect.top - viewport.top) + 'px';
      }
    }
  }

  update(game: Game, fps: number, stepMilliseconds: number, debugVisible: boolean,
    pointerLocked: boolean, goatScreenBox: ScreenRect | null = null,
    perf?: FramePerformance): void {
    const rules = game.rules;
    const run = game.gigs.active;
    const state = deriveHudState({
      tier: rules.style.tier, meter: rules.style.meter, score: rules.style.score,
      combo: rules.style.combo, stamina: rules.abilities.stamina,
      headbuttCharge: rules.abilities.headbuttCharge,
      inventory: rules.inventory.all, buildMode: game.buildMode,
      buildPiece: game.buildPiece, ragdoll: game.goat.isRagdoll,
      location: game.location, coins: rules.wallet.coins,
      partyTitle: game.party.match ? game.party.title : undefined,
      gig: run ? {
        title: run.setup.info.title, status: run.status, objective: run.objective,
        elapsedTicks: run.elapsedTicks, maxTicks: run.setup.maxTicks,
        goldTicks: run.setup.goldTicks, silverTicks: run.setup.silverTicks,
        rating: run.rating, payout: run.payout,
      } : null,
    });

    this.fill.style.width = state.meter.toFixed(2) + '%';
    this.needle.style.left = state.meter.toFixed(2) + '%';
    this.meterText.textContent = Math.floor(state.meter) + ' / 100';
    this.tier.textContent = state.tier.toUpperCase();
    for (const element of this.stageElements) {
      const label = element.getAttribute('data-stage') ?? element.getAttribute('data-stage-label');
      element.classList.toggle('is-active', label === state.tier);
    }
    this.comboTitle.textContent = state.comboTitle;
    this.comboCount.textContent = state.comboCount ? '×' + state.comboCount + '\nCOMBO!' : 'START A COMBO!';
    this.comboInfo.textContent = state.comboCount ?
      '+' + state.comboPoints + ' COMBO POINTS · STYLE SCORE' : 'STYLE SCORE';
    this.score.textContent = state.score;
    this.place.textContent = state.location;
    this.wallet.textContent = state.coins + ' CUD COINS';
    this.updateMap(game, state.location);

    this.stamina.style.setProperty('--gg-stamina', state.stamina.toFixed(2) + '%');
    this.staminaNumber.textContent = Math.floor(state.stamina) + ' / 100';
    this.charge.style.width = state.headbutt.toFixed(2) + '%';
    this.mode.textContent = state.mode;
    // Keep the compact tray visible in free roam as in the HUD reference.
    this.hotbar.dataset.active = state.buildMode ? 'true' : 'false';
    this.buildStatus.textContent = state.buildMode ?
      'B EXIT BUILD · 1–4 SELECT · LMB PLACE' : 'B TO BUILD · 1–4 SELECT';
    this.materials.textContent = state.materials;
    for (let i = 0; i < state.slots.length; i++) {
      const slot = state.slots[i]!, element = this.slots[i]!;
      element.classList.toggle('is-selected', slot.selected);
      element.dataset.sprite = slot.selected ? HUD_SPRITES.hotbarSlotSelected : HUD_SPRITES.hotbarSlot;
      element.classList.toggle('is-empty', slot.available === 0);
      const count = this.quantities[i];
      if (count) count.textContent = '×' + slot.available;
      element.title = slot.label + ' · ' + slot.available + ' can be built now · key ' + slot.key;
    }
    this.supply.textContent = '×' + rules.inventory.get('scrap');
    this.gigTitle.textContent = state.gig.title;
    this.gigTask.textContent = state.gig.task;
    this.gigDetail.textContent = state.gig.detail;
    this.gigCheckbox.hidden = run?.status !== 'running' || !!game.party.match;
    this.updatePartyCard(game);
    // Refit only when copy or dimensions change, not every simulation frame.
    const gigLayoutKey = [this.gigTitle.textContent, this.gigTask.textContent,
      this.gigDetail.textContent, this.wallet.textContent, this.mode.textContent,
      this.gigCard.clientWidth, this.gigCard.clientHeight].join('|');
    if (gigLayoutKey !== this.gigLayoutKey) {
      fitGigCardText(this.gigCard);
      this.gigLayoutKey = gigLayoutKey;
    }
    this.board.hidden = !game.gigs.nearBoard();
    this.setPointerLockHint(pointerLocked);
    this.debug.hidden = !debugVisible;
    if (debugVisible) this.debug.textContent = 'F3 · PERFORMANCE\n' +
      'FPS: ' + (perf?.fps ?? fps).toFixed(0) + '\n' +
      'FRAME: ' + (perf?.frameMs ?? 1000 / Math.max(1, fps)).toFixed(2) + ' ms\n' +
      'PHYSICS/SIM: ' + (perf?.physicsMs ?? stepMilliseconds).toFixed(2) + ' ms\n' +
      'RENDER CPU: ' + (perf?.renderMs ?? 0).toFixed(2) + ' ms\n' +
      'DRAW CALLS: ' + (perf?.drawCalls ?? 0) + '\n' +
      'TRIANGLES: ' + (perf?.triangles ?? 0).toLocaleString() + '\n' +
      'TEXTURES: ' + (perf?.textures ?? 0) + '\n' +
      'PIXEL RATIO: ' + (perf?.pixelRatio ?? 1).toFixed(2) + '×\n' +
      'BODIES: ' + game.bodyCount + '\n' +
      'TICK: ' + game.physics.stepCount;
    this.clearGoat(goatScreenBox);
  }

  /** Preserve the CSS flex row when unlocked; hidden hides it under pointer lock. */
  setPointerLockHint(pointerLocked: boolean): void { this.hint.hidden = pointerLocked; }

  setVisible(visible: boolean): void { this.root.style.display = visible ? 'block' : 'none'; }
  dispose(): void { this.root.remove(); this.styles.remove(); }
}
