/** Reproducible production Game/GameView capture. Requires local Chrome; no extra packages.
 * node scripts/capture-living-world.mjs --root . --out /absolute/output --label after
 * Samples completed GL frames, not a hardware FPS claim. Camera cuts are explicit.
 */
import { createServer } from 'vite';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = resolve(option('--root', '.'));
const out = resolve(option('--out', '.living-world-captures'));
const label = option('--label', 'capture');
const samples = Math.max(3, Math.floor(Number(option('--samples', '24'))));
const quality = option('--quality', 'high');
const seed = option('--seed', 'billy-isle');
const tourSeconds = Math.max(0, Math.min(120, Number(option('--tour', '0'))));
if (!Number.isFinite(samples) || !Number.isFinite(tourSeconds)) throw new Error('Samples and tour seconds must be finite numbers');
if (!['low', 'medium', 'high'].includes(quality)) throw new Error('Quality must be low, medium or high');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'gigga-living-world-'));
let browser, server, socket, fixtureDisposed = false, assetReadiness;
const errors = [], warnings = [], network = new Map();
const pending = new Map();
let sequence = 0;
async function until(read, seconds = 45, description = 'Capture') {
  const stop = Date.now() + seconds * 1000;
  while (Date.now() < stop) {
    const result = await read();
    if (result) return result;
    await delay(150);
  }
  throw new Error(description + ' timed out');
}
function send(method, params = {}, timeout = 90000) {
  return new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(method + ' timed out')); }, timeout);
    pending.set(id, { done: value => { clearTimeout(timer); done(value); },
      fail: error => { clearTimeout(timer); fail(error); } });
    try { socket.send(JSON.stringify({ id, method, params })); }
    catch (error) { pending.delete(id); clearTimeout(timer); fail(error); }
  });
}
async function evaluate(expression) {
  const answer = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
  return answer.result?.value;
}
try {
  server = await createServer({ root, configFile: join(root, 'vite.config.ts'),
    // The source is fixed during evidence collection. Neither captures nor the
    // baseline checkout should enter Vite's watcher or dependency HTML crawl.
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    optimizeDeps: { entries: ['index.html'] }, plugins: [{ name: 'living-world-evidence',
      configureServer(vite) { vite.middlewares.use('/__living-world-capture', (_, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><head><link rel="icon" href="data:,"><style>' +
          'html,body,#app{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}' +
          '</style></head><body><div id="app"></div></body></html>');
      }); },
    }] });
  await server.listen();
  const port = server.httpServer.address().port;
  const binary = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium'].find(candidate => {
    if (!candidate) return false;
    try { execFileSync(candidate, ['--version'], {stdio:'ignore'}); return true; } catch { return false; }
  });
  if (!binary) throw new Error('A working Chrome binary is required; set CHROME_PATH. No capture was produced.');
  browser = spawn(binary, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--enable-webgl', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0', '--window-size=1280,720', '--user-data-dir=' + profile,
    'http://127.0.0.1:' + port + '/__living-world-capture'], { stdio: ['ignore','ignore','pipe'] });
  let browserErrors = '';
  let browserStartError;
  browser.on('error', error => { browserStartError = error; });
  browser.stderr.on('data', bytes => { browserErrors = (browserErrors + bytes).slice(-4000); });
  const debugPort = await until(() => {
    if (browserStartError) throw browserStartError;
    if (browser.exitCode !== null) throw new Error(browserErrors);
    const file = join(profile, 'DevToolsActivePort');
    return existsSync(file) && Number(readFileSync(file, 'utf8').split('\n')[0]);
  });
  const target = await until(async () => {
    const tabs = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
    return tabs.find(tab => tab.type === 'page' && tab.url.includes('/__living-world-capture'))?.webSocketDebuggerUrl;
  });
  socket = new WebSocket(target);
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once:true });
    socket.addEventListener('error', fail, { once:true }); });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.fail(new Error('Chrome DevTools connection closed'));
    pending.clear();
  });
  socket.addEventListener('message', event => {
    const packet = JSON.parse(String(event.data));
    if (packet.id) {
      const request = pending.get(packet.id); pending.delete(packet.id);
      if (packet.error) request?.fail(new Error(packet.error.message)); else request?.done(packet.result);
    } else if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails);
    else if (packet.method === 'Runtime.consoleAPICalled' && packet.params.type === 'error')
      errors.push(packet.params.args.map(arg => arg.value ?? arg.description).join(' '));
    else if (packet.method === 'Runtime.consoleAPICalled' && packet.params.type === 'warning') {
      const warning = packet.params.args.map(arg => arg.value ?? arg.description).join(' ');
      warnings.push(warning);
      console.warn('Browser warning: ' + warning.slice(0, 800));
    }
    else if (packet.method === 'Network.requestWillBeSent') network.set(packet.params.requestId, packet.params.request.url);
    else if (packet.method === 'Network.loadingFinished') network.delete(packet.params.requestId);
    else if (packet.method === 'Network.loadingFailed') {
      errors.push({ url:network.get(packet.params.requestId), error:packet.params.errorText });
      network.delete(packet.params.requestId);
    } else if (packet.method === 'Network.responseReceived' && packet.params.response.status >= 400)
      errors.push({url:packet.params.response.url,status:packet.params.response.status});
  });
  await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width:1280,height:720,deviceScaleFactor:1,mobile:false });
  await until(async () => await evaluate('document.readyState!=="loading" && Boolean(document.querySelector("#app"))'));
  await evaluate(`(async()=>{
    const [{Game},{GameView},{createGameRenderer},{DEFAULT_SETTINGS},{heightAt},{ART_BOOKMARKS},
      {AudioEngine},{GameAudio},{BILLY_ISLE_RECORDINGS}]=await Promise.all([
      import('/src/core/Game.ts'),import('/src/core/GameView.ts'),import('/src/core/game-renderer.ts'),
      import('/src/core/Persistence.ts'),import('/src/world/index.ts'),import('/src/world/viewer/bookmarks.ts'),
      import('/src/audio/index.ts'),import('/src/core/GameAudio.ts'),import('/src/audio/soundtrack-assets.ts')]);
    const game=await Game.create({seed:${JSON.stringify(seed)}});
    const renderer=await createGameRenderer();
    const audio=new AudioEngine({seed:game.island.seed,recordedAssets:BILLY_ISLE_RECORDINGS});
    const audioUnlocked=await audio.unlock();
    if(${tourSeconds}>0&&!audioUnlocked)throw new Error('Audio did not unlock; refusing to claim an audio capture');
    const bridge=new GameAudio(game,audio);
    const view=new GameView(document.querySelector('#app'),game,renderer,bridge);
    renderer.setAnimationLoop(null); view.paused=true; view.titleCamera=false;
    view.applySettings({...DEFAULT_SETTINGS,graphics:${JSON.stringify(quality)}});
    // This fixture owns its camera and ticks. Production code is unmodified.
    const updateCamera=view.updateCamera.bind(view), updateCameraFraming=view.updateCameraFraming.bind(view);
    // Freezing the camera must not freeze the production light/shadow anchor
    // at spawn; the ordinary updateCamera method also performs this work.
    view.updateCamera=()=>{view.world.sun.position.setLength(145).add(view.cameraTarget);
      view.world.sun.target.position.copy(view.cameraTarget);view.world.sun.target.updateMatrixWorld();};
    view.updateCameraFraming=()=>{};
    document.querySelectorAll('.gg-hud').forEach(node=>node.remove());
    let timestamp=0;
    const render=(millis=100,finish=true)=>{timestamp+=millis; view.nextPausedRender=0; view.frame(timestamp);
      if(finish)renderer.getContext?.().finish();};
    const city=game.island.pois.find(p=>p.id==='downtown-bleatsville').center;
    const at=(x,z,up=2.1)=>({x:city.x+x,y:heightAt(game.island,city.x+x,city.z+z)+up,z:city.z+z});
    const points=[
      {id:'spawn',camera:{...view.camera.position},target:game.goat.torso.translation()},
      {id:'downtown-street',camera:at(7,40,2.2),target:at(8,-20,2)},
      {id:'downtown-fountain',camera:at(-11,-44,2.4),target:at(-21,-54,1.1)},
      {id:'downtown-market',camera:at(11,55,2.4),target:at(25,53,1.2)},
      {id:'downtown-rooftop',camera:at(-17,18,14),target:at(7,35,0)},
      ...ART_BOOKMARKS.filter(p=>p.district).map(p=>({...p,id:'approach-'+p.district}))];
    window.__livingCapture={game,view,renderer,audio,bridge,audioUnlocked,points,render,city,at,updateCamera,updateCameraFraming};
    for(let i=0;i<600;i++)game.advance(1/60,{});render();
    await Promise.all([view.residents?.ready,view.marketVisuals?.ready]);
    return {seed:game.island.seed,points:points.map(p=>p.id)};
  })()`);
  await until(() => network.size === 0, 120, 'Initial network requests');
  await delay(1000);
  let readinessReportedAt = 0;
  await until(async () => {
    assetReadiness = await evaluate(`(()=>{const c=window.__livingCapture,pending=[],groups=[];
      c.view.scene.traverse(o=>{if('ready' in o.userData||'libraryReady' in o.userData){
        groups.push({name:o.name,type:o.type,ready:o.userData.ready,libraryReady:o.userData.libraryReady,
          loadedModels:o.userData.loadedModels,failedAssets:o.userData.failedAssets,
          libraryLoaded:o.userData.libraryLoaded,libraryFailed:o.userData.libraryFailed,
          libraryPending:o.userData.libraryPending});
        if(o.userData.ready===false)pending.push(o.name||o.type);}});
      if(c.view.characters.player.isReady===false)pending.push('animated player goat');
      return {pending,groups,goatReady:c.view.characters.player.isReady,
        goatVariant:c.view.characters.player.variant,residents:c.view.residents?.stats?.()};})()`);
    if (assetReadiness.pending.length && Date.now() - readinessReportedAt > 15000) {
      readinessReportedAt = Date.now();
      console.log('Waiting for authored assets: ' + JSON.stringify(assetReadiness));
    }
    return assetReadiness.pending.length === 0;
  }, 120, 'Authored scene asset readiness');
  const snapshots = await evaluate('window.__livingCapture.points');
  const chosen = option('--points', '').split(',').filter(Boolean);
  const results = [];
  for (const point of snapshots.filter(p => !chosen.length || chosen.includes(p.id))) {
    await evaluate(`(()=>{const c=window.__livingCapture,p=${JSON.stringify(point)};
      c.view.camera.position.copy(p.camera);c.view.camera.fov=p.fov||62;c.view.camera.updateProjectionMatrix();
      c.view.cameraTarget.copy(p.target);
      c.view.camera.lookAt(p.target.x,p.target.y,p.target.z); c.render();return true;})()`);
    await until(() => network.size === 0, 120, 'Camera asset requests for ' + point.id);
    await delay(250);
    const measurement = await evaluate(`(()=>{const c=window.__livingCapture;
      for(let i=0;i<4;i++)c.render();const times=[];
      for(let i=0;i<${samples};i++){c.game.advance(1/60,{});const start=performance.now();c.render();times.push(performance.now()-start);}
      const gl=c.renderer.getContext?.(),ext=gl?.getExtension('WEBGL_debug_renderer_info');
      const sorted=[...times].sort((a,b)=>a-b),p=q=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))];
      return {times,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),drawCalls:c.renderer.info.render.calls,
        triangles:c.renderer.info.render.triangles,textures:c.renderer.info.memory.textures,
        geometries:c.renderer.info.memory.geometries,bodies:c.game.bodyCount,
        residents:c.game.life?.residents.length||0,residentStates:c.game.life?.residents.map(r=>({id:r.id,position:r.position,activity:r.activity})),
        pixelRatio:c.renderer.getPixelRatio(),width:c.renderer.domElement.width,height:c.renderer.domElement.height,
        gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'software',time:c.game.physics.time};})()`);
    const screenshot = await send('Page.captureScreenshot', { format:'jpeg',quality:88,fromSurface:true });
    writeFileSync(join(out, point.id+'.jpg'), Buffer.from(screenshot.data, 'base64'));
    results.push({id:point.id,camera:point.camera,target:point.target,...measurement});
    console.log(JSON.stringify({id:point.id,p50Ms:measurement.p50Ms,p95Ms:measurement.p95Ms,
      drawCalls:measurement.drawCalls,residents:measurement.residents}));
  }
  let tour;
  if (tourSeconds > 0) {
    console.log('Recording '+tourSeconds+' seconds of continuous gameplay with audio');
    await evaluate(`(()=>{const c=window.__livingCapture;
      if(!c.audio.audioContext||c.audio.audioContext.state!=='running'||!c.audio.limiter)
        throw new Error('Audio graph is not running for the requested recording');
      if(typeof MediaRecorder==='undefined'||typeof c.renderer.domElement.captureStream!=='function')
        throw new Error('This browser cannot record the gameplay canvas');
      const start=c.at(8,-42,0);c.game.teleport(start,Math.PI);
      c.view.updateCamera=c.updateCamera;c.view.updateCameraFraming=c.updateCameraFraming;
      c.view.alignCameraForPlay();c.view.camera.fov=c.view.currentSettings.fov;c.view.camera.updateProjectionMatrix();
      c.view.input.yaw=Math.PI;c.view.input.pitch=.12;
      for(let i=0;i<30;i++)c.game.advance(1/60,{});c.render(16,false);
      const stream=c.renderer.domElement.captureStream(15);
      const destination=c.audio.audioContext.createMediaStreamDestination();c.audio.limiter.connect(destination);
      for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
      const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')?'video/webm;codecs=vp9,opus':'video/webm';
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1600000});
      const chunks=[],frames=[],began=performance.now(),simulationBegan=c.game.physics.time,
        initialPosition={...c.game.goat.torso.translation()},reactionsBefore=c.game.life?.stats?.reactions||0;
      let last=began,index=0,bleated=false,bleatAt=null,droppedPhysicsSeconds=0,timer,cleaned=false;
      const reached=[];
      // Validated with actual Rapier controls and critical visible furniture:
      // pass left of the gig board, then north of the market planters.
      const route=[[8,-16],[6.2,-5],[6.2,8],[8,22],[8,44],[8,55.6],
        [14,55.6],[20,55.6],[14,55.6],[8,55.6],[8,40]];
      const cleanup=()=>{if(cleaned)return;cleaned=true;clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());
        try{c.audio.limiter.disconnect(destination);}catch{/* Engine disposal may already have disconnected it. */}};
      const fail=error=>{c.tourError=String(error?.message||error);cleanup();c.tourDone=true;};
      c.stopTour=()=>{c.tourError??='Recording cancelled during fixture teardown';clearTimeout(timer);
        if(recorder.state!=='inactive')recorder.stop();cleanup();};
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      c.tourDone=false;c.tourError=null;recorder.onerror=e=>fail(e.error||'MediaRecorder failed');
      recorder.onstop=async()=>{try{
        if(c.tourError)return;
        const bytes=new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer());
        if(!bytes.length)throw new Error('MediaRecorder returned no video');
        let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
        c.tour={base64:btoa(text),seconds:(performance.now()-began)/1000,
          simulatedSeconds:c.game.physics.time-simulationBegan,droppedPhysicsSeconds,frames,
          requestedCanvasFps:15,audio:destination.stream.getAudioTracks().length>0&&c.audio.status.unlocked,
          route,reachedWaypoints:reached,completedRoute:index>=route.length,
          initialPosition,finalPosition:{...c.game.goat.torso.translation()},bleatRequestedAt:bleatAt,
          residentReactions:(c.game.life?.stats?.reactions||0)-reactionsBefore,marketDisruptionRequested:false,
          kind:'Uncut scripted controller walk through the production Game/GameView; camera follows the real goat. Wall-clock loop intervals are not GPU or delivered-FPS measurements.'};
        cleanup();c.tourDone=true;
      }catch(error){fail(error);}};
      recorder.start(1000);
      const tick=()=>{try{const now=performance.now(),millis=now-last,dt=Math.max(0,millis/1000);frames.push(millis);last=now;
        const p=c.game.goat.torso.translation(),target=route[Math.min(index,route.length-1)],
          dx=c.city.x+target[0]-p.x,dz=c.city.z+target[1]-p.z,d=Math.hypot(dx,dz);
        const elapsed=(now-began)/1000;
        if(d<1.2&&index<route.length){reached.push({index,wallSeconds:elapsed,simulationSeconds:c.game.physics.time-simulationBegan});index++;}
        const idle=elapsed<8||elapsed>${Math.max(9,tourSeconds-12)}||index>=route.length;
        const yaw=Math.atan2(dx,-dz);c.view.input.yaw=yaw;c.view.input.pitch=.12;
        const bleat=!bleated&&elapsed>${Math.max(10,tourSeconds*.5)};if(bleat){bleated=true;bleatAt=elapsed;}
        const intent={moveX:0,moveZ:idle?0:.65,cameraYaw:yaw,climb:false,bleat};c.bridge.onInput(intent);
        droppedPhysicsSeconds+=c.game.advance(dt,intent).droppedSeconds;c.render(Math.max(1,millis),false);
        if(elapsed>=${tourSeconds})recorder.stop();else timer=setTimeout(tick,16);
      }catch(error){fail(error);}};tick();return true;})()`);
    await until(async () => {const status=await evaluate('({done:window.__livingCapture.tourDone,error:window.__livingCapture.tourError})');
      if(status.error)throw new Error(status.error);return status.done;}, tourSeconds + 45);
    tour = await evaluate('window.__livingCapture.tour');
    writeFileSync(join(out,'gameplay.webm'), Buffer.from(tour.base64,'base64'));
    delete tour.base64;
  }
  const meta = await evaluate('({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,audioUnlocked:window.__livingCapture.audioUnlocked})');
  const sha = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const dirty = execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();
  writeFileSync(join(out,'profile.json'),JSON.stringify({label,sha,dirty,seed,quality,date:new Date().toISOString(),
    measurement:'Synchronous production GameView frames with gl.finish; not delivered FPS or reference hardware acceptance.',
    os:platform()+' '+release(),cpu:cpus()[0]?.model,memoryBytes:totalmem(),...meta,results,tour,errors,warnings,assetReadiness},null,2)+'\n');
  await evaluate('window.__livingCapture.view.dispose();window.__livingCapture.bridge.dispose();window.__livingCapture.audio.dispose();window.__livingCapture.game.dispose();');
  fixtureDisposed = true;
  if(errors.length) { console.error('Capture recorded '+errors.length+' errors; inspect profile.json'); process.exitCode=1; }
} catch (error) {
  // Preserve the failed scene as evidence too. A ready flag can remain false
  // after a loader takes its warned-about fallback without a network error.
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      const screenshot = await send('Page.captureScreenshot', { format:'jpeg',quality:80,fromSurface:true }, 5000);
      writeFileSync(join(out, 'failure.jpg'), Buffer.from(screenshot.data, 'base64'));
    } catch { /* A crashed context may not expose a final frame. */ }
  }
  writeFileSync(join(out,'failure.json'),JSON.stringify({label,date:new Date().toISOString(),
    error:error instanceof Error?error.stack:String(error),errors,warnings,assetReadiness,
    pendingRequests:[...network.values()]},null,2)+'\n');
  throw error;
} finally {
  if (!fixtureDisposed && socket?.readyState === WebSocket.OPEN) {
    try { await send('Runtime.evaluate',{expression:'(()=>{const c=window.__livingCapture;if(!c)return;c.stopTour?.();c.view.dispose();c.bridge.dispose();c.audio.dispose();c.game.dispose();})()'},5000); }
    catch { /* A crashed page has no remaining accessible JS resources. */ }
  }
  socket?.close();
  for (const request of pending.values()) request.fail(new Error('Capture shutting down'));
  pending.clear();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const exited = new Promise(done => browser.once('exit',done));
    browser.kill();
    await Promise.race([exited,delay(3000)]);
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
  }
  await server?.close();
  rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
