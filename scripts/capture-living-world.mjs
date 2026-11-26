/** Reproducible production Game/GameView capture. Requires local Chrome; no extra packages.
 * node scripts/capture-living-world.mjs --root . --out /absolute/output --label after
 * Samples CPU submission work, not completed GPU frames or FPS. Camera cuts are explicit.
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
const allowLegacyGoat = args.includes('--allow-legacy-goat');
const softwareRenderer = args.includes('--software-renderer');
const tourSeconds = Math.max(0, Math.min(120, Number(option('--tour', '0'))));
const tourOnly = args.includes('--tour-only');
const tourQuality = option('--tour-quality', quality);
const tourWidth = Math.floor(Number(option('--tour-width', '1280')));
const tourHeight = Math.floor(Number(option('--tour-height', '720')));
const requireTourRoute = args.includes('--require-tour-route');
if (!Number.isFinite(samples) || !Number.isFinite(tourSeconds)) throw new Error('Samples and tour seconds must be finite numbers');
if (![quality, tourQuality].every(value => ['low', 'medium', 'high'].includes(value)))
  throw new Error('Quality and tour quality must be low, medium or high');
if (![tourWidth, tourHeight].every(value => Number.isFinite(value) && value >= 160 && value <= 3840))
  throw new Error('Tour viewport dimensions must be between 160 and 3840 CSS pixels');
if (requireTourRoute && tourSeconds === 0) throw new Error('A required route needs a recorded tour');
if (tourOnly && tourSeconds === 0) throw new Error('Tour-only capture needs a recorded tour');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'gigga-living-world-'));
let browser, server, socket, fixtureDisposed = false, assetReadiness;
const errors = [], warnings = [], network = new Map();
const pending = new Map();
// Keep CPU-only WebGL separate from Chromium's compositor. Using SwiftShader
// as the whole GL driver also exercises GPU-only compositor/readback paths on
// the CPU. Record this distinct configuration explicitly with the evidence.
const angleBackend = 'swiftshader-webgl';
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
    ...(softwareRenderer ? ['--disable-webgl', '--disable-webgl2'] :
      ['--enable-webgl', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=' + angleBackend]),
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
    if(${softwareRenderer}&&!renderer.isSoftwareRenderer)throw new Error('Production software fallback was not selected');
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
    const hud=[...document.querySelectorAll('.gg-ui')].map(node=>({node,display:node.style.display}));
    for(const entry of hud)entry.node.style.display='none';
    let timestamp=0;
    const render=(millis=100,finish=true)=>{timestamp+=millis; view.nextPausedRender=0; view.frame(timestamp);
      if(finish)renderer.getContext?.().finish();};
    const city=game.island.pois.find(p=>p.id==='downtown-bleatsville').center;
    const at=(x,z,up=2.1)=>({x:city.x+x,y:heightAt(game.island,city.x+x,city.z+z)+up,z:city.z+z});
    const points=[
      {id:'spawn',camera:{...view.camera.position},target:game.goat.torso.translation()},
      {id:'downtown-street',camera:at(7,40,2.2),target:at(8,-20,2)},
      {id:'downtown-fountain',camera:at(-7,-49,3.1),target:at(-21,-54,1.1)},
      {id:'downtown-cafe',camera:at(-6.8,-39.2,2.1),target:at(-11.7,-40,1.03)},
      {id:'downtown-market',camera:at(10,61,4.5),target:at(24,55,.8)},
      {id:'downtown-rooftop',camera:at(-17,18,14),target:at(7,35,0)},
      ...ART_BOOKMARKS.filter(p=>p.district).map(p=>({...p,id:'approach-'+p.district}))];
    window.__livingCapture={game,view,renderer,audio,bridge,audioUnlocked,points,render,city,at,updateCamera,updateCameraFraming,hud};
    for(let i=0;i<600;i++)game.advance(1/60,{});render();
    await Promise.all([view.residents?.ready,view.marketVisuals?.ready]);
    return {seed:game.island.seed,points:points.map(p=>p.id)};
  })()`);
  await until(() => network.size === 0, 120, 'Initial network requests');
  await delay(1000);
  let readinessReportedAt = 0;
  await until(async () => {
    assetReadiness = await evaluate(`(()=>{const c=window.__livingCapture,pending=[],groups=[],residents=c.view.residents?.stats?.();
      const frontage=c.view.scene.getObjectByName('downtown-shop-signs-and-displays');
      c.view.scene.traverse(o=>{if('ready' in o.userData||'libraryReady' in o.userData){
        groups.push({name:o.name,type:o.type,ready:o.userData.ready,libraryReady:o.userData.libraryReady,
          loadedModels:o.userData.loadedModels,failedAssets:o.userData.failedAssets,
          libraryLoaded:o.userData.libraryLoaded,libraryFailed:o.userData.libraryFailed,
          libraryPending:o.userData.libraryPending});
        if(o.userData.ready===false)pending.push(o.name||o.type);}});
      if(c.view.characters.player.isReady===false&&!${allowLegacyGoat})pending.push('animated player goat');
      if(residents&&(residents.loaded!==residents.logical||residents.failedModels.length))pending.push('authored resident rigs');
      return {pending,groups,goatReady:c.view.characters.player.isReady,
        goatVariant:c.view.characters.player.variant,residents,
        storefrontPanels:(frontage?.geometry.index?.count??0)/6};})()`);
    if (assetReadiness.residents?.failedModels.length)
      throw new Error('Required resident models failed: ' + assetReadiness.residents.failedModels.join(', '));
    if (assetReadiness.pending.length && Date.now() - readinessReportedAt > 15000) {
      readinessReportedAt = Date.now();
      console.log('Waiting for authored assets: ' + JSON.stringify(assetReadiness));
    }
    return assetReadiness.pending.length === 0;
  }, 120, 'Authored scene asset readiness');
  const snapshots = await evaluate('window.__livingCapture.points');
  const chosen = option('--points', '').split(',').filter(Boolean);
  const results = [];
  for (const point of (tourOnly ? [] : snapshots.filter(p => !chosen.length || chosen.includes(p.id)))) {
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
        residents:c.game.life?.residents.length||0,residentStates:c.game.life?.residents.map(r=>({id:r.id,position:r.position,activity:r.activity,seat:r.seat})),
        pixelRatio:c.renderer.getPixelRatio(),width:c.renderer.domElement.width,height:c.renderer.domElement.height,
        gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'software',time:c.game.physics.time};})()`);
    const screenshotStarted=performance.now();
    const screenshot = await send('Page.captureScreenshot', { format:'jpeg',quality:88,fromSurface:true });
    const screenshotWaitMs=performance.now()-screenshotStarted;
    writeFileSync(join(out, point.id+'.jpg'), Buffer.from(screenshot.data, 'base64'));
    results.push({id:point.id,camera:point.camera,target:point.target,...measurement,screenshotWaitMs});
    console.log(JSON.stringify({id:point.id,p50Ms:measurement.p50Ms,p95Ms:measurement.p95Ms,
      drawCalls:measurement.drawCalls,residents:measurement.residents}));
  }
  let tour;
  if (tourSeconds > 0) {
    console.log('Recording '+tourSeconds+' seconds of continuous gameplay with audio at '+tourQuality+
      ' quality in a '+tourWidth+'x'+tourHeight+' CSS viewport');
    // The matching stills stay at their requested quality and 1280x720. CI's
    // software GPU uses the ordinary Low preset and a smaller video viewport
    // so recording can keep up without changing the production physics clock.
    await send('Emulation.setDeviceMetricsOverride', {
      width:tourWidth,height:tourHeight,deviceScaleFactor:1,mobile:false });
    await evaluate(`(async()=>{const c=window.__livingCapture;
      const {LivingWorldTour,DOWNTOWN_TOUR_START}=await import('/src/core/living-world-tour.ts');
      if(!c.audio.audioContext||c.audio.audioContext.state!=='running'||!c.audio.limiter)
        throw new Error('Audio graph is not running for the requested recording');
      if(typeof MediaRecorder==='undefined'||typeof c.renderer.domElement.captureStream!=='function')
        throw new Error('This browser cannot record the gameplay canvas');
      if(document.hidden)throw new Error('The recording page is hidden');
      c.view.applySettings({...c.view.currentSettings,graphics:${JSON.stringify(tourQuality)}});
      const start=c.at(DOWNTOWN_TOUR_START[0],DOWNTOWN_TOUR_START[1],0);c.game.teleport(start,Math.PI);
      for(const entry of c.hud)entry.node.style.display=entry.display;
      c.view.updateCamera=c.updateCamera;c.view.updateCameraFraming=c.updateCameraFraming;
      c.view.alignCameraForPlay();c.view.camera.fov=c.view.currentSettings.fov;c.view.camera.updateProjectionMatrix();
      c.view.input.yaw=Math.PI;c.view.input.pitch=.12;
      for(let i=0;i<30;i++)c.game.advance(1/60,{});c.render(16,false);
      const phaseWork={},restore=[];
      const track=(owner,key,label)=>{if(!owner||typeof owner[key]!=='function')return;
        const original=owner[key];owner[key]=function(...args){
        const start=performance.now();try{return original.apply(this,args);}
        finally{phaseWork[label]=(phaseWork[label]||0)+performance.now()-start;}};
        restore.push(()=>{owner[key]=original;});};
      track(c.renderer,'render','rendererMs');track(c.view,'updateCamera','cameraMs');
      track(c.view,'updateHud','hudMs');track(c.bridge,'frame','audioMs');
      track(c.view.world,'update','worldMs');track(c.view.world,'updateCulling','cullingMs');
      track(c.view.residents,'update','residentsMs');track(c.view.characters,'update','charactersMs');
      const destination=c.audio.audioContext.createMediaStreamDestination();c.audio.limiter.connect(destination);
      const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')?'video/webm;codecs=vp8,opus':'video/webm';
      // Copy the completed production canvas into a CPU-backed recording
      // surface. The game's renderer, camera, assets and pixels are unchanged;
      // only MediaRecorder's readback surface differs. Measure this explicitly.
      const recordingCanvas=document.createElement('canvas');
      recordingCanvas.width=c.renderer.domElement.width;recordingCanvas.height=c.renderer.domElement.height;
      const recordingContext=recordingCanvas.getContext('2d',{alpha:false,willReadFrequently:true});
      if(!recordingContext)throw new Error('A CPU recording surface is unavailable');
      const copyFrame=()=>recordingContext.drawImage(c.renderer.domElement,0,0);
      const probes=[];
      for(const mode of ['timer-only','render-only','source-stream-idle','source-manual','cpu-copy-manual']){
        const capture=mode.includes('stream')||mode.includes('manual'),copy=mode==='cpu-copy-manual';
        if(copy)copyFrame();
        const probeStream=capture?(copy?recordingCanvas:c.renderer.domElement).captureStream(0):null;
        const track=probeStream?.getVideoTracks()[0];
        if(track&&typeof track.requestFrame!=='function')throw new Error('Explicit canvas frame requests are unavailable');
        if(probeStream)for(const audioTrack of destination.stream.getAudioTracks())probeStream.addTrack(audioTrack.clone());
        const probeRecorder=probeStream?new MediaRecorder(probeStream,{mimeType:mime,videoBitsPerSecond:1600000}):null;
        let bytes=0,requested=0,nextCapture=0,probeTicks=0;
        const probeBudget=Math.round(2/c.game.physics.fixedDt);
        if(probeRecorder)probeRecorder.ondataavailable=e=>{bytes+=e.data.size;};
        const ended=probeRecorder?new Promise((done,fail)=>{probeRecorder.onstop=done;probeRecorder.onerror=e=>fail(e.error);}):null;
        probeRecorder?.start();
        const began=performance.now(),intervals=[],work=[];let last=began;
        await new Promise((done,fail)=>{const tick=()=>{try{const now=performance.now(),millis=now-last;last=now;
          intervals.push(millis);const start=performance.now();
          if(mode!=='timer-only'){
            const due=Math.min(probeBudget,Math.floor((now-began)/1000/c.game.physics.fixedDt+1e-9));
            const ticks=Math.min(c.game.physics.maxSubsteps,Math.max(0,due-probeTicks));
            for(let i=0;i<ticks;i++){c.game.step();probeTicks++;}
            c.render(Math.max(1,millis),false);
          }
          let copyMs=0;
          if(mode.endsWith('manual')&&now>=nextCapture){const copyStart=performance.now();if(copy)copyFrame();
            copyMs=performance.now()-copyStart;track.requestFrame();requested++;nextCapture=now+1000/15;}
          work.push({totalMs:performance.now()-start,copyMs});
          if(now-began>=2000)done();else setTimeout(tick,16);
        }catch(error){fail(error);}};tick();});
        const seconds=(performance.now()-began)/1000;
        if(probeRecorder){probeRecorder.stop();await ended;probeStream.getTracks().forEach(track=>track.stop());}
        // The probes measure wall-clock work but must not leave a different
        // weather/rigid-body state or fractional tick remainder on each runner.
        const measuredTicks=probeTicks;
        if(mode!=='timer-only')while(probeTicks<probeBudget){c.game.step();probeTicks++;}
        probes.push({mode,seconds,intervals,work,requested,bytes,measuredTicks,
          paddingTicks:probeTicks-measuredTicks,simulationTicks:probeTicks,visibility:document.visibilityState});
      }
      c.game.teleport(start,Math.PI);c.view.alignCameraForPlay();
      for(let i=0;i<30;i++)c.game.advance(1/60,{});c.render(16,false);copyFrame();
      const stream=recordingCanvas.captureStream(0),videoTrack=stream.getVideoTracks()[0];
      if(!videoTrack||typeof videoTrack.requestFrame!=='function')throw new Error('Explicit canvas frame requests are unavailable');
      for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1600000});
      const chunks=[],frames=[],frameWork=[],began=performance.now(),simulationBegan=c.game.physics.time,
        initialPosition={...c.game.goat.torso.translation()},reactionsBefore=c.game.life?.stats?.reactions||0;
      let last=began,droppedPhysicsSeconds=0,timer,cleaned=false,nextCapture=began,requestedFrames=0;
      const driver=new LivingWorldTour(c.game,${tourSeconds});
      const cleanup=()=>{if(cleaned)return;cleaned=true;cancelAnimationFrame(timer);driver.dispose();stream.getTracks().forEach(t=>t.stop());
        for(const reset of restore)reset();
        try{c.audio.limiter.disconnect(destination);}catch{/* Engine disposal may already have disconnected it. */}};
      const fail=error=>{c.tourError=String(error?.message||error);cleanup();c.tourDone=true;};
      c.stopTour=()=>{c.tourError??='Recording cancelled during fixture teardown';cancelAnimationFrame(timer);
        if(recorder.state!=='inactive')recorder.stop();cleanup();};
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      c.tourDone=false;c.tourError=null;recorder.onerror=e=>fail(e.error||'MediaRecorder failed');
      recorder.onstop=async()=>{try{
        if(c.tourError)return;
        const bytes=new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer());
        if(!bytes.length)throw new Error('MediaRecorder returned no video');
        let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
        c.tour={base64:btoa(text),seconds:(performance.now()-began)/1000,
          simulatedSeconds:c.game.physics.time-simulationBegan,droppedPhysicsSeconds,frames,frameWork,
          quality:c.view.currentSettings.graphics,cssWidth:${tourWidth},cssHeight:${tourHeight},
          width:c.renderer.domElement.width,height:c.renderer.domElement.height,pixelRatio:c.renderer.getPixelRatio(),mime,
          captureSurface:'CPU-backed 2D copy of the completed production canvas',scheduler:'requestAnimationFrame render; fixed-tick input',
          softwareFrameLimit:c.renderer.isSoftwareRenderer?30:null,
          renderer:c.renderer.isSoftwareRenderer?'production software fallback':'WebGL',
          requestedFrames,probes,visibility:document.visibilityState,
          requestedCanvasFps:15,audio:destination.stream.getAudioTracks().length>0&&c.audio.status.unlocked,
          route:driver.steering.route,reachedWaypoints:driver.steering.reachedWaypoints,completedRoute:driver.completedRoute,
          routeTrace:driver.trace,recoveryAttempts:driver.steering.recoveries,routeFailure:driver.steering.failure,
          initialPosition,finalPosition:{...c.game.goat.torso.translation()},bleatRequestedAt:driver.steering.bleatWallAt,
          bleatSimulationAt:driver.steering.bleatSimulationAt,
          residentReactions:(c.game.life?.stats?.reactions||0)-reactionsBefore,marketDisruptionRequested:false,
          kind:'Uncut scripted controller walk through the production Game/GameView; camera follows the real goat. Wall-clock loop intervals are not GPU or delivered-FPS measurements.'};
        cleanup();c.tourDone=true;
      }catch(error){fail(error);}};
      recorder.start(1000);
      const tick=()=>{try{const now=performance.now(),millis=now-last;
        if(c.renderer.isSoftwareRenderer&&millis<1000/30-1){timer=requestAnimationFrame(tick);return;}
        const dt=Math.max(0,millis/1000);frames.push(millis);last=now;
        const elapsed=(now-began)/1000;
        const simulationStart=performance.now();
        const advance=driver.advanceFrame(dt,elapsed,intent=>{
          c.view.input.yaw=intent.cameraYaw;c.view.input.pitch=.12;c.bridge.onInput(intent);
        }),renderStart=performance.now();
        for(const name of Object.keys(phaseWork))phaseWork[name]=0;
        droppedPhysicsSeconds+=advance.droppedSeconds;c.render(Math.max(1,millis),false);
        const rendered=performance.now();let captureCopyMs=0;
        if(now>=nextCapture){const copyStart=performance.now();copyFrame();captureCopyMs=performance.now()-copyStart;
          videoTrack.requestFrame();requestedFrames++;nextCapture=now+1000/15;}
        frameWork.push({simulationMs:renderStart-simulationStart,renderSubmitMs:rendered-renderStart,captureCopyMs,
          ...phaseWork,steps:advance.steps,droppedSeconds:advance.droppedSeconds});
        if(elapsed>=${tourSeconds})recorder.stop();else timer=requestAnimationFrame(tick);
      }catch(error){fail(error);}};tick();return true;})()`);
    await until(async () => {const status=await evaluate('({done:window.__livingCapture.tourDone,error:window.__livingCapture.tourError})');
      if(status.error)throw new Error(status.error);return status.done;}, tourSeconds + 45);
    tour = await evaluate('window.__livingCapture.tour');
    writeFileSync(join(out,'gameplay.webm'), Buffer.from(tour.base64,'base64'));
    delete tour.base64;
  }
  const meta = await evaluate(`({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
    audioUnlocked:window.__livingCapture.audioUnlocked,
    renderer:window.__livingCapture.renderer.isSoftwareRenderer?'production software fallback':'WebGL',
    authoredGoatReady:window.__livingCapture.view.characters.player.isReady,
    goatRendering:window.__livingCapture.view.characters.player.isReady?'authored GLB':'legacy fallback',
    allowLegacyGoat:${allowLegacyGoat}})`);
  const sha = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const dirty = execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();
  writeFileSync(join(out,'profile.json'),JSON.stringify({label,sha,dirty,seed,quality,angleBackend,softwareRenderer,date:new Date().toISOString(),
    measurement:'CPU GameView submission with gl.finish (Chromium implements this as flush). Excludes GPU completion and presentation; not delivered FPS. Screenshot wait includes queued render/readback work.',
    hudPolicy:{fixedSceneScreenshots:'hidden',tourPage:tourSeconds>0?'production HUD restored':'not recorded',
      recordedVideo:'canvas stream only; DOM HUD is not composited'},
    os:platform()+' '+release(),cpu:cpus()[0]?.model,memoryBytes:totalmem(),...meta,results,tour,errors,warnings,assetReadiness},null,2)+'\n');
  await evaluate('window.__livingCapture.view.dispose();window.__livingCapture.bridge.dispose();window.__livingCapture.audio.dispose();window.__livingCapture.game.dispose();');
  fixtureDisposed = true;
  if(errors.length) { console.error('Capture recorded '+errors.length+' errors; inspect profile.json'); process.exitCode=1; }
  if(requireTourRoute&&!tour?.completedRoute) {
    console.error('The recorded tour reached '+(tour?.reachedWaypoints.length||0)+'/'+(tour?.route.length||0)+
      ' waypoints; inspect gameplay.webm and profile.json. An incomplete route is not accepted as a walkthrough.');
    console.error('Route diagnostic: '+JSON.stringify({failure:tour?.routeFailure,recoveries:tour?.recoveryAttempts,
      recentTrace:tour?.routeTrace?.slice(-5)}));
    process.exitCode=1;
  }
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
    error:error instanceof Error?error.stack:String(error),errors,warnings,assetReadiness,allowLegacyGoat,angleBackend,
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
