import type { Game } from './Game';
import { HUD_PIECES, deriveHudState, projectHudMap } from './GameHudState';
import { buildArtwork, goatArtwork, renderHudMinimap } from './HudArtwork';
import { planGoatSafeHud, type ScreenRect } from './HudOcclusion';

const CSS = `
.gg-ui{position:absolute;inset:0;z-index:4;pointer-events:none;user-select:none;overflow:hidden;color:#fff9df;font-family:"Trebuchet MS","Arial Rounded MT Bold","Arial Black",system-ui,sans-serif;font-weight:900;text-shadow:0 2px 1px #422b3d,0 3px 3px #412a4999}
.gg-ui *{box-sizing:border-box}
.gg-ui [hidden]{display:none!important}
/* A filter on the whole combo would draw a ghosted second STYLE SCORE below the pill. */
.gg-meter,.gg-map-panel,.gg-gig-card,.gg-stamina,.gg-hotbar{filter:drop-shadow(0 7px 0 #2e204d90)}
.gg-meter{position:absolute;top:21px;left:21px;width:clamp(310px,31vw,516px);padding:19px 16px 10px;border-radius:40px;background:linear-gradient(175deg,#444575 2%,#29294f 57%,#393566 100%);border:5px solid #9fc7fa;box-shadow:inset 0 0 0 3px #62548e,inset 0 7px 11px #a8cfff65,0 1px 0 3px #352b65}
.gg-meter:before{content:"";position:absolute;inset:6px;border:1px solid #a0c4ff44;border-radius:32px;pointer-events:none}
.gg-meter-label{position:absolute;top:-17px;left:11%;padding:0 15px 2px;background:linear-gradient(#4f5083,#2d2b58);border:4px solid #a3b9eb;border-radius:22px;font-size:clamp(17px,1.6vw,26px);line-height:1.3;letter-spacing:.5px;color:#ffd63b;text-shadow:2px 3px #7c304a,-1px -1px #712d4e;white-space:nowrap;box-shadow:0 4px 0 #232449}
.gg-meter-icons{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:end;height:58px;position:relative;z-index:1}
.gg-meter-stage{display:flex;flex-direction:column;align-items:center;justify-content:end;opacity:.77;transform:translateY(2px);transition:opacity .15s,transform .15s}
.gg-meter-stage .gg-goat-art{height:43px;width:58px;overflow:visible;filter:drop-shadow(0 2px 0 #442d56)}
.gg-meter-stage:nth-child(2) .gg-goat-art{height:48px;width:67px}
.gg-meter-stage:nth-child(3) .gg-goat-art{height:55px;width:76px}
.gg-meter-stage:nth-child(4) .gg-goat-art{height:63px;width:88px}
.gg-meter-stage.is-active{opacity:1;transform:translateY(-4px);filter:drop-shadow(0 0 9px #ffed9c)}
.gg-meter-track{height:33px;position:relative;margin:1px 1px 0;background:linear-gradient(90deg,#41793a 0%,#777a30 18%,#8f6831 55%,#843045 100%);border:4px solid #fff3ca;border-radius:20px;box-shadow:0 3px 0 #513c63,inset 0 3px 6px #1a294a9c;overflow:visible}
.gg-meter-fill{height:100%;width:0;background:linear-gradient(90deg,#42f05b 0%,#a8f527 17%,#ffe33e 40%,#ff8b1f 69%,#fc274e 100%);border-radius:15px;box-shadow:inset 0 4px 3px #ffffff80,0 0 12px #fef39f70;transition:width .13s linear}
.gg-meter-ticks{position:absolute;inset:1px 0;pointer-events:none;background:linear-gradient(90deg,transparent 15.6%,#583e41 15.6%,#583e41 16.2%,transparent 16.2%,transparent 54.6%,#583e41 54.6%,#583e41 55.2%,transparent 55.2%);opacity:.8}
.gg-meter-arrow{position:absolute;top:-9px;left:0;transform:translateX(-50%);width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:15px solid #fff7bb;filter:drop-shadow(0 3px 1px #61273e);transition:left .13s linear}
.gg-meter-stage-labels{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-top:4px}
.gg-meter-stage-labels span{text-align:center;background:linear-gradient(#5066a7,#3d397b);border:2px solid #91a9d8;border-radius:30px;padding:1px 1px;font-size:clamp(10px,1.15vw,18px);line-height:1.2;color:#fff6dd;text-shadow:1px 2px #403360}
.gg-meter-stage-labels span:nth-child(2){background:linear-gradient(#8460ac,#6c458f)}
.gg-meter-stage-labels span:nth-child(3){background:linear-gradient(#c47a43,#95502c)}
.gg-meter-stage-labels span:nth-child(4){background:linear-gradient(#f4a02d,#cc5c24);color:#fffad4}
.gg-meter-stage-labels span.is-active{box-shadow:0 0 0 2px #ffe47f,0 0 10px #fff0a9;color:#fff}
.gg-meter-caption{display:flex;justify-content:space-between;gap:8px;color:#ffde72;font-size:10px;letter-spacing:.8px;margin:5px 4px 0}
.gg-combo{position:absolute;top:20px;left:50%;width:clamp(296px,31vw,510px);transform:translateX(-50%);text-align:center}
.gg-combo-burst{position:absolute;inset:-13px -18px 28px;background:#fff3a6;clip-path:polygon(0% 40%,10% 41%,5% 14%,21% 31%,24% 0%,38% 25%,47% 7%,54% 28%,72% 0%,75% 30%,92% 10%,85% 40%,100% 42%,89% 56%,98% 84%,77% 70%,72% 100%,56% 77%,42% 94%,32% 72%,11% 88%,15% 60%);filter:drop-shadow(0 5px 2px #442c6a);opacity:.96}
.gg-combo-title{position:relative;font-size:clamp(23px,2.7vw,45px);line-height:.92;max-width:100%;min-height:1.7em;display:flex;align-items:center;justify-content:center;padding:11px 17px 3px;word-break:normal;overflow-wrap:break-word;transform:rotate(-4deg);font-style:italic;letter-spacing:-1px;color:#ffcb36;-webkit-text-stroke:1.8px #842a4c;text-shadow:3px 4px 0 #672846,5px 6px 0 #ffed99,7px 8px 0 #4b2c66}
.gg-combo-count{position:absolute;top:49px;right:3px;transform:rotate(-6deg);background:#872aa1;border:3px solid #fff2b0;border-radius:14px;padding:1px 7px;color:#fff7d6;font-size:clamp(10px,1.2vw,18px);text-shadow:2px 2px #44204e}
.gg-score-ribbon{position:relative;display:flex;justify-content:center;align-items:center;gap:14px;width:75%;margin:4px auto 0;padding:0 15px 1px;background:linear-gradient(#9c3a4e,#4d263e);border:4px solid #ffd45e;border-radius:45px;box-shadow:0 5px 0 #6d3461,inset 0 4px #ffc88955}
.gg-score-ribbon:before,.gg-score-ribbon:after{content:"❯";color:#ffc64d;font-size:24px}
.gg-score-ribbon:before{transform:rotate(180deg)}
.gg-score{font-size:clamp(24px,2.6vw,45px);font-variant-numeric:tabular-nums;letter-spacing:1px;color:#fff6db;text-shadow:3px 3px #3b2035}
.gg-score-caption{position:relative;color:#ffedb8;font-size:10px;letter-spacing:1.1px;margin-top:2px}
.gg-map-panel{position:absolute;right:20px;top:10px;width:clamp(180px,17.2vw,283px);display:flex;flex-direction:column;align-items:center}
.gg-map-frame{position:relative;width:100%;aspect-ratio:1;border-radius:50%;padding:4px;border:7px solid #f2bd65;background:#6d4f6e;box-shadow:0 0 0 4px #663456,inset 0 3px #fff0ba,0 8px 0 #3a2e54;overflow:hidden}
.gg-map-frame svg{display:block;width:100%;height:100%;background:#80bd80;border-radius:50%}
.gg-map-north{position:absolute;top:-3px;left:50%;transform:translateX(-50%);width:39px;height:39px;border-radius:50%;display:grid;place-items:center;background:#2d3f6a;border:3px solid #fff3d2;box-shadow:0 3px 0 #593d51;color:#fff;font-size:21px;font-family:Georgia,serif}
.gg-map-location{position:relative;display:flex;justify-content:center;align-items:center;gap:8px;min-width:84%;max-width:110%;margin-top:-7px;white-space:nowrap;padding:5px 13px;border-radius:30px;border:4px solid #f8c66b;background:linear-gradient(180deg,#a34a34,#743329);box-shadow:0 4px 0 #54314b,inset 0 2px #e7a06d;font-size:clamp(12px,1.25vw,19px);letter-spacing:.3px;color:#fff4d3}
.gg-map-location:before,.gg-map-location:after{content:"♨";font-size:15px;color:#fbe0b3}
.gg-gig-card{position:absolute;right:16px;top:clamp(263px,30vw,317px);width:clamp(263px,23vw,375px);padding:11px 12px 12px;border-radius:30px;border:6px solid #a7572c;background:linear-gradient(#a8592b,#713927);box-shadow:0 0 0 3px #f3b85c,inset 0 3px #ffe1a0,0 8px 0 #4e2c4e}
.gg-gig-header{position:relative;margin:-14px -5px 5px;display:flex;align-items:center;justify-content:center;gap:8px;color:#ffcb40;font-size:clamp(16px,1.6vw,25px);letter-spacing:.3px;-webkit-text-stroke:.7px #663044;text-shadow:2px 3px #583147}
.gg-gig-clipboard{font-size:24px;display:grid;place-items:center;width:37px;height:43px;border-radius:7px;background:#fff1bf;border:4px solid #704a3e;box-shadow:0 2px 0 #e29a5c;transform:rotate(-9deg);-webkit-text-stroke:0}
.gg-gig-paper{background:linear-gradient(135deg,#fff8da,#ffedd0);border:4px solid #f6d18e;border-radius:18px;padding:11px 13px 9px;min-height:124px;color:#49302a;text-shadow:none;box-shadow:inset 0 -4px #f5d8a6}
.gg-gig-title{font-size:clamp(12px,1vw,15px);font-weight:1000;text-transform:uppercase;letter-spacing:.5px;color:#98542b;margin:0 0 5px}
.gg-gig-task{font-size:clamp(14px,1.25vw,19px);line-height:1.26;font-weight:1000;margin:0}
.gg-gig-detail{display:block;margin-top:9px;color:#8d4b3c;font-size:clamp(9px,.77vw,12px);font-weight:900;line-height:1.25}
.gg-gig-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 3px 0;color:#ffe69a;font-size:clamp(9px,.8vw,12px);letter-spacing:.3px}
.gg-gig-wallet{border-radius:15px;background:#432a3f;padding:3px 8px;border:1px solid #e0a55d;white-space:nowrap}
.gg-stamina{position:absolute;left:29px;bottom:27px;width:clamp(130px,13vw,210px);aspect-ratio:1;border-radius:50%;border:7px solid #f9d78c;background:conic-gradient(from -90deg,#c9fc35 0%,#5de841 var(--gg-stamina,100%),#372e46 var(--gg-stamina,100%) 100%);box-shadow:0 0 0 4px #82473e,inset 0 0 0 4px #353251,inset 0 0 0 7px #90a654,0 8px 0 #3d264c;display:grid;place-items:center}
.gg-stamina-inner{width:67%;height:67%;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 40% 27%,#5f4b3a,#2d2537 76%);border:5px solid #574448;box-shadow:0 3px 3px #1a1523,inset 0 3px 8px #2d2331}
.gg-hoof{position:relative;width:47%;height:41%;display:flex;justify-content:center;gap:5px;transform:rotate(10deg)}
.gg-hoof:before,.gg-hoof:after{content:"";display:block;width:47%;height:100%;border-radius:85% 80% 58% 55%;background:linear-gradient(#fff9cd,#ffc759);box-shadow:inset -2px -4px #bb713d,1px 2px #fff2af;transform:rotate(14deg)}
.gg-hoof:after{transform:rotate(-14deg)}
.gg-stamina-label{margin-top:4px;color:#ffe5a8;font-size:clamp(13px,1.35vw,22px);line-height:1.1;transform:rotate(7deg)}
.gg-stamina-value{font-size:clamp(10px,.9vw,14px);color:#fff9dd;margin-top:2px}
.gg-hotbar{position:absolute;left:50%;bottom:7px;transform:translateX(-50%);width:min(560px,43vw);padding:7px 9px 5px;border:4px solid #e9a758;border-radius:23px;background:linear-gradient(180deg,#98552c,#723e2d 54%,#85482b);box-shadow:0 0 0 3px #693b4e,inset 0 4px #ffe2ab,inset 0 -4px #4c2b42,0 7px 0 #3b2346}
.gg-hotbar-header{position:absolute;top:-28px;left:50%;transform:translateX(-50%);white-space:nowrap;padding:0 18px 1px;border:3px solid #f0b75e;border-radius:30px;background:linear-gradient(#ac562f,#723d31);box-shadow:0 4px 0 #62344e,inset 0 2px #ffe5b0;color:#ffe08a;font-size:clamp(16px,1.25vw,22px);letter-spacing:.4px;-webkit-text-stroke:.8px #753e37;text-shadow:2px 3px #532d43}
.gg-hotbar-header:before,.gg-hotbar-header:after{content:"✺";position:absolute;top:0;color:#ffe13f;font-size:24px}
.gg-hotbar-header:before{left:-23px}.gg-hotbar-header:after{right:-23px}
.gg-hotbar-slots{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.gg-slot{height:clamp(52px,4.2vw,70px);position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid #cc965b;border-radius:17px;background:linear-gradient(150deg,#663a3c,#482b38);box-shadow:inset 0 2px #edc18a44,0 3px 0 #49283d;min-width:0}
.gg-slot.is-selected{border-color:#ffed6a;box-shadow:0 0 0 4px #ffcf31,0 0 18px #ffed5e,inset 0 2px #fff1af;z-index:1;background:linear-gradient(155deg,#ac612a,#6c3a36)}
.gg-slot.is-empty .gg-piece-art{opacity:.53}
.gg-slot-key{position:absolute;top:-8px;left:-6px;padding:1px 8px;border-radius:9px;border:2px solid #f6d69e;background:#fff2cf;color:#603720;font-size:clamp(11px,.9vw,15px);font-weight:1000;text-shadow:none;box-shadow:0 2px 0 #734437}
.gg-piece-art{display:block;width:83%;height:73%;filter:drop-shadow(1px 4px 2px #281a32a0)}
.gg-slot-count{position:absolute;bottom:4px;right:5px;font-size:clamp(12px,1.05vw,18px);line-height:1;color:#fff6d5;text-shadow:2px 2px #381e37}
.gg-slot-name{position:absolute;bottom:3px;left:6px;font-size:clamp(7px,.6vw,10px);color:#ffdda0;text-shadow:none;max-width:67%;line-height:1.1}
.gg-hotbar-foot{display:flex;align-items:center;justify-content:space-between;gap:7px;margin:3px 3px 0;font-size:clamp(9px,.65vw,11px);color:#ffe6aa}
.gg-hotbar-foot strong{color:#fff9d5}
.gg-hotbar-charge{height:4px;border-radius:10px;background:#49253b;overflow:hidden;margin:3px 2px 0}
.gg-hotbar-charge>div{height:100%;width:0;background:linear-gradient(90deg,#ffb538,#ffeb65);transition:width .1s linear}
.gg-build-tip{font-weight:900}
.gg-board-hint{position:absolute;left:50%;top:192px;transform:translateX(-50%);background:linear-gradient(#ffe86a,#f9bc45);color:#57372c;border:3px solid #7c4a42;border-radius:16px;padding:5px 11px;text-shadow:none;font-size:clamp(11px,.85vw,13px);box-shadow:0 4px 0 #453056;white-space:nowrap}
.gg-hint{position:absolute;left:50%;top:192px;transform:translateX(-50%);padding:6px 12px;max-width:85vw;text-align:center;background:#342950ed;border:2px solid #ffde68;border-radius:12px;color:#fff7d1;font-size:clamp(11px,.85vw,13px);box-shadow:0 5px 0 #302044}
.gg-debug{position:absolute;left:20px;top:220px;background:#192542e8;border:2px solid #b7dfbc;border-radius:12px;padding:10px;font:12px/1.5 monospace;white-space:pre;color:#d7ffc9;text-shadow:none}
@media (max-width:1200px){
.gg-meter{top:15px;left:13px;width:clamp(290px,33vw,400px);padding:16px 12px 9px}
.gg-meter-icons{height:48px}.gg-meter-stage .gg-goat-art{max-height:47px}
.gg-combo{top:135px;width:clamp(240px,31vw,400px)}.gg-combo-title{font-size:clamp(22px,2.6vw,34px);min-height:1.3em}.gg-combo-count{top:40px}
.gg-map-panel{right:11px;top:10px;width:clamp(145px,20vw,230px)}
.gg-gig-card{right:10px;top:clamp(216px,25vw,267px);width:clamp(230px,29vw,315px)}
.gg-stamina{left:19px;bottom:20px;width:clamp(116px,14vw,168px)}
.gg-hotbar{width:min(520px,54vw)}
}
@media (max-width:760px){
.gg-meter{left:8px;top:12px;width:min(274px,49vw);border-width:3px;border-radius:24px;padding:17px 7px 7px}
.gg-meter-label{top:-12px;left:8%;font-size:14px;padding:0 8px;border-width:2px}
.gg-meter-icons{height:33px}.gg-meter-stage .gg-goat-art,.gg-meter-stage:nth-child(2) .gg-goat-art,.gg-meter-stage:nth-child(3) .gg-goat-art,.gg-meter-stage:nth-child(4) .gg-goat-art{height:35px;width:42px}
.gg-meter-track{height:21px;border-width:2px}.gg-meter-stage-labels span{font-size:10px;border-width:1px}.gg-meter-caption{font-size:7px}
.gg-map-panel{width:clamp(113px,27vw,175px);right:7px;top:8px}.gg-map-frame{border-width:4px;padding:2px}.gg-map-north{width:25px;height:25px;font-size:15px}.gg-map-location{padding:2px 6px;border-width:2px;font-size:10px;gap:2px}
.gg-combo{top:151px;left:33%;width:min(280px,56vw)}.gg-combo-title{font-size:clamp(18px,3.3vw,27px);padding:3px;min-height:1em}.gg-combo-burst{inset:-6px -9px 14px}.gg-combo-count{top:29px;right:-6px;font-size:9px}.gg-score-ribbon{width:76%;border-width:2px}.gg-score{font-size:23px}.gg-score-caption{font-size:8px}
.gg-gig-card{top:clamp(193px,38vw,270px);right:7px;width:min(238px,39vw);border-width:3px;border-radius:17px;padding:7px}.gg-gig-header{font-size:12px;margin:-10px -3px 5px}.gg-gig-clipboard{height:28px;width:27px;font-size:15px;border-width:2px}.gg-gig-paper{padding:8px;border-width:2px;border-radius:10px;min-height:99px}.gg-gig-title{font-size:9px}.gg-gig-task{font-size:12px}.gg-gig-detail{font-size:8px}.gg-gig-footer{font-size:8px}
.gg-stamina{left:10px;bottom:164px;width:105px;border-width:4px}.gg-stamina-inner{border-width:3px}.gg-stamina-label{font-size:12px}.gg-stamina-value{font-size:8px}
.gg-hotbar{width:calc(100% - 18px);bottom:9px;padding:7px 6px;border-width:3px;border-radius:20px}.gg-hotbar-header{top:-29px;padding:0 15px;border-width:3px;font-size:17px}.gg-hotbar-header:before,.gg-hotbar-header:after{font-size:16px}
.gg-hotbar-slots{gap:3px} .gg-slot{height:clamp(52px,12vw,69px);border-width:2px;border-radius:12px}.gg-slot-key{top:-6px;left:-4px;padding:0 5px;border-width:1px;font-size:11px}.gg-slot-count{font-size:12px}.gg-slot-name{font-size:7px}.gg-hotbar-foot{font-size:8px;margin:6px 1px 0}.gg-hotbar-charge{margin:4px 2px 0}
.gg-board-hint{top:180px;bottom:auto;font-size:9px;padding:5px 8px;border-width:2px;white-space:normal;text-align:center;max-width:50vw}
.gg-debug{top:270px;left:7px;font-size:9px}
}
@media (max-height:680px) and (min-width:760px){
.gg-stamina{width:128px;bottom:13px}.gg-hotbar{bottom:7px;padding-top:6px}.gg-slot{height:58px}
.gg-gig-card{top:220px}.gg-combo{top:116px}
}
`;

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
  private readonly materials: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly gigTitle: HTMLElement;
  private readonly gigTask: HTMLElement;
  private readonly gigDetail: HTMLElement;
  private readonly board: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly panels: Array<{ id: string; element: HTMLElement }>;

  constructor(host: HTMLElement) {
    this.styles.textContent = CSS;
    document.head.appendChild(this.styles);
    this.root.className = 'gg-ui';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Gigga-Goat game HUD');
    const goat = goatArtwork();
    const stages = ['Kid', 'Billy', 'Big', 'GIGGA'];
    const stageHtml = stages.map(name =>
      '<span class="gg-meter-stage" data-stage="' + name + '">' + goat + '</span>').join('');
    const stageLabels = stages.map(name =>
      '<span data-stage-label="' + name + '">' + name.toUpperCase() + '</span>').join('');
    const hotbar = HUD_PIECES.map(piece =>
      '<div class="gg-slot" data-slot="' + piece.type + '" title="' + piece.label + '">' +
      '<span class="gg-slot-key">' + piece.key + '</span>' + buildArtwork(piece.type) +
      '<span class="gg-slot-name">' + piece.label + '</span><span class="gg-slot-count" data-quantity>×0</span></div>').join('');
    this.root.innerHTML =
      '<section class="gg-meter" aria-label="Gigga size meter">' +
      '<div class="gg-meter-label">GIGGA SIZE METER</div>' +
      '<div class="gg-meter-icons">' + stageHtml + '</div>' +
      '<div class="gg-meter-track"><div class="gg-meter-fill" data-fill></div>' +
      '<div class="gg-meter-ticks"></div><div class="gg-meter-arrow" data-needle></div></div>' +
      '<div class="gg-meter-stage-labels">' + stageLabels + '</div>' +
      '<div class="gg-meter-caption"><span>CHAOS MAKES YOU BIGGER</span>' +
      '<span><b data-tier>KID</b> · <b data-meter>0 / 100</b></span></div></section>' +
      '<section class="gg-combo" aria-label="Chaos combo and score">' +
      '<div class="gg-combo-burst"></div><div class="gg-combo-title" data-combo-title>GIGGA-GOAT!</div>' +
      '<div class="gg-combo-count" data-combo-count>START A COMBO!</div>' +
      '<div class="gg-score-ribbon"><strong class="gg-score" data-score>0</strong></div>' +
      '<div class="gg-score-caption" data-combo-info>STYLE SCORE</div></section>' +
      '<section class="gg-map-panel" aria-label="Island minimap">' +
      '<div class="gg-map-frame"><svg data-map viewBox="0 0 280 280" aria-hidden="true"></svg></div>' +
      '<div class="gg-map-north" aria-label="North">N</div>' +
      '<div class="gg-map-location"><strong data-place>HOOFINGTON</strong></div></section>' +
      '<section class="gg-gig-card" aria-label="Current gig">' +
      '<div class="gg-gig-header"><span class="gg-gig-clipboard" aria-hidden="true">✎</span> CURRENT GIG</div>' +
      '<div class="gg-gig-paper"><h2 class="gg-gig-title" data-gig-title>YOUR NEXT GIG</h2>' +
      '<p class="gg-gig-task" data-gig-task></p><small class="gg-gig-detail" data-gig-detail></small></div>' +
      '<div class="gg-gig-footer"><span class="gg-gig-wallet" data-wallet>0 CUD COINS</span>' +
      '<span data-mode>FREE ROAM</span></div></section>' +
      '<section class="gg-stamina" data-stamina aria-label="Stamina">' +
      '<div class="gg-stamina-inner"><div class="gg-hoof" aria-hidden="true"></div>' +
      '<strong class="gg-stamina-label">STAMINA</strong><span class="gg-stamina-value" data-stamina-number>100</span>' +
      '</div></section>' +
      '<section class="gg-hotbar" data-hotbar aria-label="Hay-Build hotbar">' +
      '<div class="gg-hotbar-header">⚒ HAY-BUILD</div>' +
      '<div class="gg-hotbar-slots">' + hotbar +
      '<div class="gg-slot gg-supply" title="Materials in your inventory">' +
      '<span class="gg-slot-key">★</span>' + buildArtwork('supplies') +
      '<span class="gg-slot-name">SUPPLIES</span><span class="gg-slot-count" data-supply>×0</span></div></div>' +
      '<div class="gg-hotbar-foot"><span class="gg-build-tip" data-build-status>B TO BUILD · 1–4 SELECT</span>' +
      '<strong data-materials></strong></div><div class="gg-hotbar-charge"><div data-charge></div></div></section>' +
      '<div class="gg-board-hint" data-board-hint hidden>PRESS E / GAMEPAD X · GOAT GIGS</div>' +
      '<div class="gg-hint" data-hint>CLICK TO PLAY · MOUSE TO LOOK</div>' +
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
    this.hint = get('hint'); this.debug = get('debug'); this.wallet = get('wallet');
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
        '.gg-meter-label,.gg-combo-burst,.gg-map-north,.gg-map-location,.gg-hotbar-header'
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
    pointerLocked: boolean, goatScreenBox: ScreenRect | null = null): void {
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
    for (const element of [...this.stages, ...this.stageLabels]) {
      const label = element.getAttribute('data-stage') ?? element.getAttribute('data-stage-label');
      element.classList.toggle('is-active', label === state.tier);
    }
    this.comboTitle.textContent = state.comboTitle;
    this.comboCount.textContent = state.comboCount ? '×' + state.comboCount + ' COMBO!' : 'START A COMBO!';
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
      element.classList.toggle('is-selected', state.buildMode && slot.selected);
      element.classList.toggle('is-empty', slot.available === 0);
      const count = element.querySelector<HTMLElement>('[data-quantity]');
      if (count) count.textContent = '×' + slot.available;
      element.title = slot.label + ' · ' + slot.available + ' can be built now · key ' + slot.key;
    }
    const supply = this.root.querySelector<HTMLElement>('[data-supply]');
    if (supply) supply.textContent = '×' + rules.inventory.get('scrap');
    this.gigTitle.textContent = state.gig.title;
    this.gigTask.textContent = state.gig.task;
    this.gigDetail.textContent = state.gig.detail;
    this.updatePartyCard(game);
    this.board.hidden = !game.gigs.nearBoard();
    this.hint.style.display = pointerLocked ? 'none' : 'block';
    this.debug.hidden = !debugVisible;
    if (debugVisible) this.debug.textContent = 'F3 · SIM DEBUG\n' +
      'FPS: ' + fps.toFixed(0) + '\n' +
      'PHYSICS FRAME: ' + stepMilliseconds.toFixed(2) + ' ms\n' +
      'BODIES: ' + game.bodyCount + '\n' +
      'TICK: ' + game.physics.stepCount + '\n' +
      'WATER BODIES: ' + game.water.submergedCount + '\n' +
      'DEBRIS: ' + game.breakables.debrisCount + '\n' +
      'RESPAWNS: ' + game.respawns;
    this.clearGoat(goatScreenBox);
  }

  setVisible(visible: boolean): void { this.root.style.display = visible ? 'block' : 'none'; }
  dispose(): void { this.root.remove(); this.styles.remove(); }
}
