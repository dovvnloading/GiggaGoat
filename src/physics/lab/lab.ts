/**
 * Dev-only physics lab. Visit /src/physics/lab/index.html on the Vite dev server.
 * Does not import any core/gameplay/world lane or ship in the root production build.
 */
import * as THREE from 'three';
import { RAPIER, PhysicsWorld, GoatRagdoll, GOAT_SIZES, V, clamp } from '../index';
import type { GoatSize } from '../index';

if (!import.meta.env.DEV) throw new Error('Physics lab is only available through Vite dev.');

const physics = await PhysicsWorld.create({ maxSubsteps: 6 });
physics.createGround(V(80,.5,80));
for (let i = 0; i < 11; i++) {
  const x = (i % 4 - 1.5) * 2.6;
  const z = -5 - Math.floor(i / 4)*2.7;
  physics.createBox(V(x,.56,z),V(.47,.47,.47),4+i*2);
}
const wall = physics.raw.createRigidBody(
  RAPIER.RigidBodyDesc.fixed().setTranslation(5,2,-3.8));
physics.raw.createCollider(RAPIER.ColliderDesc.cuboid(2.2,2.9,.4)
  .setCollisionGroups(0x0001ffff),wall);
physics.registerBody(wall,{kind:'terrain'});

const goat = new GoatRagdoll(physics,{ position: V(0,0,4), id: 'lab-goat' });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x172b39);
scene.fog = new THREE.Fog(0x172b39,25,90);
const camera = new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.05,180);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
document.body.prepend(renderer.domElement);
const grid = new THREE.GridHelper(120,120,0x657b7e,0x2f4b50);
grid.position.y = .015;
scene.add(grid);
const axes = new THREE.AxesHelper(2);
axes.position.set(-5,.08,4);
scene.add(axes);
const wireMaterial = new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.95});
const wireLines = new THREE.LineSegments(new THREE.BufferGeometry(),wireMaterial);
scene.add(wireLines);
const noseMarker = new THREE.Mesh(
  new THREE.SphereGeometry(.12,12,8),
  new THREE.MeshBasicMaterial({color:0xffc869,depthTest:false}));
noseMarker.renderOrder = 10;
scene.add(noseMarker);

const sliders = document.getElementById('sliders')!;
const stats = document.getElementById('stats')!;
const eventPanel = document.getElementById('events')!;
const history: string[] = [];
goat.events.on(e=>{
  const note = e.type==='impact' ? ' '+e.impulse.toFixed(1)+' N·s' :
    e.type==='knockedBody' ? ' '+e.mass.toFixed(1)+' kg @ '+e.speed.toFixed(1)+' m/s' : '';
  history.unshift(physics.time.toFixed(2)+'  '+e.type+note);
  history.length = Math.min(history.length,8);
});

function slider(name:string,min:number,max:number,step:number,
  initial:number,onChange:(n:number)=>void):void {
  const label = document.createElement('label');
  const title = document.createElement('span');
  title.textContent=name;
  const output = document.createElement('output');
  output.textContent=initial.toFixed(step<.1?2:1);
  const control = document.createElement('input');
  control.type='range'; control.min=String(min); control.max=String(max);
  control.step=String(step); control.value=String(initial);
  control.addEventListener('input',()=>{
    const value=Number(control.value);
    output.textContent=value.toFixed(step<.1?2:1);
    onChange(value);
  });
  label.append(title,output,control);
  sliders.append(label);
}
slider('Hip motor stiffness',0,450,5,goat.motors.stiffness,v=>{goat.motors.stiffness=v;});
slider('Hip motor damping',0,60,1,goat.motors.damping,v=>{goat.motors.damping=v;});
slider('Upright stiffness',0,95,1,goat.balance.tuning.uprightStiffness,v=>{goat.balance.tuning.uprightStiffness=v;});
slider('Ride height',.55,1.6,.01,goat.balance.tuning.rideHeight,v=>{goat.balance.tuning.rideHeight=v;});
slider('Ride spring',0,110,1,goat.balance.tuning.rideStiffness,v=>{goat.balance.tuning.rideStiffness=v;});
slider('Walk speed',.5,12,.1,goat.locomotion.tuning.walkSpeed,v=>{goat.locomotion.tuning.walkSpeed=v;});
slider('Jump height',.3,4,.1,goat.locomotion.tuning.jumpHeight,v=>{goat.locomotion.tuning.jumpHeight=v;});
slider('Impact threshold',.3,8,.1,goat.balance.tuning.impactThreshold,v=>{goat.balance.tuning.impactThreshold=v;});
slider('Tongue spring',0,800,5,goat.interactions.tuning.tongueSpring,v=>{goat.interactions.tuning.tongueSpring=v;});
slider('Tongue break force',40,1300,10,goat.interactions.tuning.tongueBreakForce,v=>{goat.interactions.tuning.tongueBreakForce=v;});

const held = new Set<string>();
let cameraYaw=0, pitch=.2;
let headbuttDown:number|null=null;
renderer.domElement.addEventListener('click',()=>{
  if (document.pointerLockElement!==renderer.domElement) void renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('mousemove',e=>{
  if(document.pointerLockElement!==renderer.domElement)return;
  cameraYaw-=e.movementX*.0024;
  pitch=clamp(pitch-e.movementY*.002, -.7,1.1);
});
window.addEventListener('keydown',e=>{
  if (e.repeat) return;
  if (['Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
  held.add(e.code);
  if (e.code==='Space') goat.locomotion.requestJump();
  if (e.code==='KeyQ') goat.flop();
  if (e.code==='KeyE') goat.interactions.bleat();
  if (['Digit1','Digit2','Digit3','Digit4'].includes(e.code)) {
    const index=Number(e.code.slice(-1))-1;
    const size=GOAT_SIZES[index] as GoatSize | undefined;
    if(size)goat.resize(size);
  }
});
window.addEventListener('keyup',e=>held.delete(e.code));
window.addEventListener('blur',()=>held.clear());
window.addEventListener('mousedown',e=>{
  if (e.button===0) headbuttDown=performance.now();
  if (e.button===2) goat.interactions.attachTongue();
});
window.addEventListener('mouseup',e=>{
  if (e.button===0 && headbuttDown!==null) {
    goat.interactions.headbutt(clamp((performance.now()-headbuttDown)/1100,0,1));
    headbuttDown=null;
  }
  if (e.button===2) goat.interactions.detachTongue();
});
window.addEventListener('wheel',e=>{
  if (goat.interactions.isTongueAttached) goat.interactions.reel(Math.sign(e.deltaY)*.28*goat.size);
},{passive:true});
window.addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

let last=performance.now(),displayTime=0;
function frame(now:number):void {
  requestAnimationFrame(frame);
  const dt=Math.min(.09,(now-last)/1000);
  last=now;
  const moveX=Number(held.has('KeyD'))-Number(held.has('KeyA'));
  const moveZ=Number(held.has('KeyW'))-Number(held.has('KeyS'));
  goat.locomotion.setInput({
    x:moveX,z:moveZ,cameraYaw,sprint:held.has('ShiftLeft')||held.has('ShiftRight'),
  });
  goat.interactions.setReel(Number(held.has('KeyF'))-Number(held.has('KeyR')));
  const result=physics.step(dt);
  const torso=physics.getInterpolatedTransform(goat.torso,result.alpha);
  const head=physics.getInterpolatedTransform(goat.head,result.alpha);
  const distance=5.5*goat.size**.55;
  const eyeHeight=2.2*goat.size**.5;
  const behind = new THREE.Vector3(-Math.sin(cameraYaw)*distance*Math.cos(pitch),
    Math.sin(pitch)*distance+eyeHeight,Math.cos(cameraYaw)*distance*Math.cos(pitch));
  const target=new THREE.Vector3(torso.translation.x,torso.translation.y+.1*goat.size,torso.translation.z);
  camera.position.copy(target).add(behind);
  camera.lookAt(target);
  noseMarker.scale.setScalar(goat.size);
  noseMarker.position.set(head.translation.x,head.translation.y,head.translation.z);
  const debug=physics.raw.debugRender();
  wireLines.geometry.dispose();
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.BufferAttribute(debug.vertices,3));
  geom.setAttribute('color',new THREE.BufferAttribute(debug.colors,4));
  wireLines.geometry=geom;
  displayTime+=dt;
  if(displayTime>.13) {
    displayTime=0;
    stats.textContent =
      'Scale '+goat.size+'×  |  Balance '+goat.balanceValue.toFixed(2)+'\n'+
      'Pose '+goat.pose+'  |  '+(goat.grounded?'':'')+
      (goat.locomotion.grounded?'Grounded':goat.locomotion.isClinging?'Wall cling':'Airborne')+
      '  |  '+(goat.isRagdoll?'RAGDOLL':'Active')+'\n'+
      'Tongue '+(goat.interactions.tongueLength?.toFixed(2)??'off')+
      ' m  |  Rapier steps '+physics.stepCount+'\n'+
      'Substeps '+result.steps+'  |  alpha '+result.alpha.toFixed(2);
    eventPanel.textContent=history.join('\n')||'Try a headbutt, jump or flop.';
  }
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
