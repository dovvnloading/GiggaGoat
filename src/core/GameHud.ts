import type { Game } from './Game';
import type { PlacementFailure, Validation } from '../gameplay';
import { HUD_PIECES, deriveHudState, projectHudMap } from './GameHudState';
import { PAD_BUILD_BINDINGS, type InputDevice } from './GameInput';
import { buildArtwork, goatArtwork, renderHudMinimap } from './HudArtwork';
import { fitGigCardText } from './GigCardLayout';
import { createHayHaulMapMarker, gigMapPoint, separateMapObjective,
  type HayHaulGuidance } from './GigPresentation';
import { HUD_SPRITES, hudSpriteImage, hudSpriteVariables } from './HudSprites';
import { carryStaminaForHud, derivePartyHudState } from './PartyHudState';

const CSS = `
.gg-ui{position:absolute;inset:0;z-index:4;pointer-events:none;user-select:none;overflow:hidden;color:#fff9df;font-family:"Trebuchet MS","Arial Rounded MT Bold","Arial Black",system-ui,sans-serif;font-weight:900;text-shadow:1px 2px 1px #493049,0 3px 3px #38253b9a;-webkit-font-smoothing:antialiased}
.gg-ui *{box-sizing:border-box}
.gg-ui [hidden]{display:none!important}
.gg-ui img{display:block;object-fit:contain;pointer-events:none;user-select:none}
.gg-meter,.gg-map-panel,.gg-stamina,.gg-hotbar{filter:drop-shadow(0 5px 2px #281b4890)}
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
.gg-meter-caption{
 position:absolute;top:58%;height:14.8%;left:6%;right:5.8%;display:grid;place-items:center;
 color:#fff9db;font-size:clamp(9px,1.05vw,18px);font-variant-numeric:tabular-nums;
 line-height:1;text-shadow:none;white-space:nowrap
}
.gg-meter-caption [data-meter]{display:block;padding:0 6px;border-radius:6px;background:#301f33ed}
/* Reserve the combo slot so its artwork can appear without moving surrounding controls. */
.gg-combo{position:absolute;left:50%;top:clamp(4px,.7vw,12px);transform:translateX(-50%);width:clamp(377px,32.3vw,545px);height:clamp(155px,12.7vw,217px);text-align:center}
.gg-combo[data-combo-active]{background:var(--gg-scoreStarburst) center/100% 100% no-repeat}
.gg-combo:not([data-combo-active]) > :is(.gg-combo-title,.gg-combo-count){display:none}
.gg-combo-title{position:absolute;left:8%;top:19%;width:64%;height:47%;display:flex;align-items:center;justify-content:center;overflow:hidden;overflow-wrap:anywhere;line-height:.93;transform:rotate(-5deg);font-style:italic;letter-spacing:-.7px;color:#ffcd36;font-size:clamp(22px,2.35vw,39px);-webkit-text-stroke:1.2px #802847;text-shadow:2px 3px 0 #682a46,4px 4px 0 #fff2a4,5px 6px 0 #4d2c61}
.gg-combo-count{position:absolute;left:73%;top:22%;width:22%;height:38%;display:grid;place-items:center;transform:rotate(-7deg);color:#fff8e3;font-size:clamp(10px,1.12vw,17px);line-height:1.12;white-space:pre-line;overflow-wrap:normal;text-shadow:1px 2px #4a2358}
.gg-current-score{display:contents}
.gg-score-ribbon{position:absolute;left:11%;right:21%;bottom:6%;height:28%;display:grid;place-items:center}
.gg-score{font-variant-numeric:tabular-nums;font-size:clamp(27px,2.55vw,44px);letter-spacing:1px;color:#fff8df;text-shadow:2px 3px #3d203c}
.gg-score-caption{position:absolute;left:32%;right:34%;bottom:1%;font-size:clamp(7px,.58vw,10px);letter-spacing:.4px;color:#fff0ba;white-space:nowrap}
.gg-combo:not([data-combo-active]) > .gg-current-score{
 position:absolute;top:0;left:50%;transform:translateX(-50%);
 display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;gap:2px 7px;
 width:max-content;max-width:100%;padding:3px clamp(6px,.7vw,12px);
 border:1px solid #ac895a;border-radius:12px;background:#302338ed;text-shadow:none;line-height:1.1
}
.gg-combo:not([data-combo-active]) .gg-score-caption{
 position:static;font-size:clamp(9px,.8vw,13px);letter-spacing:.2px;color:#f4ddb0
}
.gg-combo:not([data-combo-active]) .gg-score-ribbon{position:static;display:block;width:auto;height:auto;min-width:0}
.gg-combo:not([data-combo-active]) .gg-score{
 font-size:clamp(13px,1.18vw,19px);letter-spacing:0;text-shadow:none;overflow-wrap:anywhere
}
.gg-combo[data-party-active="true"]{background:none}
.gg-combo[data-party-active="true"] > :not(.gg-party-scoreboard){display:none}
.gg-party-scoreboard{
 position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;
 gap:clamp(2px,.32vw,6px);padding:clamp(4px,.45vw,9px) clamp(7px,1.1vw,20px);
 border:2px solid #e8a847;border-radius:clamp(10px,1.5vw,24px);
 background:linear-gradient(#522b40,#28192f);box-shadow:0 3px 5px #281b4866;
 color:#fff8e3;line-height:1.05;text-shadow:none
}
.gg-party-head{display:flex;justify-content:space-between;align-items:center;gap:5px;text-align:left}
.gg-party-title{min-width:0;color:#ffdf80;font-size:clamp(13px,1.65vw,29px);text-wrap:balance}
.gg-party-clock{display:flex;align-items:baseline;gap:4px;color:#ffebad;white-space:nowrap}
.gg-party-clock-label,.gg-party-metric-label{font-size:clamp(9px,.76vw,13px);letter-spacing:.2px}
.gg-party-clock-time{font-size:clamp(23px,2.65vw,44px);font-variant-numeric:tabular-nums;color:#fff8e3}
.gg-party-metrics{display:flex;justify-content:center;padding-block:2px;background:#251928aa;border-radius:6px}
.gg-party-metric{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px}
.gg-party-metric + .gg-party-metric{border-left:1px solid #f9d38855}
.gg-party-metric[data-own="true"] .gg-party-metric-label{color:#ffdf80}
.gg-party-metric-value{font-size:clamp(17px,2.1vw,37px);font-variant-numeric:tabular-nums;white-space:nowrap}
.gg-party-goal{font-size:clamp(11px,1.14vw,20px)}
.gg-party-status{font-size:clamp(9px,.85vw,15px);color:#ffe2ac}
.gg-party-status[data-urgent="true"]{
 background:#ffbd65;color:#422216;border-radius:4px;padding:2px 3px
}
@media(max-width:1100px),(max-height:680px){
 .gg-party-metric{flex-direction:row-reverse;justify-content:center;gap:5px}
}
@media(max-width:760px){
 .gg-party-scoreboard{gap:2px;padding:2px 4px;border-width:1px;line-height:1}
 .gg-party-title{font-size:clamp(9px,1.9vw,14px)}
 .gg-party-clock{gap:3px}
 .gg-party-clock-label,.gg-party-metric-label{font-size:clamp(7px,1.6vw,11px);letter-spacing:0}
 .gg-party-clock-time{font-size:clamp(16px,3.3vw,23px)}
 .gg-party-metrics{padding-block:1px}
 .gg-party-metric{gap:3px}
 .gg-party-metric-value{font-size:clamp(12px,2.5vw,20px)}
 .gg-party-goal{font-size:clamp(9px,1.8vw,13px)}
 .gg-party-status{font-size:clamp(8px,1.65vw,12px)}
 .gg-party-status[data-urgent="true"]{padding:1px 2px}
}
@media(max-width:760px) and (orientation:portrait){
 .gg-combo[data-party-active="true"]{
  left:8px;top:var(--gg-portrait-second-row,130px);width:calc(100% - 16px);transform:none
 }
 .gg-party-scoreboard{
  display:grid;grid-template-columns:minmax(0,1fr) auto;align-content:center;gap:2px 4px;padding:2px 7px
 }
 .gg-party-head,.gg-party-metrics{grid-column:1 / -1}
 .gg-party-clock-label,.gg-party-metric-label{font-size:9px}
 .gg-party-goal{text-align:left}
 .gg-party-status{text-align:right}
}
/* Live SVG terrain is clipped inside the transparent PNG ring. */
.gg-map-panel{position:absolute;right:clamp(8px,1.15vw,22px);top:clamp(6px,.7vw,12px);width:clamp(190px,17vw,290px);aspect-ratio:311/337}
.gg-map-frame{position:absolute;left:4.5%;top:7.5%;width:91%;height:76%;overflow:hidden;border-radius:50%;background:#8abd75}
.gg-map-frame svg{width:100%;height:100%;display:block}
.gg-map-skin{position:absolute;inset:0;background:var(--gg-minimapRing) center/100% 100% no-repeat}
.gg-map-north{position:absolute;top:1%;left:42%;width:16%;height:16%}
.gg-compass{width:100%;height:100%}
.gg-map-location{position:absolute;left:12%;right:12%;bottom:5%;height:13%;display:grid;place-items:center;
 text-wrap:balance;text-align:center;line-height:1.02;font-size:clamp(11px,1.25vw,19px);color:#fff5d4;letter-spacing:.1px}
@media(min-width:1101px){.gg-map-location [data-long-label="true"]{font-size:.82em}}
.gg-gig-card{position:absolute;right:clamp(10px,1.2vw,23px);top:clamp(234px,19vw,316px);width:clamp(280px,23.5vw,390px);height:clamp(150px,12.4vw,208px)}
/* Shadow only the illustrated panel: filtering the card itself rasterizes its
   live copy and makes the tiny footer glyphs look blurred. */
.gg-gig-card::before{content:"";position:absolute;inset:0;background:var(--gg-gigCard) center/100% 100% no-repeat;filter:drop-shadow(0 5px 2px #281b4890);pointer-events:none}
.gg-gig-header{position:absolute;top:9%;left:27%;right:9%;height:19%;display:grid;place-items:center;color:#ffcc43;font-size:clamp(15px,1.4vw,23px);white-space:nowrap;letter-spacing:.3px;-webkit-text-stroke:.6px #623645;text-shadow:2px 3px #583147}
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
.gg-gig-footer{position:absolute;left:20%;right:12%;bottom:9%;height:10%;display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:0;color:#4e312b;font-family:inherit;font-weight:900;font-size:clamp(8px,.7vw,11px);white-space:nowrap;opacity:1;filter:none;transform:none;text-shadow:none}
.gg-gig-wallet{display:flex;align-items:center;gap:3px;flex-shrink:0;min-width:0}
.gg-gig-footer [data-mode]{flex-shrink:0;text-align:right}
.gg-coin{width:18px;height:18px;flex-shrink:0;object-fit:contain;image-rendering:auto;opacity:1;filter:none;transform:none}
@media(min-width:1101px){
 /* Dock the card to the map and leave room for the map shadow. Cap the
    map's height when a wide, short window cannot fit the full stack. */
 .gg-ui{
  --gg-desktop-panel-gap:12px;
  --gg-desktop-map-top:clamp(6px,.7vw,12px);
  --gg-desktop-gig-height:clamp(150px,12.4vw,208px);
  --gg-desktop-map-height:min(
   calc(clamp(190px,17vw,290px) * 337 / 311),
   max(110px,calc(100vh - var(--gg-desktop-map-top) - var(--gg-desktop-gig-height) - 2 * var(--gg-desktop-panel-gap)))
  );
 }
 .gg-map-panel{
  top:var(--gg-desktop-map-top);height:var(--gg-desktop-map-height);
  width:calc(var(--gg-desktop-map-height) * 311 / 337)
 }
 .gg-gig-card{
  top:calc(var(--gg-desktop-map-top) + var(--gg-desktop-map-height) + var(--gg-desktop-panel-gap));
  height:var(--gg-desktop-gig-height)
 }
 .gg-gig-paper{bottom:24.5%}
 .gg-gig-footer{
  --gg-coin-size:clamp(12px,.86vw,16px);
  left:14%;right:11%;bottom:15.5%;height:max(7%,var(--gg-coin-size));gap:6px;
  font-size:clamp(9px,.72vw,12px);line-height:1.15;font-variant-numeric:tabular-nums
 }
 .gg-gig-footer .gg-coin{width:var(--gg-coin-size);height:var(--gg-coin-size)}
}
/* Progress is a live masked conic arc painted on top of the illustrated ring. */
.gg-stamina{position:absolute;left:clamp(11px,1.5vw,29px);bottom:clamp(10px,1.5vw,26px);width:clamp(138px,12.7vw,215px);aspect-ratio:243/252;background:var(--gg-staminaRing) center/100% 100% no-repeat}
.gg-stamina-progress{position:absolute;inset:8%;border-radius:50%;background:conic-gradient(from -90deg,var(--gg-stamina-color,#9aff33) 0 var(--gg-stamina,100%),#3c304c var(--gg-stamina,100%) 100%);-webkit-mask:radial-gradient(farthest-side,transparent 60%,#000 63% 84%,transparent 87%);mask:radial-gradient(farthest-side,transparent 60%,#000 63% 84%,transparent 87%)}
.gg-stamina-inner{position:absolute;inset:23% 17% 17%;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gg-hoof{width:56%;height:55%;filter:drop-shadow(0 2px 1px #422c3b)}
.gg-stamina-label{margin-top:2px;color:#ffe8ad;font-size:clamp(13px,1.2vw,20px);line-height:1.1;transform:rotate(6deg);text-shadow:2px 2px #4b2840}
.gg-stamina-value{font-size:clamp(8px,.72vw,12px);color:#fff7c9;margin-top:2px}
@media(min-width:761px),(orientation:landscape){
 .gg-stamina-inner{inset:21% 13% 16%;gap:2px}
 .gg-hoof{width:50%;height:42%;min-height:0}
 .gg-stamina-label{transform:none;margin:0;white-space:nowrap}
 .gg-stamina-value{
  margin:0;padding:1px 4px;border-radius:6px;background:#302338ed;text-shadow:none;
  font-size:clamp(10px,1.05vw,18px);line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap
 }
 .gg-stamina[data-low="true"] .gg-stamina-progress{--gg-stamina-color:#ff926f}
 .gg-stamina[data-low="true"] .gg-stamina-label::after{content:" LOW";color:#ffac93}
 .gg-stamina[data-low="true"] .gg-stamina-value{background:#512c38;color:#ffe4d3}
}
.gg-hotbar{position:absolute;left:50%;bottom:clamp(3px,.6vw,10px);transform:translateX(-50%);width:clamp(500px,40vw,665px);height:clamp(126px,10.35vw,186px);isolation:isolate}
/* Continue the outer rim beneath the clipped button artwork without moving the tray slots. */
.gg-hotbar[data-active="true"]::before,.gg-hotbar[data-active="true"]::after{content:"";position:absolute;pointer-events:none}
.gg-hotbar[data-active="true"]::before{
 inset:25% 6.8% 2.2%;z-index:-2;border:clamp(3px,.6vw,8px) solid #be7734;border-radius:clamp(10px,2.6vw,23px);
 box-shadow:inset 0 0 0 1px #f4bd74,inset 0 0 6px 2px #704320;background:#895024
}
.gg-hotbar[data-active="true"]::after{
 inset:0;z-index:-1;background:var(--gg-hotbarTray) center/100% 100% no-repeat;
 clip-path:polygon(0 0,100% 0,100% 45%,90.3% 45%,90.3% 79%,100% 79%,100% 100%,0 100%,0 79%,9.7% 79%,9.7% 45%,0 45%)
}
.gg-hotbar-header{position:absolute;left:30%;right:24%;top:9%;height:23%;display:grid;place-items:center;padding-left:38px;color:#ffe4a3;font-size:clamp(17px,1.42vw,24px);line-height:1;white-space:nowrap;letter-spacing:.5px;text-shadow:2px 3px #5b2e42}
.gg-hotbar-slots{position:absolute;left:11%;right:11%;top:37%;height:54%;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1.8%}
.gg-slot{position:relative;min-width:0;min-height:0;border:11px solid transparent;border-image:var(--gg-hotbarSlot) 44 fill / 11px / 0 stretch}
.gg-slot.is-selected{border-image-source:var(--gg-hotbarSlotSelected);z-index:1;filter:drop-shadow(0 0 4px #ffe450)}
.gg-slot.is-empty .gg-piece-art{opacity:.55}
.gg-slot-key{position:absolute;z-index:4;left:-14%;top:-16%;width:clamp(23px,2vw,34px);height:clamp(24px,2.1vw,36px);display:grid;place-items:center;border:8px solid transparent;border-image:var(--gg-keyBadge) 32 fill / 8px / 0 stretch;color:#633c26;font-size:clamp(11px,.94vw,16px);line-height:1;text-shadow:none}
.gg-piece-art{position:absolute;width:74%;height:76%;left:13%;top:9%;filter:drop-shadow(0 3px 2px #3d2528a0)}
.gg-slot-count{position:absolute;right:3%;bottom:0;z-index:3;font-size:clamp(12px,1.04vw,18px);line-height:1;color:#fff7da;text-shadow:2px 2px #33243e}
.gg-slot-name{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden;white-space:nowrap}
.gg-supply{
 display:flex;flex-direction:column;justify-content:center;min-width:0;padding:1px clamp(2px,.65vw,8px);
 border:1px solid #e1ba823f;border-radius:9%;background:#3b2726;color:#f9deb0;
 font-size:clamp(7px,min(1.55vw,2.38vh),11px);line-height:1.06;text-shadow:none
}
.gg-supply-title{text-align:center;font-size:.84em;color:#fde7bf}
.gg-supply-amounts{display:grid;grid-template-columns:1fr auto;gap:0 2px;font-variant-numeric:tabular-nums}
.gg-hotbar-charge{position:absolute;left:16%;right:16%;bottom:4.5%;height:3px;border-radius:6px;background:#442742;overflow:hidden}
.gg-hotbar-charge>div{height:100%;width:0;background:linear-gradient(90deg,#f6a32c,#fff071);transition:width .12s linear}
/* The prompt, key badge and slot art are genuine nine-slice border images. */
.gg-prompts{position:absolute;left:50%;top:calc(clamp(4px,.7vw,12px) + clamp(155px,12.7vw,217px) + 10px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px}
.gg-board-hint,.gg-hint{display:flex;flex-wrap:nowrap;align-items:center;justify-content:center;gap:6px;width:max-content;max-width:82vw;min-height:37px;padding:1px 11px;border:13px solid transparent;border-image:var(--gg-promptPill) 37 fill / 13px / 0 stretch;text-align:center;color:#5a352c;font-size:clamp(11px,.88vw,14px);line-height:1.15;text-shadow:none;white-space:nowrap}
.gg-hint{order:-1}
.gg-prompt-key{display:grid;place-items:center;flex:0 0 auto;min-width:28px;height:26px;padding:0 5px;border:7px solid transparent;border-image:var(--gg-keyBadge) 31 fill / 7px / 0 stretch;color:#603827;text-shadow:none}
.gg-prompt-copy{flex:0 0 auto;white-space:nowrap}
.gg-prompt-mouse{font-family:"Segoe UI Symbol","Apple Color Emoji",system-ui,sans-serif;font-size:13px;line-height:1}
.gg-debug{position:absolute;left:20px;top:230px;background:#192542e8;border:2px solid #b7dfbc;border-radius:12px;padding:10px;font:12px/1.5 monospace;white-space:pre;color:#d7ffc9;text-shadow:none}
@media(max-width:1380px){
 .gg-meter{left:12px;top:13px}
 .gg-map-panel{right:10px}
 .gg-gig-card{right:9px}
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
 .gg-prompts{left:31%;top:262px;width:54vw}
 .gg-board-hint,.gg-hint{font-size:9px;white-space:normal;max-width:100%;padding:0 5px;width:auto;flex-wrap:wrap}
 .gg-prompt-copy{flex:0 1 auto;white-space:normal}
 .gg-prompt-key{min-width:22px;height:22px}
 .gg-debug{top:280px;left:5px;font-size:9px}
}
@media(max-height:680px) and (min-width:761px){
 .gg-combo{height:155px}.gg-stamina{width:130px}
 .gg-prompts{top:calc(clamp(4px,.7vw,12px) + 165px)}
 .gg-hotbar{height:125px}
}
@media(min-width:761px) and (max-width:1100px){
 .gg-ui{
  --gg-compact-score-height:clamp(92px,11.6vw,128px);
  --gg-compact-map-width:clamp(146px,17vw,188px);
  --gg-compact-prompt-height:42px;
 }
 .gg-meter{left:10px;top:9px;width:clamp(226px,29vw,319px);height:auto;aspect-ratio:535/205}
 .gg-meter-label{font-size:clamp(13px,1.45vw,17px)}
 .gg-meter-stage-labels span{font-size:clamp(10px,1.12vw,13px)}
 .gg-meter-arrow{border-left-width:6px;border-right-width:6px;border-top-width:9px}
 .gg-combo{top:9px;width:clamp(226px,29vw,319px);height:var(--gg-compact-score-height)}
 .gg-combo-title{font-size:clamp(17px,2.15vw,24px);-webkit-text-stroke:.8px #802847}
 .gg-combo-count{font-size:clamp(8px,1vw,11px)}
 .gg-score{font-size:clamp(21px,2.5vw,29px)}
 .gg-score-caption{font-size:clamp(6px,.7vw,8px)}

 .gg-prompts{
  top:calc(21px + var(--gg-compact-score-height));
  width:min(330px,34vw);
  display:grid;
  grid-template-rows:repeat(2,var(--gg-compact-prompt-height));
  justify-items:center;
  gap:5px;
 }
 .gg-hint{grid-column:1;grid-row:1}
 .gg-board-hint{grid-column:1;grid-row:2}
 .gg-board-hint,.gg-hint{
  gap:5px;max-width:100%;height:var(--gg-compact-prompt-height);min-height:0;padding:0 8px;
  border-width:9px;border-image-width:9px;font-size:clamp(9px,1vw,11px);white-space:normal;
 }
 .gg-prompt-key{min-width:22px;height:21px;padding:0 3px;border-width:5px;border-image-width:5px}
 .gg-prompt-copy{flex:0 1 auto;min-width:0;white-space:normal}

 .gg-map-panel{top:8px;right:10px;width:var(--gg-compact-map-width)}
 .gg-map-location{
  display:flex;align-items:center;justify-content:center;padding-inline:2px;text-align:center;
  white-space:normal;text-wrap:balance;line-height:1.04;font-size:clamp(8.5px,.98vw,11px);
 }
 .gg-gig-card{
  right:10px;top:calc(26px + var(--gg-compact-map-width) * 337 / 311);
  width:clamp(204px,23vw,253px);height:clamp(120px,14vw,154px);
 }
 .gg-gig-header{top:15%;height:22%;font-size:clamp(12px,1.25vw,15px)}
 .gg-gig-paper{top:45%;bottom:22%}
 .gg-gig-checkbox[hidden] + .gg-gig-paper{left:10%}
 .gg-gig-footer{left:10%;right:10%;bottom:14%;height:8%}
 .gg-coin{width:12px;height:12px}

 .gg-stamina{left:12px;bottom:10px;width:clamp(95px,11.5vw,122px)}
 .gg-stamina-label{font-size:clamp(10px,1.13vw,13px)}
 .gg-hotbar{bottom:8px;width:clamp(366px,46vw,490px);height:auto;aspect-ratio:4/1}
 .gg-hotbar-header{padding-left:clamp(19px,3.2vw,33px);font-size:clamp(13px,1.45vw,16px)}
 .gg-slot{border-width:9px;border-image-width:9px}
 .gg-slot-key{
  width:clamp(19px,2.13vw,24px);height:clamp(21px,2.24vw,27px);
  border-width:6px;border-image-width:6px;font-size:clamp(9px,1.03vw,11px);
 }
 .gg-slot-count{font-size:clamp(10px,1.04vw,12px)}
}

/* Short landscape gives the top panels independent columns and the tray its own bottom row. */
@media (max-width:760px) and (min-height:270px) and (max-height:460px) and (orientation:landscape){
 .gg-ui{
   --gg-landscape-meter-width:min(31vw,57vh,212px);
   --gg-landscape-meter-height:calc(var(--gg-landscape-meter-width) * .5);
   --gg-landscape-score-width:min(29vw,56vh,204px);
   --gg-landscape-score-height:calc(var(--gg-landscape-score-width) * .47);
   --gg-landscape-map-width:min(19vw,29vh,118px);
   --gg-landscape-gig-width:min(37vw,234px);
   --gg-landscape-stamina-width:clamp(52px,12vw,68px);
   --gg-landscape-tray-height:clamp(58px,22vh,80px);
 }
 .gg-meter{left:6px;top:7px;width:var(--gg-landscape-meter-width);height:var(--gg-landscape-meter-height)}
 .gg-meter-label{font-size:clamp(8px,1.85vw,13px);letter-spacing:.2px}
 .gg-meter-stage-labels span{font-size:clamp(7px,1.5vw,10px)}
 .gg-combo{left:50%;top:7px;width:var(--gg-landscape-score-width);height:var(--gg-landscape-score-height)}
 .gg-combo-title{font-size:clamp(10px,2.5vw,18px)}
 .gg-combo-count{font-size:clamp(6px,1.48vw,9px)}
 .gg-score{font-size:clamp(13px,3.25vw,22px);letter-spacing:.3px}
 .gg-score-caption{left:5%;right:8%;font-size:clamp(5.5px,1.34vw,8px);letter-spacing:0}
 .gg-map-panel{right:6px;top:7px;width:var(--gg-landscape-map-width)}
 .gg-map-location{left:10%;right:10%;bottom:4.3%;height:15%;font-size:clamp(7px,1.35vw,9px);line-height:1;letter-spacing:0;text-align:center;white-space:normal}
 .gg-gig-card{
   top:calc(15px + var(--gg-landscape-map-width) * 337 / 311);
   right:6px;width:var(--gg-landscape-gig-width);height:clamp(96px,34vh,132px)
 }
 .gg-gig-header{top:15%;height:22%;font-size:clamp(9px,2vw,13px)}
 .gg-gig-paper{top:43%;right:9%;bottom:21%;gap:1px}
 .gg-gig-checkbox[hidden] + .gg-gig-paper{left:9%}
 .gg-gig-title,.gg-gig-detail{font-size:8px}
 .gg-gig-task{font-size:clamp(9px,1.85vw,12px)}
 .gg-gig-footer{left:9%;right:9%;bottom:13%;height:8%;font-size:clamp(7px,1.48vw,9px)}
 .gg-coin{width:11px;height:11px}
 .gg-prompts{
   left:8px;top:calc(15px + max(var(--gg-landscape-meter-height),var(--gg-landscape-score-height)));
   width:calc(100% - var(--gg-landscape-gig-width) - 24px);transform:none;gap:5px
 }
 .gg-board-hint,.gg-hint{
   flex-wrap:nowrap;width:max-content;max-width:100%;min-height:38px;
   padding:0 5px;border-width:8px;border-image-width:8px;font-size:10px
 }
 .gg-prompt-copy{min-width:0}
 .gg-stamina{left:8px;bottom:5px;width:var(--gg-landscape-stamina-width)}
 .gg-stamina-inner{gap:1px}
 .gg-hoof{height:36%}
 .gg-stamina-label{font-size:clamp(8px,1.66vw,10px)}
 .gg-stamina-value{padding:0 2px;font-size:clamp(8px,1.48vw,10px)}
 .gg-stamina[data-low="true"] .gg-stamina-label{font-size:0}
 .gg-stamina[data-low="true"] .gg-stamina-label::after{content:"LOW";font-size:clamp(8px,1.66vw,10px)}
 .gg-hotbar{
   bottom:4px;width:min(calc(100% - 2 * (var(--gg-landscape-stamina-width) + 18px)),460px);
   height:var(--gg-landscape-tray-height)
 }
 .gg-hotbar-header{font-size:clamp(11px,2.45vw,15px);padding-left:clamp(12px,4vw,25px)}
 .gg-slot{border-width:5px;border-image-width:5px}
 .gg-slot-key{width:17px;height:18px;border-width:4px;border-image-width:4px}
}
@media (max-width:760px) and (orientation:portrait){
 .gg-ui{
  --gg-portrait-meter-width:min(53vw,244px);
  --gg-portrait-meter-height:calc(var(--gg-portrait-meter-width) * .51);
  --gg-portrait-map-width:clamp(88px,min(29vw,15vh),143px);
  --gg-portrait-left-width:clamp(110px,35vw,188px);
  --gg-portrait-score-height:calc(var(--gg-portrait-left-width) * .47);
  --gg-portrait-second-row:calc(18px + max(var(--gg-portrait-meter-height),var(--gg-portrait-map-width) * 337 / 311));
 }
 .gg-meter{left:8px;top:8px;width:var(--gg-portrait-meter-width);height:var(--gg-portrait-meter-height)}
 .gg-meter-label{font-size:clamp(10px,2.7vw,14px)}
 .gg-meter-caption{
  top:58%;height:14.8%;left:6%;right:5.8%;display:grid;place-items:center;
  color:#fff9db;font-size:clamp(9px,2.65vw,12px);letter-spacing:0;font-variant-numeric:tabular-nums;text-shadow:none
 }
 .gg-meter-caption [data-meter]{display:block;padding:0 4px;border-radius:6px;background:#301f33db}
 .gg-map-panel{top:8px;right:8px;width:var(--gg-portrait-map-width)}
 .gg-map-location{
  left:8%;right:8%;bottom:4.3%;height:15%;padding-inline:1px;display:flex;align-items:center;justify-content:center;
  white-space:normal;text-align:center;text-wrap:balance;font-size:clamp(7px,2.1vw,10px);line-height:1.04;letter-spacing:0
 }
 .gg-combo{
  left:8px;top:var(--gg-portrait-second-row);width:var(--gg-portrait-left-width);
  height:var(--gg-portrait-score-height);transform:none
 }
 .gg-combo-title{font-size:clamp(10px,2.75vw,15px);text-shadow:1px 1px #682a46,2px 2px #fff2a4}
 .gg-combo-count{font-size:clamp(6px,1.52vw,8px)}
 .gg-score{font-size:clamp(14px,3.8vw,21px);line-height:1}
 .gg-score-caption{left:7%;right:16%;font-size:clamp(5.5px,1.55vw,7px);letter-spacing:0}
 /* Give the copy its own rows and let this card grow with the objective. */
 .gg-gig-card{
  right:8px;top:var(--gg-portrait-second-row);width:calc(100% - var(--gg-portrait-left-width) - 24px);
  height:auto;display:grid;grid-template-rows:auto 1fr auto;align-content:start;
  border:2px solid #dca354;border-radius:13px;overflow:hidden;
  background:linear-gradient(140deg,#fff4d9,#efd9ae);box-shadow:0 3px 0 #643628,0 5px 8px #281b4860
 }
 .gg-gig-card::before{content:none}
 .gg-gig-card :is(.gg-gig-checkbox,.gg-gig-checkbox-mask){display:none}
 .gg-gig-header{
  position:static;display:block;height:auto;padding:4px 8px;border-bottom:1px solid #dca354;
  background:#643928;color:#ffe194;font-size:clamp(11px,2.8vw,14px);line-height:1.15;
  letter-spacing:.4px;-webkit-text-stroke:0;text-shadow:none
 }
 .gg-gig-paper{
  position:static;display:grid;gap:3px;min-height:52px;
  padding:7px 8px 6px;align-content:start
 }
 /* The illustrated card's inline fit can survive until the next HUD update
    after rotation. The flowing portrait card must take its readable size immediately. */
 .gg-gig-title{font-size:clamp(10px,2.6vw,13px)!important}
 .gg-gig-task{font-size:clamp(12px,3.1vw,15px)!important}
 .gg-gig-detail{font-size:clamp(10px,2.6vw,12px)!important}
 .gg-gig-footer{
  position:static;height:auto;min-height:23px;margin:0 8px;padding:4px 0;flex-wrap:wrap;row-gap:2px;
  border-top:1px solid #b88658;white-space:normal;font-size:clamp(9px,2.3vw,11px)!important;line-height:1.15
 }
 .gg-gig-footer :is(.gg-gig-wallet,[data-mode]){min-width:0;flex-shrink:1;overflow-wrap:anywhere}
 .gg-coin{width:12px;height:12px}
 .gg-stamina{
  position:absolute;left:8px;top:calc(var(--gg-portrait-second-row) + var(--gg-portrait-score-height) + 8px);
  bottom:auto;width:var(--gg-portrait-left-width);height:34px;aspect-ratio:auto;border:1px solid #d5a15c;
  border-radius:9px;background:#352b3c;filter:none;text-shadow:none
 }
 .gg-stamina-progress{
  inset:auto 6px 5px;height:4px;border-radius:4px;--gg-portrait-stamina-color:#a2ed57;
  background:linear-gradient(90deg,var(--gg-portrait-stamina-color) 0 var(--gg-stamina,100%),#66536a var(--gg-stamina,100%) 100%);
  mask:none;-webkit-mask:none
 }
 .gg-stamina-inner{inset:4px 6px auto;display:flex;flex-direction:row;justify-content:space-between;gap:2px}
 .gg-stamina-inner .gg-hoof{display:none}
 .gg-stamina-label,.gg-stamina-value{margin:0;font-size:clamp(9px,2.55vw,11px);line-height:1.15;transform:none;text-shadow:none}
 .gg-stamina-value{font-variant-numeric:tabular-nums;white-space:nowrap}
 .gg-stamina[data-low="true"] .gg-stamina-progress{--gg-portrait-stamina-color:#ff926f}
 .gg-stamina[data-low="true"] .gg-stamina-label::after{content:" LOW";color:#ffac93}
 .gg-prompts{
  left:8px;top:calc(var(--gg-portrait-second-row) + var(--gg-portrait-score-height) + 50px);
  width:var(--gg-portrait-left-width);transform:none;align-items:stretch;gap:5px
 }
 .gg-board-hint,.gg-hint{
  width:100%;min-height:36px;gap:4px;flex-wrap:nowrap;padding:0 3px;
  border-width:6px;border-image-width:6px;font-size:clamp(9px,2.5vw,11px)
 }
 .gg-prompt-copy{min-width:0;overflow-wrap:anywhere}
 .gg-hotbar{width:min(calc(100% - 16px),420px);height:clamp(82px,24vw,105px);bottom:max(8px,env(safe-area-inset-bottom))}
}
.gg-build-controls{
 position:absolute;bottom:100%;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 12px);
 display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:1px 8px;min-height:25px;padding:3px 9px;
 border:1px solid #eebf76;border-radius:9px;background:#3b231eea;color:#fff3d8;
 font-size:clamp(9px,1.7vw,12px);line-height:1.16;letter-spacing:.1px;text-shadow:none;text-align:center
}
.gg-build-placement{color:#ffc0b4}
.gg-build-placement[data-ready="true"]{color:#c4ffdf}
.gg-hotbar[data-active="false"]{width:max-content;height:auto;aspect-ratio:auto;background:none}
.gg-hotbar[data-active="false"] .gg-build-controls{position:static;transform:none;max-width:none}
.gg-hotbar[data-active="false"] :is(.gg-hotbar-header,.gg-hotbar-slots,.gg-hotbar-charge){display:none}
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
  private readonly needle: HTMLElement;
  private readonly stages: HTMLElement[];
  private readonly stageLabels: HTMLElement[];
  private readonly comboTitle: HTMLElement;
  private readonly comboCount: HTMLElement;
  private readonly comboInfo: HTMLElement;
  private readonly score: HTMLElement;
  private readonly scorePanel: HTMLElement;
  private readonly partyScoreboard: HTMLElement;
  private readonly partyTitle: HTMLElement;
  private readonly partyClock: HTMLElement;
  private readonly partyClockLabel: HTMLElement;
  private readonly partyMetrics: HTMLElement;
  private readonly partyGoal: HTMLElement;
  private readonly partyStatus: HTMLElement;
  private partyHudKey: string | null = null;
  private readonly place: HTMLElement;
  private readonly mapCanvas: SVGElement;
  private playerArrow: SVGElement | null = null;
  private mapSceneryClearance: SVGElement | null = null;
  private mapObjectives: SVGGElement | null = null;
  private mapOrigin: { x: number; z: number } | null = null;
  private mapZone = '';
  private hayHaulMapMarker: SVGGElement | null = null;
  private readonly stamina: HTMLElement;
  private readonly staminaNumber: HTMLElement;
  private readonly staminaLabel: HTMLElement;
  private readonly charge: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly buildStatus: HTMLElement;
  private readonly buildPlacement: HTMLElement;
  private buildControlsKey = '';
  private readonly slots: HTMLElement[];
  private readonly buildKeys: HTMLElement[];
  private readonly quantities: Array<HTMLElement | null>;
  private readonly supplies: Record<'hay' | 'wood' | 'scrap', HTMLElement>;
  private readonly stageElements: HTMLElement[];
  private readonly hint: HTMLElement;
  private readonly hintKey: HTMLElement;
  private readonly hintCopy: HTMLElement;
  private inputDevice: InputDevice = 'keyboard-mouse';
  private readonly debug: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly gigCard: HTMLElement;
  private readonly gigCheckbox: HTMLElement;
  private gigLayoutKey = '';
  private readonly gigTitle: HTMLElement;
  private readonly gigTask: HTMLElement;
  private readonly gigDetail: HTMLElement;
  private readonly board: HTMLElement;
  private readonly boardKey: HTMLElement;
  private readonly hotbar: HTMLElement;

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
      '<span class="gg-slot-key" data-build-key data-sprite="' + HUD_SPRITES.keyBadge + '">' +
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
      '<div class="gg-meter-caption"><b data-meter>0 / 100</b></div></section>' +
      '<section class="gg-combo" data-sprite="' + HUD_SPRITES.scoreStarburst +
      '" data-score-panel aria-label="Chaos combo and score">' +
      '<div class="gg-combo-title" data-combo-title></div>' +
      '<div class="gg-combo-count" data-combo-count></div>' +
      '<div class="gg-current-score"><span class="gg-score-caption" data-combo-info>STYLE SCORE</span>' +
      '<div class="gg-score-ribbon"><strong class="gg-score" data-score>0</strong></div></div>' +
      '<div class="gg-party-scoreboard" data-party-scoreboard hidden>' +
      '<div class="gg-party-head"><strong class="gg-party-title" data-party-title></strong>' +
      '<div class="gg-party-clock"><span class="gg-party-clock-label" data-party-clock-label></span>' +
      '<strong class="gg-party-clock-time" data-party-clock></strong></div></div>' +
      '<div class="gg-party-metrics" data-party-metrics></div>' +
      '<strong class="gg-party-goal" data-party-goal></strong>' +
      '<span class="gg-party-status" data-party-status hidden></span></div></section>' +
      '<section class="gg-map-panel" data-sprite="' + HUD_SPRITES.minimapRing +
      '" aria-label="Island minimap">' +
      '<div class="gg-map-frame"><svg data-map viewBox="0 0 280 280" aria-hidden="true"></svg></div>' +
      '<div class="gg-map-skin" aria-hidden="true"></div>' +
      '<div class="gg-map-north" aria-label="North">' +
      hudSpriteImage(HUD_SPRITES.compassN, 'gg-compass') + '</div>' +
      '<div class="gg-map-location"><strong data-place>HOOFINGTON</strong></div></section>' +
      '<section class="gg-gig-card" data-sprite="' + HUD_SPRITES.gigCard +
      '" data-gig-card aria-label="Current gig">' +
      '<div class="gg-gig-header">CURRENT GIG</div>' +
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
      '<strong class="gg-stamina-label" data-stamina-label>STAMINA</strong>' +
      '<span class="gg-stamina-value" data-stamina-number>100 / 100</span></div></section>' +
      '<section class="gg-hotbar" data-sprite="' + HUD_SPRITES.hotbarTray +
      '" data-hotbar data-active="false" aria-label="Hay-Build hotbar">' +
      '<div class="gg-build-controls"><span data-build-status>B · BUILD</span>' +
      '<strong class="gg-build-placement" data-build-placement hidden></strong></div>' +
      '<div class="gg-hotbar-header">HAY-BUILD</div>' +
      '<div class="gg-hotbar-slots">' + hotbar +
      '<div class="gg-supply" aria-label="Supplies inventory">' +
      '<strong class="gg-supply-title">SUPPLIES</strong><div class="gg-supply-amounts">' +
      '<span>HAY</span><b data-supply-hay>0</b><span>WOOD</span><b data-supply-wood>0</b>' +
      '<span>SCRAP</span><b data-supply-scrap>0</b></div></div></div>' +
      '<div class="gg-hotbar-charge"><div data-charge></div></div></section>' +
      '<div class="gg-prompts"><div class="gg-board-hint" data-sprite="' + HUD_SPRITES.promptPill +
      '" data-board-hint hidden><span class="gg-prompt-key" data-board-key data-sprite="' +
      HUD_SPRITES.keyBadge + '">E</span><span class="gg-prompt-copy">GOAT GIGS</span></div>' +
      '<div class="gg-hint" data-sprite="' + HUD_SPRITES.promptPill +
      '" data-hint><span class="gg-prompt-key gg-prompt-mouse" data-hint-key data-sprite="' +
      HUD_SPRITES.keyBadge + '" aria-hidden="true">🖱</span>' +
      '<span class="gg-prompt-copy" data-hint-copy>MOUSE / IJKL LOOK · C CAPTURE MOUSE</span></div></div>' +
      '<div class="gg-debug" data-debug hidden></div>';
    host.appendChild(this.root);
    const get = (name: string): HTMLElement => {
      const element = this.root.querySelector<HTMLElement>('[data-' + name + ']');
      if (!element) throw new Error('HUD element missing: ' + name);
      return element;
    };
    this.fill = get('fill'); this.meterText = get('meter');
    this.needle = get('needle');
    this.stages = Array.from(this.root.querySelectorAll<HTMLElement>('[data-stage]'));
    this.stageLabels = Array.from(this.root.querySelectorAll<HTMLElement>('[data-stage-label]'));
    this.stageElements = this.stages.concat(this.stageLabels);
    this.comboTitle = get('combo-title'); this.comboCount = get('combo-count');
    this.comboInfo = get('combo-info'); this.score = get('score');
    this.scorePanel = get('score-panel'); this.partyScoreboard = get('party-scoreboard');
    this.partyTitle = get('party-title'); this.partyClock = get('party-clock');
    this.partyClockLabel = get('party-clock-label'); this.partyMetrics = get('party-metrics');
    this.partyGoal = get('party-goal'); this.partyStatus = get('party-status');
    this.place = get('place');
    const map = this.root.querySelector<SVGElement>('[data-map]');
    if (!map) throw new Error('HUD minimap missing');
    this.mapCanvas = map;
    this.stamina = get('stamina'); this.staminaNumber = get('stamina-number');
    this.staminaLabel = get('stamina-label');
    this.charge = get('charge'); this.mode = get('mode');
    this.buildStatus = get('build-status'); this.buildPlacement = get('build-placement');
    this.slots = Array.from(this.root.querySelectorAll<HTMLElement>('[data-slot]'));
    this.buildKeys = Array.from(this.root.querySelectorAll<HTMLElement>('[data-build-key]'));
    this.quantities = this.slots.map(element => element.querySelector<HTMLElement>('[data-quantity]'));
    this.supplies = {
      hay: get('supply-hay'), wood: get('supply-wood'), scrap: get('supply-scrap'),
    };
    this.hint = get('hint'); this.hintKey = get('hint-key'); this.hintCopy = get('hint-copy');
    this.debug = get('debug'); this.wallet = get('wallet');
    this.gigCard = get('gig-card'); this.gigCheckbox = get('gig-checkbox');
    this.gigTitle = get('gig-title'); this.gigTask = get('gig-task');
    this.gigDetail = get('gig-detail'); this.board = get('board-hint'); this.boardKey = get('board-key');
    this.hotbar = get('hotbar');
  }

  private updateMap(game: Game, location: string, hayHaul: HayHaulGuidance | null): void {
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
      this.hayHaulMapMarker = null;
      this.playerArrow = this.mapCanvas.querySelector('[data-player]');
      this.mapSceneryClearance = this.mapCanvas.querySelector('[data-map-player-clearance]');
      this.mapObjectives = this.mapCanvas.querySelector('[data-map-objectives]');
    }
    const point = projectHudMap(position, this.mapOrigin);
    const degrees = game.goat.locomotion.heading * 180 / Math.PI;
    const translate = 'translate(' + point.x.toFixed(1) + ' ' + point.y.toFixed(1) + ')';
    this.playerArrow?.setAttribute('transform', translate + ' rotate(' + degrees.toFixed(0) + ')');
    if (this.mapSceneryClearance && this.mapSceneryClearance.getAttribute('transform') !== translate) {
      this.mapSceneryClearance.setAttribute('transform', translate);
    }
    this.updateHayHaulMap(hayHaul, point);
    const run = game.gigs.active;
    const target = !game.party.match && run?.status === 'running' && run.objective.kind === 'summit'
      ? run.objective.next : undefined;
    const flag = this.mapObjectives?.querySelector('[data-map-climb-target]');
    if (flag) {
      flag.setAttribute('visibility', target ? 'visible' : 'hidden');
      if (target) {
        const { x, y } = gigMapPoint(target, this.mapOrigin);
        flag.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
      }
    }
  }

  private updateHayHaulMap(hayHaul: HayHaulGuidance | null,
    player: ReturnType<typeof projectHudMap>): void {
    if (this.hayHaulMapMarker && this.hayHaulMapMarker.dataset.hayHaulMarker !== hayHaul?.kind) {
      this.hayHaulMapMarker.remove();
      this.hayHaulMapMarker = null;
    }
    if (!hayHaul || !this.mapOrigin || !this.mapObjectives) return;
    if (!this.hayHaulMapMarker) {
      this.hayHaulMapMarker = createHayHaulMapMarker(hayHaul.kind);
      this.mapObjectives.append(this.hayHaulMapMarker);
    }
    const anchor = gigMapPoint(hayHaul.position, this.mapOrigin);
    const badge = separateMapObjective(anchor, player);
    const leader = this.hayHaulMapMarker.querySelector('line');
    leader?.setAttribute('x2', (anchor.x - badge.x).toFixed(1));
    leader?.setAttribute('y2', (anchor.y - badge.y).toFixed(1));
    this.hayHaulMapMarker.setAttribute('transform', 'translate(' + badge.x.toFixed(1) + ' ' +
      badge.y.toFixed(1) + ')');
  }

  private updatePartyScoreboard(game: Game): void {
    const match = game.party.match;
    if (!match) {
      if (this.partyHudKey !== null) {
        this.partyHudKey = null;
        delete this.scorePanel.dataset.partyActive;
        this.scorePanel.setAttribute('aria-label', 'Chaos combo and score');
        this.partyScoreboard.hidden = true;
        this.gigCard.hidden = false;
      }
      return;
    }

    const state = derivePartyHudState(match.toJSON(), game.island.tideLevels, 'player');
    const title = game.party.title;
    const key = JSON.stringify([title, state]);
    if (key === this.partyHudKey) return;
    if (this.partyHudKey === null || this.partyTitle.textContent !== title) {
      this.scorePanel.dataset.partyActive = 'true';
      this.scorePanel.setAttribute('aria-label', title + ' scoreboard');
      this.partyTitle.textContent = title;
      this.partyScoreboard.hidden = false;
      this.gigCard.hidden = true;
    }
    this.partyHudKey = key;
    this.partyClockLabel.textContent = state.clockLabel;
    this.partyClock.textContent = state.clock;
    this.partyGoal.textContent = state.goal;
    this.partyStatus.textContent = state.status;
    this.partyStatus.hidden = !state.status;
    this.partyStatus.dataset.urgent = String(state.urgent);
    this.partyMetrics.replaceChildren(...state.metrics.map(metric => {
      const item = document.createElement('div');
      item.className = 'gg-party-metric';
      if (metric.ownTeam) item.dataset.own = 'true';
      const label = document.createElement('span');
      label.className = 'gg-party-metric-label';
      label.textContent = metric.label;
      const value = document.createElement('strong');
      value.className = 'gg-party-metric-value';
      value.textContent = metric.value;
      item.append(label, value);
      return item;
    }));
  }


  update(game: Game, fps: number, stepMilliseconds: number, debugVisible: boolean,
    pointerLocked: boolean, perf?: FramePerformance, hayHaul: HayHaulGuidance | null = null,
    device: InputDevice = 'keyboard-mouse', pointerLockUnavailable = false): void {
    const rules = game.rules;
    const inventory = rules.inventory.all;
    const activeGig = game.gigs.active;
    const run = activeGig?.status === 'running' ? activeGig : game.pendingGigResult;
    // Enter a little inside the interaction radius to avoid blinking at its edge.
    const boardInRange = game.gigs.nearBoard(this.board.hidden ? 8.75 : 9) !== null;
    const carryStamina = carryStaminaForHud(game.party.match, 'player');
    const state = deriveHudState({
      tier: rules.style.tier, meter: rules.style.meter, score: rules.style.score,
      combo: rules.style.combo, stamina: carryStamina ?? rules.abilities.stamina,
      headbuttCharge: rules.abilities.headbuttCharge,
      inventory, buildMode: game.buildMode,
      buildPiece: game.buildPiece, ragdoll: game.goat.isRagdoll,
      location: game.location, coins: rules.wallet.coins, boardInRange,
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
    for (const element of this.stageElements) {
      const label = element.getAttribute('data-stage') ?? element.getAttribute('data-stage-label');
      element.classList.toggle('is-active', label === state.tier);
    }
    const comboActive = state.comboCount > 0;
    this.scorePanel.toggleAttribute('data-combo-active', comboActive);
    this.comboTitle.textContent = state.comboTitle;
    this.comboCount.textContent = comboActive ? '×' + state.comboCount + '\nCOMBO!' : '';
    this.comboInfo.textContent = comboActive ?
      '+' + state.comboPoints + ' COMBO POINTS · STYLE SCORE' : 'STYLE SCORE';
    this.score.textContent = state.score;
    this.place.textContent = state.location;
    this.place.dataset.longLabel = String(state.location.length > 18);
    this.wallet.textContent = state.coins + ' CUD COINS';
    this.updateMap(game, state.location, hayHaul);

    this.stamina.style.setProperty('--gg-stamina', state.stamina.toFixed(2) + '%');
    const staminaLow = String(state.staminaLow);
    const staminaLabel = carryStamina === undefined ? 'STAMINA' : 'CARRY';
    if (staminaLow !== this.stamina.dataset.low || this.staminaLabel.textContent !== staminaLabel) {
      this.stamina.dataset.low = staminaLow;
      this.staminaLabel.textContent = staminaLabel;
      const name = carryStamina === undefined ? 'stamina' : 'carry stamina';
      this.stamina.setAttribute('aria-label', state.staminaLow ? 'Low ' + name :
        name[0]!.toUpperCase() + name.slice(1));
    }
    this.staminaNumber.textContent = Math.floor(state.stamina) + ' / 100';
    this.charge.style.width = state.headbutt.toFixed(2) + '%';
    this.mode.textContent = state.mode;
    for (let i = 0; i < state.slots.length; i++) {
      const slot = state.slots[i]!, element = this.slots[i]!;
      element.classList.toggle('is-selected', slot.selected);
      element.dataset.sprite = slot.selected ? HUD_SPRITES.hotbarSlotSelected : HUD_SPRITES.hotbarSlot;
      element.classList.toggle('is-empty', slot.available === 0);
      const count = this.quantities[i];
      if (count) count.textContent = '×' + slot.available;
      const binding = device === 'gamepad' ? PAD_BUILD_BINDINGS[slot.type].label : 'key ' + slot.key;
      element.title = slot.label + ' · ' + slot.available + ' can be built now · ' + binding;
    }
    for (const material of ['hay', 'wood', 'scrap'] as const) {
      this.supplies[material].textContent = String(inventory[material]);
    }
    this.gigTitle.textContent = state.gig.title;
    this.gigTask.textContent = hayHaul?.task ?? state.gig.task;
    this.gigDetail.textContent = state.gig.detail;
    this.gigCheckbox.hidden = run?.status !== 'running' || !!game.party.match;
    this.updatePartyScoreboard(game);
    // Refit only when copy or dimensions change, not every simulation frame.
    const gigLayoutKey = [this.gigTitle.textContent, this.gigTask.textContent,
      this.gigDetail.textContent, this.wallet.textContent, this.mode.textContent,
      this.gigCard.clientWidth, this.gigCard.clientHeight].join('|');
    if (gigLayoutKey !== this.gigLayoutKey) {
      fitGigCardText(this.gigCard);
      this.gigLayoutKey = gigLayoutKey;
    }
    this.board.hidden = !boardInRange;
    this.setPointerLockHint(pointerLocked, boardInRange, device, pointerLockUnavailable);
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
  }

  setBuildPreview(validation: Validation | null, device: InputDevice): void {
    const state = validation === null ? 'idle' : validation.valid ? 'ready' : validation.reason;
    const key = state + ':' + device;
    if (key === this.buildControlsKey) return;
    this.buildControlsKey = key;

    const gamepad = device === 'gamepad';
    this.buildKeys.forEach((badge, i) => {
      const piece = HUD_PIECES[i]!;
      badge.textContent = gamepad ? PAD_BUILD_BINDINGS[piece.type].key : piece.key;
    });
    this.hotbar.dataset.active = String(validation !== null);
    this.buildStatus.textContent = validation
      ? (gamepad ? 'D-PAD SELECT · RT PLACE · Y EXIT' : '1–4 SELECT · LMB PLACE · B EXIT')
      : (gamepad ? 'Y · BUILD' : 'B · BUILD');
    this.buildPlacement.hidden = validation === null;
    if (!validation) return;
    this.buildPlacement.dataset.ready = String(validation.valid);
    const reasons: Record<PlacementFailure, string> = {
      'out-of-bounds': 'OUT OF BOUNDS',
      'invalid-rotation': 'INVALID ROTATION',
      overlap: 'SPACE OCCUPIED',
      'no-support': 'NEEDS SUPPORT',
      cost: 'NEED MATERIALS',
    };
    this.buildPlacement.textContent = validation.valid ? 'READY' : reasons[validation.reason];
  }

  setPointerLockHint(pointerLocked: boolean, boardInRange = false,
    device: InputDevice = 'keyboard-mouse', pointerLockUnavailable = false): void {
    const gamepad = device === 'gamepad';
    if (device !== this.inputDevice) {
      this.inputDevice = device;
      this.hintKey.className = gamepad ? 'gg-prompt-key' : 'gg-prompt-key gg-prompt-mouse';
      this.hintKey.textContent = gamepad ? 'RS' : '🖱';
      this.boardKey.textContent = gamepad ? 'X' : 'E';
    }
    const copy = gamepad ? 'RIGHT STICK TO LOOK' : pointerLockUnavailable
      ? 'MOUSE / IJKL LOOK · HOLD EDGE TO TURN' : 'MOUSE / IJKL LOOK · C CAPTURE MOUSE';
    if (this.hintCopy.textContent !== copy) this.hintCopy.textContent = copy;
    const hideLookHint = boardInRange || (pointerLocked && !gamepad);
    if (this.hint.hidden !== hideLookHint) this.hint.hidden = hideLookHint;
  }

  setVisible(visible: boolean): void { this.root.style.display = visible ? 'block' : 'none'; }
  dispose(): void { this.root.remove(); this.styles.remove(); }
}
