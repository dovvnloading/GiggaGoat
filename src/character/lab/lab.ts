/**
 * Art review page. Vite only: /src/character/lab/index.html
 * Preview is nonphysical; "real Rapier" mode drives exactly the same seven
 * visual meshes from the live GoatRagdoll's interpolated rigid bodies.
 */
import * as THREE from 'three';
import { GoatRagdoll, PhysicsWorld, V } from '../../physics';
import { GoatCharacter } from '../GoatCharacter';
import {
  ACTIONS, TIERS, TIER_PROFILES,
  type CharacterAction, type GoatTier,
} from '../motion';

if (!import.meta.env.DEV) throw new Error('The character lab is development-only.');
const element = (id: string): HTMLElement => {
  const result = document.getElementById(id);
  if (!result) throw new Error('Missing character lab element: ' + id);
  return result;
};
const canvas = element('stage') as HTMLCanvasElement;
const poseButtons = element('poseButtons');
const tierButtons = element('tierButtons');
const status = element('status');
const modeButton = element('mode') as HTMLButtonElement;
const pauseButton = element('pause') as HTMLButtonElement;
const resetButton = element('reset') as HTMLButtonElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3e6e2);
const camera = new THREE.PerspectiveCamera(43, 1, .03, 180);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.add(new THREE.HemisphereLight(0xfff5e3, 0x997d94, 2.5));
const sun = new THREE.DirectionalLight(0xfff4df, 3.1);
sun.position.set(-3, 9, -5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -13; sun.shadow.camera.right = 13;
sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13;
sun.shadow.camera.near = .5; sun.shadow.camera.far = 42;
sun.shadow.bias = -.0004;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xdfccfb, 1.25);
rim.position.set(6, 5, 4);
scene.add(rim);
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(15, 72),
  new THREE.MeshToonMaterial({ color: 0xfbf2e4 }),
);
floor.name = 'review studio floor';
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.012;
floor.receiveShadow = true;
scene.add(floor);
const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(3.4, 3.48, .13, 64),
  new THREE.MeshToonMaterial({ color: 0xe7d4d7 }),
);
pedestal.position.y = -.12;
pedestal.receiveShadow = true;
scene.add(pedestal);

const rock = new THREE.Mesh(
  new THREE.DodecahedronGeometry(.62, 1),
  new THREE.MeshToonMaterial({ color: 0x8f879b, flatShading: true }),
);
rock.position.set(-.32, .40, -2.07);
rock.castShadow = true;
scene.add(rock);
const crate = new THREE.Mesh(
  new THREE.BoxGeometry(.70, .68, .6),
  [
    new THREE.MeshToonMaterial({ color: 0xc08038 }),
    new THREE.MeshToonMaterial({ color: 0xf7b95a }),
    new THREE.MeshToonMaterial({ color: 0xe5a454 }),
    new THREE.MeshToonMaterial({ color: 0x996025 }),
    new THREE.MeshToonMaterial({ color: 0xcd8734 }),
    new THREE.MeshToonMaterial({ color: 0xe1a44a }),
  ],
);
crate.castShadow = true;
crate.position.set(0, 1.13, -2.98);
scene.add(crate);
const wall = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 3.4, .45),
  new THREE.MeshToonMaterial({ color: 0x9a92a5, flatShading: true }),
);
wall.castShadow = true;
wall.position.set(-.85, 1.51, -1.51);
scene.add(wall);

let tier: GoatTier = 'BILLY';
let pose: CharacterAction = 'stand';
let physicsMode = false;
let paused = false;
let yaw = -.55;
let pitch = .22;
let zoom = 1;
const held = new Set<string>();
let lastFrame = 0;
let pointer: { id: number; x: number; y: number } | null = null;
const art = new GoatCharacter();
scene.add(art.root);

const physics = await PhysicsWorld.create();
physics.createGround(V(30, .5, 30));
const goat = new GoatRagdoll(physics, { position: V(), size: 1, id: 'character-review' });
physics.createBox(V(0, .5, -3), V(.35, .38, .35), 12);
const label: Record<CharacterAction, string> = {
  stand: 'TURNAROUND',
  sprint: 'SPRINT',
  'jump-flip': 'JUMP FLIP',
  headbutt: 'HEADBUTT',
  'tongue-grab': 'TONGUE GRAB',
  bleat: 'BLEAT',
  flop: 'FLOP',
  'wall-climb': 'WALL CLIMB',
  glide: 'GLIDE',
};
const symbol: Record<CharacterAction, string> = {
  stand: '◉', sprint: '➜', 'jump-flip': '↻',
  headbutt: '✷', 'tongue-grab': '➤', bleat: '♫',
  flop: '◡', 'wall-climb': '↥', glide: '△',
};
const buttonsByPose = new Map<CharacterAction, HTMLButtonElement>();
const buttonsByTier = new Map<GoatTier, HTMLButtonElement>();
for (const action of ACTIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = symbol[action] + '  ' + label[action];
  button.addEventListener('click', () => selectPose(action));
  poseButtons.append(button);
  buttonsByPose.set(action, button);
}
for (const name of TIERS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name + ' · ' + TIER_PROFILES[name].physicsScale + '×';
  button.addEventListener('click', () => selectTier(name));
  tierButtons.append(button);
  buttonsByTier.set(name, button);
}

const refreshPanel = (): void => {
  for (const [name, button] of buttonsByPose) {
    button.setAttribute('aria-pressed', String(name === pose));
  }
  for (const [name, button] of buttonsByTier) {
    button.setAttribute('aria-pressed', String(name === tier));
  }
  modeButton.setAttribute('aria-pressed', String(physicsMode));
  pauseButton.setAttribute('aria-pressed', String(paused));
  modeButton.textContent = physicsMode ? 'Return to art poses' : 'Enter real Rapier mode';
  pauseButton.textContent = paused ? 'Resume animation' : 'Pause animation';
  status.textContent =
    (physicsMode ? 'Rapier / ' + art.action.toUpperCase() : 'Art preview / ' + label[pose]) +
    ' · ' + tier + ' (' + TIER_PROFILES[tier].physicsScale + '×)';
};
const selectTier = (name: GoatTier): void => {
  tier = name;
  if (physicsMode) goat.resize(TIER_PROFILES[name].physicsScale);
  else art.setPreview(pose, name);
  refreshPanel();
};
const selectPose = (name: CharacterAction): void => {
  pose = name;
  if (physicsMode) {
    // Demonstrate real impulses/tethers where available. Visual accents for
    // bleat/headbutt do not pretend to alter the underlying physics.
    switch (name) {
      case 'sprint':
        goat.locomotion.setInput({ sprint: true, z: 1 });
        break;
      case 'jump-flip':
        goat.locomotion.requestJump();
        goat.locomotion.requestJump();
        break;
      case 'headbutt':
        goat.interactions.headbutt(1);
        art.play('headbutt');
        break;
      case 'tongue-grab':
        if (goat.interactions.isTongueAttached) goat.interactions.detachTongue();
        else goat.interactions.attachTongue();
        art.play('tongue-grab', 1.2);
        break;
      case 'bleat':
        goat.interactions.bleat();
        art.play('bleat');
        break;
      case 'flop':
        goat.flop();
        break;
      case 'glide':
        art.play('glide', 2.3);
        break;
      case 'wall-climb':
        goat.locomotion.setInput({ z: 1, canClimb: true });
        art.play('wall-climb', 1);
        break;
      case 'stand':
        goat.locomotion.setInput({ z: 0, x: 0, sprint: false });
        break;
    }
  } else art.setPreview(name, tier);
  refreshPanel();
};
modeButton.addEventListener('click', () => {
  physicsMode = !physicsMode;
  held.clear();
  if (physicsMode) {
    goat.resize(TIER_PROFILES[tier].physicsScale);
    art.bind(goat);
    goat.locomotion.setInput({ x: 0, z: 0, sprint: false });
  } else {
    goat.locomotion.setInput({ x: 0, z: 0, sprint: false });
    art.bind(null);
    art.setPreview(pose, tier);
  }
  refreshPanel();
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  refreshPanel();
});
function resetCamera(): void { yaw = -.55; pitch = .22; zoom = 1; }
resetButton.addEventListener('click', resetCamera);
canvas.addEventListener('pointerdown', e => {
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  if (!pointer || pointer.id !== e.pointerId) return;
  const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
  pointer.x = e.clientX; pointer.y = e.clientY;
  yaw -= dx * .008;
  pitch = THREE.MathUtils.clamp(pitch + dy * .006, -.25, 1.20);
});
const endDrag = (): void => { pointer = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoom = THREE.MathUtils.clamp(zoom * Math.exp(e.deltaY * .001), .56, 2.1);
}, { passive: false });
window.addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')) return;
  if (e.code === 'Space') e.preventDefault();
  if (!e.repeat && e.code.startsWith('Digit')) {
    const digit = Number(e.code.slice(-1));
    const option = TIERS[digit - 1];
    if (option) selectTier(option);
  }
  if (!e.repeat && e.code === 'KeyE') selectPose('bleat');
  if (!e.repeat && e.code === 'KeyQ') selectPose('flop');
  if (!e.repeat && e.code === 'KeyT') selectPose('tongue-grab');
  if (!e.repeat && e.code === 'Space') selectPose('jump-flip');
  held.add(e.code);
});
window.addEventListener('keyup', e => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = lastFrame ? Math.min(.06, Math.max(0, (now - lastFrame) / 1000)) : 1 / 60;
  lastFrame = now;
  const size = TIER_PROFILES[tier].physicsScale;
  if (physicsMode) {
    goat.locomotion.setInput({
      x: Number(held.has('KeyD')) - Number(held.has('KeyA')),
      z: Number(held.has('KeyW')) - Number(held.has('KeyS')),
      cameraYaw: 0,
      sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
    });
    if (!paused) {
      const step = physics.step(dt);
      art.update(dt, step.alpha);
    } else art.update(0);
    if (Math.floor(now / 350) !== Math.floor((now - dt * 1000) / 350)) refreshPanel();
  } else art.update(paused ? 0 : dt);
  rock.visible = !physicsMode && pose === 'headbutt';
  crate.visible = !physicsMode && pose === 'tongue-grab';
  wall.visible = !physicsMode && pose === 'wall-climb';
  rock.scale.setScalar(size);
  crate.scale.setScalar(size);
  wall.scale.setScalar(size);
  rock.position.set(-.32 * size, .40 * size, -2.07 * size);
  crate.position.set(0, 1.13 * size, -2.98 * size);
  wall.position.set(-.85 * size, 1.51 * size, -1.51 * size);
  const pivot = physicsMode ? goat.torso.translation() : V(0, .87 * size, 0);
  const target = new THREE.Vector3(pivot.x, pivot.y + .13 * size, pivot.z);
  const distance = 4.15 * size * zoom;
  const horizontal = Math.cos(pitch) * distance;
  const offset = new THREE.Vector3(
    Math.sin(yaw) * horizontal,
    Math.sin(pitch) * distance + .55 * size,
    -Math.cos(yaw) * horizontal);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
  const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
      canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
}
art.setPreview('stand', 'BILLY');
refreshPanel();
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => {
  art.dispose();
  goat.dispose();
  physics.dispose();
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  pedestal.geometry.dispose();
  (pedestal.material as THREE.Material).dispose();
  rock.geometry.dispose();
  (rock.material as THREE.Material).dispose();
  crate.geometry.dispose();
  for (const material of crate.material as THREE.Material[]) material.dispose();
  wall.geometry.dispose();
  (wall.material as THREE.Material).dispose();
  renderer.dispose();
}, { once: true });
