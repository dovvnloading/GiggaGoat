/** Production-ready visual QA page for running dust and landing impact ring. */
import * as THREE from 'three';
import { GoatCharacter } from '../../character/GoatCharacter';
import { RunningDustPuffs } from '../RunningDustPuffs';
import { LandingImpactRing } from '../LandingImpactRing';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing VFX lab element: ' + id);
  return found as T;
}

const canvas = element<HTMLCanvasElement>('stage');
const state = element<HTMLElement>('state');
const pauseButton = element<HTMLButtonElement>('pause');
const burstButton = element<HTMLButtonElement>('burst');
const clearButton = element<HTMLButtonElement>('clear');
const directionControl = element<HTMLSelectElement>('direction');
const rateControl = element<HTMLInputElement>('rate');
const rateLabel = element<HTMLOutputElement>('rate-value');
const landingButton = element<HTMLButtonElement>('landing');
const impactStrengthControl = element<HTMLInputElement>('impact-strength');
const impactStrengthLabel = element<HTMLOutputElement>('impact-strength-value');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfff3ea);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 70);
scene.add(new THREE.HemisphereLight(0xfff9e8, 0x94788b, 2.6));
const key = new THREE.DirectionalLight(0xfff0d4, 3.4);
key.position.set(-3.6, 8, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -8;
key.shadow.camera.right = 8;
key.shadow.camera.top = 8;
key.shadow.camera.bottom = -8;
key.shadow.camera.near = 0.1;
key.shadow.camera.far = 25;
key.shadow.bias = -0.0004;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xffd9ab, 1.0);
fill.position.set(4, 3, -4);
scene.add(fill);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshToonMaterial({ color: 0xfff7e9 }),
);
floor.name = 'warm art-review floor';
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.028;
floor.receiveShadow = true;
scene.add(floor);

// The existing in-repo procedural goat gives the effect its running context.
// No physics is constructed, and no game or character files are modified.
const goat = new GoatCharacter();
goat.setPreview('sprint', 'BILLY');
scene.add(goat.root);

const dust = new RunningDustPuffs({ capacity: 160, seed: 2317 });
scene.add(dust.group);

const landing = new LandingImpactRing({ capacity: 10 });
scene.add(landing.group);

let heading = -1;
let cadence = Number(rateControl.value);
let paused = false;
let emissionClock = 0;
let landingClock = 0;
let lastTime = 0;
let yaw = 0;
let elevation = 0.19;
let distance = 5.1;
let width = 0;
let height = 0;
let pointer: { id: number; x: number; y: number } | null = null;
let disposed = false;
const lookAt = new THREE.Vector3(0.15, 0.79, 0);

function setDirection(value: string): void {
  heading = value === 'right' ? 1 : -1;
  goat.root.rotation.y = heading < 0 ? Math.PI / 2 : -Math.PI / 2;
  goat.root.position.set(heading < 0 ? -0.91 : 0.91, 0, 0);
  dust.clear();
  landing.clear();
  emissionClock = 0;
  landingClock = 0;
}

function emitHoof(): void {
  // Y=0 contact point, slightly behind the sprinting goat's hind hooves.
  dust.emit(
    { x: goat.root.position.x - heading * 0.61, y: 0, z: 0.03 },
    { x: heading, y: 0, z: 0 },
  );
}

function emitLanding(): void {
  // Ground point beneath the goat. The effect owns no character physics.
  landing.emit(
    { x: goat.root.position.x, y: 0, z: 0.03 },
    Number(impactStrengthControl.value),
  );
}

function refreshUi(): void {
  state.textContent = (paused ? 'Paused' : 'Running') + ' / ' +
    dust.activeCount + ' dust sprites / ' + landing.activeCount + ' landing rings';
  pauseButton.textContent = paused ? 'Resume motion' : 'Pause motion';
  pauseButton.setAttribute('aria-pressed', String(paused));
  rateLabel.textContent = cadence.toFixed(1) + '/s';
  impactStrengthLabel.textContent = Number(impactStrengthControl.value).toFixed(1);
}

directionControl.addEventListener('change', () => {
  setDirection(directionControl.value);
  emitHoof();
  dust.update(0.14);
});
rateControl.addEventListener('input', () => {
  cadence = Number(rateControl.value);
  refreshUi();
});
impactStrengthControl.addEventListener('input', refreshUi);
landingButton.addEventListener('click', () => {
  emitLanding();
  // Hold a developed shockwave in the pause-to-compare workflow.
  if (paused) landing.update(0.19);
  refreshUi();
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  refreshUi();
});
burstButton.addEventListener('click', () => {
  emitHoof();
  // Make a paused single-frame art review show a fully formed lobe.
  if (paused) dust.update(0.14);
  refreshUi();
});
clearButton.addEventListener('click', () => {
  dust.clear();
  landing.clear();
  emissionClock = 0;
  landingClock = 0;
  refreshUi();
});

canvas.addEventListener('pointerdown', e => {
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  if (!pointer || pointer.id !== e.pointerId) return;
  yaw -= (e.clientX - pointer.x) * 0.008;
  elevation = THREE.MathUtils.clamp(
    elevation + (e.clientY - pointer.y) * 0.006, -0.05, 0.85);
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
function endPointer(): void {
  pointer = null;
  canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  distance = THREE.MathUtils.clamp(
    distance * Math.exp(e.deltaY * 0.001), 3.4, 9);
}, { passive: false });

function frame(now: number): void {
  if (disposed) return;
  requestAnimationFrame(frame);
  const dt = lastTime ? Math.min(0.05, Math.max(0, (now - lastTime) / 1000)) : 0;
  lastTime = now;
  if (!paused) {
    goat.update(dt);
    emissionClock += dt;
    const period = 1 / cadence;
    // Bound work after background-tab stalls without discarding real effect ages.
    let emitted = 0;
    while (emissionClock >= period && emitted < 3) {
      emitHoof();
      emissionClock -= period;
      emitted++;
    }
    if (emitted === 3) emissionClock = 0;
    dust.update(dt);
    landingClock += dt;
    if (landingClock >= 1.65) {
      // Periodic landings demonstrate overlapping shockwave and dust.
      landingClock %= 1.65;
      emitLanding();
    }
    landing.update(dt);
  }

  const horizontal = Math.cos(elevation) * distance;
  camera.position.set(
    lookAt.x + Math.sin(yaw) * horizontal,
    lookAt.y + Math.sin(elevation) * distance + 0.42,
    lookAt.z + Math.cos(yaw) * horizontal,
  );
  camera.lookAt(lookAt);

  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  if (w !== width || h !== height) {
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  refreshUi();
  renderer.render(scene, camera);
}

setDirection(directionControl.value);
goat.update(0);
// Start with a visible small→large group instead of an empty first frame.
emitHoof();
dust.update(0.19);
emitLanding();
landing.update(0.19);
refreshUi();
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => {
  if (disposed) return;
  disposed = true;
  dust.dispose();
  landing.dispose();
  goat.dispose();
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  renderer.dispose();
});
