/** Visit /src/chaos/lab/index.html on the Vite dev server. This is not a production entry. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { PhysicsWorld, RAPIER, V } from '../../physics';
import type { Vec3 } from '../../physics';
import { BreakableRegistry, ChainReactions, DynamicBodyBudget, SurfaceSystem,
  WaterSystem, applyPhysicsMaterial } from '../index';
import { colliderHalfExtents } from '../internal';

if (!import.meta.env.DEV) throw new Error('Chaos lab runs only under Vite dev.');

const world = await PhysicsWorld.create({maxSubsteps:5});
const budget = new DynamicBodyBudget(world,250,18);
const water = new WaterSystem(world,{seaLevel:-1});
const breakables = new BreakableRegistry(world,{maxDebris:72,debrisLifetime:20,bodyBudget:budget});
const chains = new ChainReactions(world);
const surfaces = new SurfaceSystem(world);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ac5dd);
scene.fog = new THREE.Fog(0x8ac5dd,35,110);
const camera = new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.08,200);
camera.position.set(26,19,28);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const controls = new OrbitControls(camera,renderer.domElement);
controls.target.set(0,0,0);
controls.enableDamping=true;
controls.maxPolarAngle=Math.PI*.48;
controls.minDistance=6;
controls.maxDistance=90;
controls.update();
scene.add(new THREE.HemisphereLight(0xffffff,0x4b7083,2.4));
const sunlight = new THREE.DirectionalLight(0xfff4d9,2.8);
sunlight.position.set(-10,24,15);
sunlight.castShadow=true;
sunlight.shadow.mapSize.set(2048,2048);
sunlight.shadow.camera.left=-38; sunlight.shadow.camera.right=38;
sunlight.shadow.camera.top=38; sunlight.shadow.camera.bottom=-38;
scene.add(sunlight);
const grid = new THREE.GridHelper(60,60,0x89b59a,0x56937f);
grid.position.y=-2.45;
scene.add(grid);

type Mesh = THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>;
const meshes = new Map<number,Mesh>();
const transientMaterials = new Map<number,number>();
const makeMaterial = (color:number,opacity=1):THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({color,roughness:.78,metalness:.02,
    transparent:opacity<1,opacity,depthWrite:opacity===1});
function visualBox(position:Vec3,half:Vec3,color:number,opacity=1):Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(half.x*2,half.y*2,half.z*2),
    makeMaterial(color,opacity));
  mesh.position.set(position.x,position.y,position.z);
  mesh.castShadow=opacity===1; mesh.receiveShadow=true;
  scene.add(mesh);
  return mesh;
}
function showBody(body:RigidBody,color:number):Mesh {
  const h=colliderHalfExtents(body.collider(0)),p=body.translation();
  const mesh=visualBox(p,h,color);
  mesh.userData.bodyHandle=body.handle;
  meshes.set(body.handle,mesh);
  return mesh;
}
function fixedBox(position:Vec3,half:Vec3,color:number,
  material:'wood'|'rock'|'grass'='wood'):void {
  const body=world.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(
    position.x,position.y,position.z));
  const collider=world.raw.createCollider(RAPIER.ColliderDesc.cuboid(
    half.x,half.y,half.z),body);
  applyPhysicsMaterial(collider,material);
  visualBox(position,half,color);
}
// A lower beach level and elevated platforms leave room for a usable pool.
fixedBox(V(0,-2.7,0),V(30,.3,24),0x7aa97a,'grass');
fixedBox(V(6,-.5,0),V(8,.25,8),0x94b77b,'grass');
fixedBox(V(-2,-.5,5),V(7,.25,2.4),0x8ba77c,'grass');
fixedBox(V(-11,-2.3,-5),V(4,.25,4),0x64828d,'rock');
for (const side of [-1,1]) {
  fixedBox(V(-11+side*4,-1,-5),V(.2,1.55,4.2),0x778e99,'rock');
  fixedBox(V(-11,-1,-5+side*4),V(4.2,1.55,.2),0x778e99,'rock');
}
const poolId=water.addVolume({id:'pool',center:V(-11,-.9,-5),halfExtents:V(3.85,1.35,3.85),
  flow:V(.3,0,.1)});
const poolWater=visualBox(V(-11,-.9,-5),V(3.85,1.35,3.85),0x1f98df,.3);
poolWater.material.depthWrite=false;
for (let i=0;i<4;i++) {
  const b=world.createBox(V(-13+i*1.3,.2,-5),V(.42,.42,.42),i===3?1800:160);
  water.track(b);
  showBody(b,i===3?0x667388:0xf6d985);
}
// A wobbly goat-sized floating proxy that paddles around the pool.
const swimmer=world.createBox(V(-11,.6,-6),V(.65,.4,.38),110);
water.track(swimmer,{paddleSpeed:1.25});
water.setPaddle(swimmer,V(.5,0,.4));
showBody(swimmer,0xffffff);
// Three stacks of breakable crates with actual rigid-body fragments.
for (let x=0;x<3;x++) for (let y=0;y<3;y++) for (let z=0;z<2;z++) {
  const p=V(2.5+x*.9,-.04+y*.86, -3+z*.92);
  const body=world.createBox(p,V(.4,.4,.4),6);
  breakables.register(body,{impulseThreshold:5,damageThreshold:12,chunks:6,burstImpulse:8});
  showBody(body,0xf5b746);
}
// A domino run on an elevated green platform.
for (let i=0;i<10;i++) {
  const body=world.createBox(V(-7.3+i*.82,.4,5),V(.13,.65,.25),2.6);
  chains.registerDomino(body,{neighbourRadius:1.05,neighbourKickSpeed:2.4});
  showBody(body,0xe78abf);
}
// A soda crate surrounded by loose bottles.
const soda=world.createBox(V(9,-.02,3),V(.48,.48,.48),9);
chains.registerSoda(soda,{impactThreshold:9,radius:4,shoveImpulse:40});
showBody(soda,0xff6498);
for(let i=0;i<6;i++) {
  const angle=i*Math.PI/3;
  const bottle=world.createBox(V(9+Math.cos(angle)*1.8,.1,3+Math.sin(angle)*1.8),
    V(.19,.55,.19),3);
  showBody(bottle,0x88e7ff);
}
// Pads are real fixed colliders with sensor skins (only visual mesh added here).
surfaces.createTrampoline({position:V(11,-.18,-5),halfExtents:V(1.7,.2,1.7),
  bounceSpeed:11,cooldownSeconds:.65});
visualBox(V(11,-.18,-5),V(1.7,.2,1.7),0x69efa8);
surfaces.createLaunchPad({position:V(16,-.18,-5),halfExtents:V(1.6,.2,1.6),
  direction:V(-.6,1,.25),launchSpeed:13,cooldownSeconds:1});
visualBox(V(16,-.18,-5),V(1.6,.2,1.6),0xff9659);
surfaces.createConveyor({position:V(15,-.2,2),halfExtents:V(2,.25,1.3),
  direction:V(0,0,1),speed:3,acceleration:20});
visualBox(V(15,-.2,2),V(2,.25,1.3),0xab8af0);
for (let i=0;i<3;i++) {
  const body=world.createBox(V(15,.65,1+i*.4),V(.3,.3,.3),5);
  showBody(body,0xd1c1ff);
}
const seaMesh=new THREE.Mesh(new THREE.PlaneGeometry(80,80),
  new THREE.MeshPhongMaterial({color:0x3fa5ec,transparent:true,opacity:.31,
    depthWrite:false,side:THREE.DoubleSide,shininess:80}));
seaMesh.rotation.x=-Math.PI/2;
seaMesh.position.y=water.seaLevel;
scene.add(seaMesh);
const history:string[]=[];
function note(message:string):void {
  history.unshift(world.time.toFixed(2)+'  '+message);
  history.length=Math.min(7,history.length);
}
water.events.on(e=>{if(e.type==='splash') note('SPLASH '+e.mass.toFixed(1)+'kg @ '+e.impactSpeed.toFixed(1)+'m/s');});
breakables.events.on(e=>{
  note('BREAK '+e.mass.toFixed(1)+'kg / '+e.debrisHandles.length+' pieces');
  for(const handle of e.debrisHandles) {
    const chunk=world.raw.getRigidBody(handle);
    if(chunk?.isValid()) { showBody(chunk,0xf3c485); transientMaterials.set(handle,0xf3c485); }
  }
});
chains.events.on(e=>{
  if(e.type==='topple') note('DOMINO '+e.bodyHandle+' fell');
  if(e.type==='sodaPop') note('FIZZ POP / '+e.affectedHandles.length+' props shoved');
});
surfaces.events.on(e=>{
  if(e.type==='bounce'||e.type==='launch') note(e.type.toUpperCase()+' / body '+e.bodyHandle);
});
const seaSlider=document.querySelector<HTMLInputElement>('#sea')!;
const seaValue=document.querySelector<HTMLOutputElement>('#sea-value')!;
seaSlider.addEventListener('input',()=>{
  const height=Number(seaSlider.value);
  water.setSeaLevel(height);
  seaValue.textContent=height.toFixed(1)+' m';
  seaMesh.position.y=height;
});
const powerSlider=document.querySelector<HTMLInputElement>('#power')!;
const powerValue=document.querySelector<HTMLOutputElement>('#power-value')!;
powerSlider.addEventListener('input',()=>{powerValue.textContent=powerSlider.value;});
document.querySelector<HTMLButtonElement>('#reset')!.addEventListener('click',()=>location.reload());
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown',event=>{
  if(event.button!==0) return;
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX-rect.left)/rect.width*2-1,
    -(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const target=raycaster.intersectObjects([...meshes.values()],false)[0];
  if(!target) return;
  const handle=Number(target.object.userData.bodyHandle);
  const body=world.raw.getRigidBody(handle);
  if(!body || !body.isValid() || !body.isDynamic()) return;
  const dir=raycaster.ray.direction;
  const mass=Math.max(.5,body.mass());
  const impulse=Math.min(120,Number(powerSlider.value))*Math.sqrt(mass);
  const vector=V(dir.x*impulse,Math.max(impulse*.38,dir.y*impulse),dir.z*impulse);
  body.applyImpulseAtPoint(vector,target.point,true);
  if(breakables.hit(body,Math.min(15,impulse*.2),'impact')) note('SHATTER / mouse shove');
  chains.shakeSoda(body,Math.min(15,impulse*.2));
});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});
const stats=document.querySelector<HTMLElement>('#stats')!;
const feed=document.querySelector<HTMLElement>('#events')!;
let last=performance.now(),display=0;
function frame(now:number):void {
  requestAnimationFrame(frame);
  const dt=Math.min(.07,(now-last)/1000); last=now;
  world.step(dt);
  controls.update();
  for(const [handle,mesh] of meshes) {
    const body=world.raw.getRigidBody(handle);
    if(!body || !body.isValid()) {
      scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
      meshes.delete(handle); transientMaterials.delete(handle); continue;
    }
    const pose=world.getInterpolatedTransform(body,world.alpha);
    mesh.position.set(pose.translation.x,pose.translation.y,pose.translation.z);
    mesh.quaternion.set(pose.rotation.x,pose.rotation.y,pose.rotation.z,pose.rotation.w);
  }
  display+=dt;
  if(display>.13) {
    display=0;
    stats.textContent='Rapier ticks '+world.stepCount+' | Bodies '+meshes.size+
      ' | Debris '+breakables.debrisCount+'/'+breakables.maxDebris+
      ' | Water wet '+water.submergedCount;
    feed.textContent=history.join('\n')||'Shove a domino or smash a stack!';
  }
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
addEventListener('beforeunload',()=>{
  surfaces.dispose(); chains.dispose(); breakables.dispose();
  water.dispose(); budget.dispose(); world.dispose(); renderer.dispose();
});
void poolId;
