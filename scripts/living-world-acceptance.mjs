/** Local QA only. The real game owns its input, render loop, menus and physics. */
import { bootGame } from '../src/core/boot.ts';
import { summarize, classifyRenderer, createIntervalTracker } from './living-world-acceptance-metrics.mjs';

const status=document.querySelector('#qa');
const errors=[],warnings=[];
const record=(target,kind,value)=>{if(target.length<1000)target.push({kind,message:String(value)});};
window.addEventListener('error',e=>record(errors,'error',e.message||e.target?.src||e.type),true);
window.addEventListener('unhandledrejection',e=>record(errors,'unhandledrejection',e.reason));
for(const [name,target] of [['error',errors],['warn',warnings]]){
  const original=console[name];
  console[name]=function(...args){record(target,name,args.map(String).join(' '));original.apply(this,args);};
}
const identity=async()=>{
  const response=await fetch('/__living-world-qa-build',{cache:'no-store'});
  if(!response.ok)throw new Error('Cannot verify checkout identity; start npm run qa:living-world.');
  return response.json();
};
function download(name,value){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const MAX_FRAMES=250000;
try{
  const build=await identity();
  const {game,view,audio}=await bootGame(document.querySelector('#app'));
  const renderer=view.renderer;
  const software='isSoftwareRenderer' in renderer;
  const gl=software?null:renderer.getContext();
  const debug=gl?.getExtension('WEBGL_debug_renderer_info');
  const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
  const classification=classifyRenderer(software,gpu);
  const timer=gl?.getExtension('EXT_disjoint_timer_query_webgl2')??null;
  const tracker=createIntervalTracker();
  const originalRender=renderer.render;
  const originalAdvance=game.advance;
  let session=null,exporting=false,pending=null,physicsMs=0,droppedSeconds=0;
  let lastSample=-Infinity,wasPaused=false;
  const assetState=()=>{
    const groups=[];
    view.scene.traverse(o=>{
      if('ready' in o.userData||'libraryReady' in o.userData)
        groups.push({name:o.name||o.type,ready:o.userData.ready,libraryReady:o.userData.libraryReady,
          failedAssets:o.userData.failedAssets,libraryFailed:o.userData.libraryFailed,libraryPending:o.userData.libraryPending});
    });
    return {authoredGoat:view.characters.player.isReady,residents:view.residents?.stats?.(),groups};
  };
  const snapshot=()=>({position:{...game.goat.torso.translation()},simulationTime:game.physics.time,
    quality:view.currentSettings.graphics,viewport:[innerWidth,innerHeight],
    canvas:[renderer.domElement.width,renderer.domElement.height],pixelRatio:renderer.getPixelRatio(),
    drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
    textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,
    jsHeapBytes:performance.memory?.usedJSHeapSize??null,
    bodies:game.bodyCount,budgetBodies:game.budget.count,
    residents:game.life.stats,fruitBodies:game.market.activeBodies,marketSpilled:game.market.spilled,
    voices:audio.voiceTickets.length,audioUnlocked:audio.status.unlocked,
    teleportVersion:game.teleportVersion,ambientEnabled:game.ambientLifeEnabled});
  const elapsed=()=>performance.now()-session.start;
  const note=(kind,detail={})=>session?.events.push({ms:elapsed(),kind,...detail});
  const clearQuery=()=>{if(pending){gl.deleteQuery(pending.query);pending=null;}};
  // At most one outstanding query, every 30 frames. No synchronous GPU wait.
  // Browser/driver disjoint periods are retained as gaps, not fabricated zeroes.
  const pollQuery=()=>{
    if(!pending)return;
    if(gl.isContextLost()||gl.getParameter(timer.GPU_DISJOINT_EXT)){
      session.gpuDisjoint++;clearQuery();return;
    }
    if(gl.getQueryParameter(pending.query,gl.QUERY_RESULT_AVAILABLE)){
      session.gpuSamples.push({frame:pending.frame,ms:gl.getQueryParameter(pending.query,gl.QUERY_RESULT)/1e6});
      clearQuery();
    }
  };
  const finish=async(reason)=>{
    if(!session||exporting)return;
    const finished=session;
    exporting=true;
    const end=snapshot(),endAssets=assetState(),wallMs=elapsed();
    note('finish',{reason});
    if(pending){finished.gpuUnresolved++;clearQuery();}
    session=null;tracker.reset();
    try{
      let finalBuild=null,identityError=null;
      try{finalBuild=await identity();}catch(error){identityError=String(error);}
      const segments={};
      for(const frame of finished.frames){
        const key=frame.quality+' '+frame.width+'x'+frame.height+' @'+frame.pixelRatio;
        (segments[key]??=[]).push(frame);
      }
      const summaries=Object.fromEntries(Object.entries(segments).map(([key,frames])=>[key,{
        frameIntervals:summarize(frames.flatMap(f=>f.intervalMs===null?[]:[f.intervalMs])),
        cpuRenderSubmit:summarize(frames.map(f=>f.renderSubmitMs)),
        physics:summarize(frames.map(f=>f.physicsMs)),
        droppedPhysicsSeconds:frames.reduce((sum,f)=>sum+f.droppedSeconds,0)
      }]));
      const validIdentity=Boolean(finalBuild&&!build.initial.dirty&&!build.current.dirty&&!finished.build.current.dirty&&
        !finalBuild.initial.dirty&&!finalBuild.current.dirty&&
        [build.current,finished.build.initial,finished.build.current,finalBuild.initial,finalBuild.current]
          .every(i=>i.sha===build.initial.sha));
      download('living-world-'+build.initial.sha.slice(0,8)+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',{
        schema:1,kind:'local human-input QA diagnostics; not automatic acceptance',
        startedAt:finished.startedAt,build:finished.build,finalBuild,identityError,validIdentity,
        userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
        screen:{width:screen.width,height:screen.height,devicePixelRatio},
        renderer:{software,gpu,classification,gpuTimerSupported:Boolean(timer)},
        measurements:{
          intervals:'CPU monotonic render-start intervals during visible, unpaused production gameplay; not proven display presentation',
          cpuRenderSubmit:'CPU renderer.render wall duration; excludes asynchronous GPU completion',
          gpu:'Sparse asynchronous WebGL elapsed-time queries; disjoint or unfinished queries excluded and counted',
          jsHeap:'Optional Chromium JS heap estimate, not full GPU/process memory',
          acceptance:'Independent human judgment, physical-device verification, delivered-frame trace and separate gameplay video still required'
        },
        seed:game.island.seed,wallMs,finishReason:reason,initial:finished.initial,end,
        initialAssets:finished.initialAssets,endAssets,
        summaries,gpuSummary:summarize(finished.gpuSamples.map(s=>s.ms)),
        frames:finished.frames,gpuSamples:finished.gpuSamples,gpuDisjoint:finished.gpuDisjoint,
        gpuUnresolved:finished.gpuUnresolved,snapshots:finished.snapshots,events:finished.events,
        errors:[...errors],warnings:[...warnings]
      });
      status.textContent='Profile exported. N starts a new run. Keep the unedited video and presentation trace separately.';
    }catch(error){status.textContent='Export failed: '+String(error);console.error(error);}
    finally{exporting=false;}
  };
  game.advance=function(...args){
    if(!session)return originalAdvance.apply(this,args);
    const start=performance.now();
    try{
      const result=originalAdvance.apply(this,args);
      droppedSeconds+=result.droppedSeconds;
      return result;
    }finally{physicsMs+=performance.now()-start;}
  };
  renderer.render=function(...args){
    const active=session;
    if(!active)return originalRender.apply(this,args);
    if(view.paused||document.hidden){
      tracker.reset();physicsMs=0;droppedSeconds=0;
      if(!wasPaused){note('paused');wasPaused=true;}
      return originalRender.apply(this,args);
    }
    if(wasPaused){note('resumed');wasPaused=false;tracker.reset();}
    if(active.frames.length>=MAX_FRAMES){void finish('sample-cap');return originalRender.apply(this,args);}
    const start=performance.now(),quality=view.currentSettings.graphics;
    const {width,height}=renderer.domElement,pixelRatio=renderer.getPixelRatio();
    const intervalMs=tracker.sample(start,quality+':'+width+'x'+height+'@'+pixelRatio);
    if(timer&&!gl.isContextLost())pollQuery();
    let query=null;
    if(timer&&!pending&&!gl.isContextLost()&&active.frames.length%30===0){
      if(gl.getParameter(timer.GPU_DISJOINT_EXT))active.gpuDisjoint++;
      else{
        query=gl.createQuery();
        if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
      }
    }
    const submit=performance.now();
    try{return originalRender.apply(this,args);}
    finally{
      const renderSubmitMs=performance.now()-submit;
      if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);pending={query,frame:active.frames.length};}
      active.frames.push({ms:start-active.start,intervalMs,renderSubmitMs,physicsMs,droppedSeconds,
        quality,width,height,pixelRatio});
      physicsMs=0;droppedSeconds=0;
      if(start-lastSample>=1000){
        const current=snapshot();active.snapshots.push({ms:start-active.start,...current});
        lastSample=start;
        status.textContent='QA '+Math.floor((start-active.start)/1000)+'s · '+quality+' · N export · M mark ('+classification+')';
      }
    }
  };
  document.addEventListener('visibilitychange',()=>{
    tracker.reset();physicsMs=0;droppedSeconds=0;
    note(document.hidden?'hidden':'visible');
  });
  renderer.domElement.addEventListener('webglcontextlost',()=>{note('webgl-context-lost');record(errors,'webgl','Context lost');});
  game.goat.events.on(event=>{
    if(session&&event.type==='knockedBody')note('goat-event',{type:event.type});
  });
  game.market.listeners.add(position=>note('market-spill',{position:{...position}}));
  async function start(){
    if(exporting||session||view.paused||document.hidden)return;
    exporting=true;
    try{
      const current=await identity();
      if(view.paused||document.hidden)return;
      tracker.reset();physicsMs=0;droppedSeconds=0;lastSample=-Infinity;wasPaused=false;
      session={start:performance.now(),startedAt:new Date().toISOString(),build:current,
        initial:snapshot(),initialAssets:assetState(),frames:[],snapshots:[],events:[],
        gpuSamples:[],gpuDisjoint:0,gpuUnresolved:0,markers:0};
      note('start');
      status.textContent='QA recording · N export · M rooftop idle / revisit markers';
    }catch(error){status.textContent='Cannot start: '+String(error);}
    finally{exporting=false;}
  }
  window.addEventListener('keydown',event=>{
    if(event.repeat||!event.isTrusted||event.ctrlKey||event.altKey||event.metaKey||
      event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement)return;
    if(event.code==='KeyN'){
      event.preventDefault();
      if(session)void finish('manual');else void start();
    }else if(event.code==='KeyM'&&session&&!view.paused){
      event.preventDefault();
      const label=['rooftop-idle-observed','market-revisit-observed'][session.markers]??'additional-manual-marker';
      session.markers++;note('reviewer-marker',{label,position:{...game.goat.torso.translation()}});
    }
  });
  status.textContent='Enter Free Roam, warm up and choose quality. N starts/export; M marks rooftop idle then market revisit. '+classification;
}catch(error){status.textContent='QA unavailable: '+String(error);console.error(error);}
