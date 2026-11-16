import type { Game } from './Game';

const CSS = [
  ".gg-ui{position:absolute;inset:0;pointer-events:none;z-index:4;color:#fffaf1;font-family:system-ui,sans-serif;text-shadow:0 2px 4px #161b3d99;user-select:none}",
  ".gg-ui *{box-sizing:border-box}",
  ".gg-meter{position:absolute;left:24px;top:24px;width:min(350px,calc(100vw - 48px));padding:12px 15px;background:#272341dc;border:3px solid #d7baff;border-radius:20px;box-shadow:0 6px 0 #15173588}",
  ".gg-meter-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}",
  ".gg-logo{font-size:26px;letter-spacing:1px;font-weight:1000;color:#ffd833;transform:rotate(-2deg)}",
  ".gg-tier{border-radius:14px;background:#ff891e;padding:4px 9px;color:#251b36;font-weight:1000;text-shadow:none;font-size:13px;letter-spacing:1px}",
  ".gg-meter-track{height:19px;border:3px solid #ede3ff;border-radius:18px;overflow:hidden;background:#181536;margin-top:8px;position:relative}",
  ".gg-meter-fill{width:0;height:100%;background:linear-gradient(90deg,#7a4cff,#c875ff 52%,#ffd833);border-radius:18px;transition:width .13s linear}",
  ".gg-meter-ticks{pointer-events:none;position:absolute;inset:0;background:linear-gradient(90deg,transparent 15.7%,#fff8 16%,transparent 16.3%,transparent 54.7%,#fff8 55%,transparent 55.3%)}",
  ".gg-meter-caption{margin-top:5px;display:flex;justify-content:space-between;font-size:11px;font-weight:800;letter-spacing:.5px;color:#e9e0ff}",
  ".gg-combo{position:absolute;top:28px;left:50%;transform:translateX(-50%);text-align:center;min-width:200px;filter:drop-shadow(0 3px 0 #373268);transition:opacity .25s}",
  ".gg-combo-title{font-size:clamp(21px,3vw,38px);font-weight:1000;font-style:italic;color:#ffd833;letter-spacing:1px;white-space:nowrap;-webkit-text-stroke:1px #6a3d70}",
  ".gg-combo-info{font-size:16px;font-weight:900;letter-spacing:1px}",
  ".gg-place{position:absolute;top:25px;right:24px;text-align:right;background:#212845c8;border:2px solid #ffffff66;border-radius:15px;padding:10px 15px;max-width:300px}",
  ".gg-place-label{font-size:10px;letter-spacing:2px;font-weight:900;color:#d1eafb}",
  ".gg-place-name{font-size:20px;font-weight:1000}",
  ".gg-bottom{position:absolute;left:25px;bottom:24px;display:flex;align-items:end;gap:13px}",
  ".gg-stamina{width:100px;height:100px;border:4px solid #fff5d8;border-radius:50%;display:grid;place-items:center;box-shadow:0 5px 0 #1e245088}",
  ".gg-stamina-inner{width:69px;height:69px;border-radius:50%;background:#25243f;display:flex;flex-direction:column;align-items:center;justify-content:center}",
  ".gg-stamina-inner strong{font-size:24px;line-height:1.05}.gg-stamina-inner span{font-size:9px;font-weight:900;letter-spacing:1px}",
  ".gg-state{background:#242443d9;border:2px solid #f7e0ae88;border-radius:16px;padding:9px 14px;min-width:150px;font-size:12px;font-weight:900}",
  ".gg-state strong{display:block;color:#ffd833;font-size:16px}",
  ".gg-charge-track{height:7px;border-radius:12px;background:#3d3159;overflow:hidden;margin-top:7px}.gg-charge-bar{height:100%;width:0;background:#ff891e}",
  ".gg-help{position:absolute;right:24px;bottom:24px;max-width:370px;background:#1c2348c9;border:2px solid #ecf9ff6e;border-radius:17px;padding:10px 14px;font-size:12px;line-height:1.7}",
  ".gg-help kbd{display:inline-block;color:#21223b;background:#fff3d5;border-radius:5px;text-shadow:none;padding:0 4px;font-weight:900}",
  ".gg-build{display:none;color:#fff4c8;font-weight:900;margin-top:4px}",
  ".gg-hint{position:absolute;top:61%;left:50%;transform:translate(-50%,-50%);background:#282143cf;border:2px solid #ffd833;border-radius:16px;padding:12px 18px;font-size:18px;font-weight:1000;text-align:center}",
  ".gg-debug{position:absolute;top:125px;right:24px;background:#0b1636ef;color:#d2ffc2;border:1px solid #81b8aa;border-radius:8px;padding:10px;font:12px/1.5 monospace;min-width:196px;text-shadow:none;white-space:pre}",
  "@media(max-width:850px){.gg-combo{top:118px}.gg-place{top:23px;right:16px;padding:7px}.gg-place-name{font-size:14px}.gg-meter{left:14px;top:14px;width:260px}.gg-logo{font-size:20px}.gg-help{right:12px;bottom:12px;font-size:10px;max-width:210px}.gg-bottom{left:12px;bottom:12px}.gg-stamina{width:77px;height:77px}.gg-stamina-inner{width:50px;height:50px}.gg-stamina-inner strong{font-size:18px}.gg-state{min-width:110px;font-size:10px;padding:6px}}",
].join('\n');

export class GameHud {
  private readonly root = document.createElement('div');
  private readonly styles = document.createElement('style');
  private readonly fill: HTMLElement;
  private readonly meterText: HTMLElement;
  private readonly tier: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly comboTitle: HTMLElement;
  private readonly comboInfo: HTMLElement;
  private readonly place: HTMLElement;
  private readonly stamina: HTMLElement;
  private readonly staminaNumber: HTMLElement;
  private readonly charge: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly build: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly debug: HTMLElement;

  constructor(host: HTMLElement) {
    this.styles.textContent = CSS;
    document.head.appendChild(this.styles);
    this.root.className = 'gg-ui';
    this.root.innerHTML =
      '<div class="gg-meter"><div class="gg-meter-head">' +
      '<span class="gg-logo">GIGGA-GOAT!</span><span class="gg-tier" data-tier>KID</span></div>' +
      '<div class="gg-meter-track"><div class="gg-meter-fill" data-fill></div><div class="gg-meter-ticks"></div></div>' +
      '<div class="gg-meter-caption"><span>CHAOS MAKES YOU BIGGER</span><span data-meter>0 / 100</span></div></div>' +
      '<div class="gg-combo" data-combo><div class="gg-combo-title" data-combo-title></div>' +
      '<div class="gg-combo-info" data-combo-info></div></div>' +
      '<div class="gg-place"><div class="gg-place-label">NOW CAUSING TROUBLE IN</div>' +
      '<div class="gg-place-name" data-place>HOOFINGTON</div></div>' +
      '<div class="gg-bottom"><div class="gg-stamina" data-stamina><div class="gg-stamina-inner">' +
      '<strong data-stamina-number>100</strong><span>STAMINA</span></div></div>' +
      '<div class="gg-state"><strong data-mode>FREE ROAM</strong><span>CHARGE</span>' +
      '<div class="gg-charge-track"><div class="gg-charge-bar" data-charge></div></div>' +
      '<div class="gg-build" data-build></div></div></div>' +
      '<div class="gg-help"><kbd>WASD</kbd> move · <kbd>SHIFT</kbd> sprint · <kbd>SPACE</kbd> jump / flip' +
      '<div><kbd>LMB</kbd> headbutt · <kbd>RMB</kbd> lick · <kbd>R</kbd> reel · <kbd>F</kbd> fling</div>' +
      '<div><kbd>E</kbd> bleat · <kbd>Q</kbd> flop · <kbd>B</kbd> build · <kbd>1–4</kbd> pieces · <kbd>F3</kbd> debug</div></div>' +
      '<div class="gg-hint" data-hint>CLICK TO PLAY · MOUSE TO LOOK</div>' +
      '<div class="gg-debug" data-debug hidden></div>';
    host.appendChild(this.root);
    const get = (name: string): HTMLElement => {
      const element = this.root.querySelector<HTMLElement>('[data-' + name + ']');
      if (!element) throw new Error('HUD element missing: ' + name);
      return element;
    };
    this.fill = get('fill'); this.meterText = get('meter'); this.tier = get('tier');
    this.combo = get('combo'); this.comboTitle = get('combo-title');
    this.comboInfo = get('combo-info'); this.place = get('place');
    this.stamina = get('stamina'); this.staminaNumber = get('stamina-number');
    this.charge = get('charge'); this.mode = get('mode'); this.build = get('build');
    this.hint = get('hint'); this.debug = get('debug');
  }

  update(game: Game, fps: number, stepMilliseconds: number, debugVisible: boolean,
    pointerLocked: boolean): void {
    const rules = game.rules, style = rules.style;
    const meter = Math.max(0, Math.min(100, style.meter));
    this.fill.style.width = meter.toFixed(2) + '%';
    this.meterText.textContent = Math.floor(meter) + ' / 100';
    this.tier.textContent = style.tier.toUpperCase();
    this.tier.style.background = style.tier === 'GIGGA' ? '#ffd833' :
      style.tier === 'Big' ? '#bf75ff' : style.tier === 'Billy' ? '#ff891e' : '#e9ce8a';
    const combo = style.combo;
    this.combo.style.opacity = combo.count ? '1' : '0';
    this.comboTitle.textContent = combo.title;
    this.comboInfo.textContent = '×' + combo.count + ' · +' + combo.points + ' COMBO · ' +
      style.score.toLocaleString() + ' TOTAL';
    this.place.textContent = game.location;
    const stamina = Math.max(0, Math.min(100, rules.abilities.stamina));
    this.stamina.style.background = 'conic-gradient(#ff891e ' + stamina + '%, #302945 ' + stamina + '%)';
    this.staminaNumber.textContent = Math.floor(stamina).toString();
    this.charge.style.width = Math.min(100, rules.abilities.headbuttCharge / 1.5 * 100) + '%';
    this.mode.textContent = game.buildMode ? 'HAY-BUILD' : game.goat.isRagdoll ? 'FLOP MODE' : 'FREE ROAM';
    this.build.style.display = game.buildMode ? 'block' : 'none';
    this.build.textContent = game.buildPiece.toUpperCase() + ' · ' + rules.inventory.get('hay') + ' HAY · ' +
      rules.inventory.get('wood') + ' WOOD · ' + rules.inventory.get('scrap') + ' SCRAP';
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
  }

  dispose(): void { this.root.remove(); this.styles.remove(); }
}
