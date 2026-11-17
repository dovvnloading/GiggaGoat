import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

// Temporary browser QA harness. Remove this file after reviewing the screenshots.
describe('temporary live HUD visual QA', () => {
  it('paints real sprite DOM and live HTML in headless Chrome at all target sizes', async () => {
    const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium'].find(existsSync);
    if (!chrome) { console.log('HUD_QA_BROWSER_UNAVAILABLE'); return; }
    const preview = join(process.cwd(), 'src/core/__hud_visual.html');
    const dir = mkdtempSync(join(tmpdir(), 'gigga-hud-'));
    let server: ViteDevServer | undefined;
    try {
      const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden}
#app{position:fixed;inset:0;background:linear-gradient(#328ceb 0%,#85d7ff 44%,#82bc5a 44%,#a0dd62 100%);overflow:hidden}
.hill{position:absolute;left:-15%;right:-15%;top:30%;height:24%;border-radius:50% 50% 0 0;background:linear-gradient(#558a57,#6ca85c)}
.road{position:absolute;left:14%;right:14%;top:39%;bottom:-10%;clip-path:polygon(48% 0,52% 0,100% 100%,0 100%);background:linear-gradient(#706377,#978799)}
.goat{position:absolute;left:46%;bottom:23%;width:9%;height:18%;border:9px solid #b99a71;border-radius:47% 47% 36% 36%;background:#f5e1ad;box-shadow:0 0 0 3px #fff4d2}
</style></head><body><main id="app"><div class="hill"></div><div class="road"></div><div class="goat"></div></main>
<script type="module">
import { GameHud } from '/src/core/GameHud.ts';
import { HUD_SPRITES, hudSpriteUrl } from '/src/core/HudSprites.ts';
const hud=new GameHud(document.querySelector('#app'));
const q=(s)=>document.querySelector(s);
q('[data-combo-title]').textContent='BARNSTORM BONANZA!';
q('[data-combo-count]').textContent='×12\\nCOMBO!';
q('[data-score]').textContent='48,750';
q('[data-place]').textContent='HOOFINGTON';
q('[data-gig-title]').textContent='CURRENT OBJECTIVE';
q('[data-gig-task]').textContent='Build a hay ramp to the Windmill Plaza.';
q('[data-gig-detail]').textContent='0 / 1 RAMPS · 90s LEFT';
q('[data-wallet]').textContent='75 CUD COINS';
q('[data-stamina-number]').textContent='73 / 100';
q('[data-stamina]').style.setProperty('--gg-stamina','73%');
q('[data-fill]').style.width='85%';q('[data-needle]').style.left='85%';
q('[data-tier]').textContent='GIGGA';q('[data-meter]').textContent='85 / 100';
for(const e of document.querySelectorAll('[data-stage],[data-stage-label]')) {
  e.classList.toggle('is-active',e.dataset.stage==='GIGGA'||e.dataset.stageLabel==='GIGGA');
}
document.querySelectorAll('[data-quantity]').forEach((n,i)=>{n.textContent='×'+[18,24,7,5][i];});
q('[data-supply]').textContent='×9';
q('[data-slot="floor"]').classList.add('is-selected');
q('[data-hint]').hidden=true;
const pin=(name,x,y,w=29,h=29)=>'<image href="'+hudSpriteUrl(name)+'" x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'"/>';
const map=q('[data-map]');
map.innerHTML='<rect width="280" height="280" fill="#8dd36a"/><path d="M0 100H280 M125 0V280" stroke="#e9db9c" stroke-width="22"/><path d="M0 100H280 M125 0V280" stroke="#b7a47e" stroke-width="16"/>'+
  pin(HUD_SPRITES.markerBarn,48,115,49,40)+pin(HUD_SPRITES.markerHouseBlue,178,135,42,40)+
  pin(HUD_SPRITES.markerHousePink,37,186,43,40)+pin(HUD_SPRITES.markerTreeRound,210,50)+
  pin(HUD_SPRITES.markerTreePine,232,196)+pin(HUD_SPRITES.markerTreeApple,24,36)+
  pin(HUD_SPRITES.mapPin,127,36,23,31)+'<path d="M130 180l17 30-17-6-17 6z" fill="#fda132" stroke="#fff5c5" stroke-width="4"/>';
document.documentElement.dataset.ready='yes';
</script></body></html>`;
      writeFileSync(preview, html);
      server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('Vite QA server failed');
      const url = 'http://127.0.0.1:' + address.port + '/src/core/__hud_visual.html';
      for (const [w, h] of [[1280,720],[1600,900],[1920,1080]]) {
        const filepath = join(dir, 'hud-' + w + '.png');
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu',
            '--disable-dev-shm-usage', '--hide-scrollbars', '--window-size='+w+','+h,
            '--virtual-time-budget=5000', '--screenshot='+filepath, url],
            { stdio: ['ignore', 'ignore', 'pipe'] });
          let error = '';
          proc.stderr.on('data', data => { error += String(data).slice(-1000); });
          proc.on('error', reject);
          proc.on('close', code => code === 0 ? resolve() : reject(new Error('Chrome '+code+' '+error)));
        });
        if (!existsSync(filepath)) throw new Error('Screenshot missing: '+filepath);
        const b64 = readFileSync(filepath).toString('base64');
        for(let i=0;i<b64.length;i+=4000) {
          console.log('HUD_QA_'+w+'_PART_'+(i/4000)+':'+b64.slice(i,i+4000));
        }
      }
    } finally {
      await server?.close();
      rmSync(preview, {force:true});
      rmSync(dir, {recursive:true,force:true});
    }
  }, 120000);
});
