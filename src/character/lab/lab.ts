/**
 * Animated goat model review: all three shipped GLBs, side by side.
 * The optional Rapier mode binds the middle hero to a real GoatRagdoll.
 * Works both in Vite dev and in a GitHub Pages production build.
 */
import * as THREE from 'three';
import { GoatRagdoll, PhysicsWorld, V } from '../../physics';
import { GoatCharacter } from '../GoatCharacter';
import { TIERS, TIER_PROFILES, type GoatTier } from '../motion';
import { GOAT_CLIPS, goatPublicAssetUrl, type GoatClip } from '../rigged';

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
const circleButton = element('circle') as HTMLButtonElement;
const pauseButton = element('pause') as HTMLButtonElement;
const resetButton = element('reset') as HTMLButtonElement;
const reference = element('lineup-image') as HTMLImageElement;
reference.src = goatPublicAssetUrl('_preview.jpg');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd1e1ec);
const camera = new THREE.PerspectiveCamera(43, 1, .04, 180);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.add(new THREE.HemisphereLight(0xfff8ec, 0x8b93aa, 2.3));
const sun = new THREE.DirectionalLight(0xfff6e6, 3.1);
sun.position.set(-5, 10, -7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26;
sun.shadow.camera.bottom = -26;
sun.shadow.camera.far = 70;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xd7e5ff, 1.25);
rim.position.set(6, 5, 5);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 80),
  new THREE.MeshToonMaterial({ color: 0xf7fafb }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.025;
floor.receiveShadow = true;
scene.add(floor);
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(4.25, 4.3, .12, 72),
  new THREE.MeshToonMaterial({ color: 0xeaf2f6 }));
pedestal.position.y = -.12;
pedestal.receiveShadow = true;
scene.add(pedestal);

// This ordering matches the attached lineup: bell, cream hero, blue bandana.
const lineup = ['bell', 'hero', 'bandana'] as const;
const characters = lineup.map(variant => {
  const character = new GoatCharacter(undefined, { variant });
  scene.add(character.root);
  return character;
});
const art = characters[1]!;
let clip: GoatClip = 'Idle';
let tier: GoatTier = 'BILLY';
let physicsMode = false;
let circleMode = false;
let circleSeconds = 0;
let demoMotion: 'Idle' | 'Walk' | 'Run' = 'Idle';
let paused = false;
let yaw = -.48;
let pitch = .16;
let zoom = 1;
let lastFrame = 0;
let pointer: { id: number; x: number; y: number } | null = null;
const held = new Set<string>();

const physics = await PhysicsWorld.create();
physics.createGround(V(30, .5, 30));
const goat = new GoatRagdoll(physics, { position: V(), size: 1, id: 'character-review' });
physics.createBox(V(0, .5, -3), V(.35, .38, .35), 12);

const labels: Record<GoatClip, string> = {
  Idle: 'IDLE · breathing',
  Walk: 'WALK · four-beat',
  Run: 'RUN · gallop',
  Jump: 'JUMP · launch / land',
  Headbutt: 'HEADBUTT · horns first',
  Bleat: 'BLEAT · call',
};
const buttonsByClip = new Map<GoatClip, HTMLButtonElement>();
const buttonsByTier = new Map<GoatTier, HTMLButtonElement>();
for (const name of GOAT_CLIPS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = labels[name];
  button.addEventListener('click', () => selectClip(name));
  poseButtons.append(button);
  buttonsByClip.set(name, button);
}
for (const name of TIERS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name + ' · ' + TIER_PROFILES[name].physicsScale + '×';
  button.addEventListener('click', () => selectTier(name));
  tierButtons.append(button);
  buttonsByTier.set(name, button);
}

function syncLineup(): void {
  const scale = TIER_PROFILES[tier].physicsScale;
  for (const [index, character] of characters.entries()) {
    character.root.visible = circleMode ? character === art :
      !physicsMode || character === art;
    if (!circleMode) {
      character.root.position.set(physicsMode ? 0 : (index - 1) * 2.75 * scale, 0, 0);
      character.root.rotation.y = 0;
    }
  }
  pedestal.scale.setScalar(scale);
}

function refreshPanel(): void {
  for (const [name, button] of buttonsByClip) {
    button.setAttribute('aria-pressed', String(name === clip));
  }
  for (const [name, button] of buttonsByTier) {
    button.setAttribute('aria-pressed', String(name === tier));
  }
  modeButton.setAttribute('aria-pressed', String(physicsMode));
  circleButton.setAttribute('aria-pressed', String(circleMode));
  pauseButton.setAttribute('aria-pressed', String(paused));
  modeButton.textContent = physicsMode ? 'Show three variants' : 'Enter real Rapier mode';
  circleButton.textContent = circleMode ? 'Stop circle walk' : 'Walk circle · nose first';
  pauseButton.textContent = paused ? 'Resume animation' : 'Pause animation';
  const ready = characters.filter(character => character.isReady).length;
  status.textContent = (circleMode ? 'Walk circle / nose leads along tangent' :
    physicsMode ? 'Rapier hero / ' + art.action.toUpperCase() :
    'Lineup / ' + clip.toUpperCase()) + ' · ' + tier +
    ' · ' + ready + '/3 GLBs loaded';
}

function selectTier(name: GoatTier): void {
  tier = name;
  if (physicsMode) goat.resize(TIER_PROFILES[name].physicsScale);
  else for (const character of characters)
    character.setPreviewClip(circleMode ? 'Walk' : clip, tier);
  syncLineup();
  refreshPanel();
}

function selectClip(name: GoatClip): void {
  if (circleMode) {
    circleMode = false;
    syncLineup();
  }
  clip = name;
  if (!physicsMode) {
    for (const character of characters) character.setPreviewClip(name, tier);
  } else {
    switch (name) {
      case 'Idle':
      case 'Walk':
      case 'Run':
        demoMotion = name;
        break;
      case 'Jump':
        goat.locomotion.requestJump();
        art.play('jump', 1);
        break;
      case 'Headbutt':
        goat.interactions.headbutt(1);
        art.play('headbutt', .8);
        break;
      case 'Bleat':
        goat.interactions.bleat();
        art.play('bleat', 1);
        break;
    }
  }
  refreshPanel();
}

modeButton.addEventListener('click', () => {
  physicsMode = !physicsMode;
  circleMode = false;
  demoMotion = 'Idle';
  held.clear();
  goat.locomotion.setInput({ z: 0, x: 0, sprint: false });
  if (physicsMode) {
    goat.resize(TIER_PROFILES[tier].physicsScale);
    art.bind(goat);
  } else {
    art.bind(null);
    for (const character of characters) character.setPreviewClip(clip, tier);
  }
  syncLineup();
  refreshPanel();
});
circleButton.addEventListener('click', () => {
  if (physicsMode) {
    physicsMode = false;
    held.clear();
    goat.locomotion.setInput({ z: 0, x: 0, sprint: false });
    art.bind(null);
  }
  circleMode = !circleMode;
  if (circleMode) circleSeconds = 0;
  for (const character of characters)
    character.setPreviewClip(circleMode ? 'Walk' : clip, tier);
  syncLineup();
  refreshPanel();
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  refreshPanel();
});
function resetCamera(): void { yaw = -.48; pitch = .16; zoom = 1; }
resetButton.addEventListener('click', resetCamera);
canvas.addEventListener('pointerdown', event => {
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  yaw -= (event.clientX - pointer.x) * .008;
  pitch = THREE.MathUtils.clamp(pitch + (event.clientY - pointer.y) * .006, -.2, 1.2);
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});
const endDrag = (): void => { pointer = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  zoom = THREE.MathUtils.clamp(zoom * Math.exp(event.deltaY * .001), .65, 2.2);
}, { passive: false });
window.addEventListener('keydown', event => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement)?.tagName ?? '')) return;
  if (event.code === 'Space') event.preventDefault();
  if (!event.repeat && event.code.startsWith('Digit')) {
    const digit = Number(event.code.slice(-1));
    const option = TIERS[digit - 1];
    if (option) selectTier(option);
  }
  if (!event.repeat && event.code === 'KeyE') selectClip('Bleat');
  if (!event.repeat && event.code === 'Space') selectClip('Jump');
  if (!event.repeat && event.code === 'KeyQ' && physicsMode) goat.flop();
  if (!event.repeat && event.code === 'KeyT' && physicsMode) {
    if (goat.interactions.isTongueAttached) goat.interactions.detachTongue();
    else goat.interactions.attachTongue();
  }
  held.add(event.code);
});
window.addEventListener('keyup', event => held.delete(event.code));
window.addEventListener('blur', () => held.clear());

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = lastFrame ? Math.min(.06, Math.max(0, (now - lastFrame) / 1000)) : 1 / 60;
  lastFrame = now;
  const size = TIER_PROFILES[tier].physicsScale;
  if (physicsMode) {
    const keyboardZ = Number(held.has('KeyW')) - Number(held.has('KeyS'));
    const keyboardX = Number(held.has('KeyD')) - Number(held.has('KeyA'));
    goat.locomotion.setInput({
      x: keyboardX,
      z: keyboardZ || (keyboardX ? 0 : demoMotion === 'Idle' ? 0 : 1),
      cameraYaw: 0,
      sprint: held.has('ShiftLeft') || held.has('ShiftRight') ||
        (keyboardX === 0 && keyboardZ === 0 && demoMotion === 'Run'),
    });
    if (!paused) {
      const step = physics.step(dt);
      art.update(dt, step.alpha);
    } else art.update(0);
  } else {
    if (circleMode) {
      // Integrate physics forward(yaw) = (sin(yaw), 0, -cos(yaw)):
      // x = -r cos(yaw), z = -r sin(yaw). The nose leads the tangent
      // at every point, with 1.6 m × 0.75 rad/s = 1.2 m/s at Billy size.
      if (!paused) circleSeconds += dt;
      const heading = circleSeconds * .75;
      const radius = 1.6 * size;
      art.root.position.set(-radius * Math.cos(heading), 0, -radius * Math.sin(heading));
      // Three.js rotates -Z toward -X for positive Y angles; physical
      // forward(heading) rotates it toward +X, so negate the preview yaw.
      art.root.rotation.y = -heading;
    }
    for (const character of characters) character.update(paused ? 0 : dt);
  }
  if (Math.floor(now / 350) !== Math.floor((now - dt * 1000) / 350)) refreshPanel();

  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) ||
      canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const pivot = physicsMode ? goat.torso.translation() : V(0, .95 * size, 0);
  const target = new THREE.Vector3(pivot.x, pivot.y + .12 * size, pivot.z);
  const narrow = physicsMode ? 1 : Math.max(1, 1.32 / camera.aspect);
  const distance = (physicsMode ? 4.3 : 8.9) * size * zoom * narrow;
  const horizontal = Math.cos(pitch) * distance;
  camera.position.set(
    target.x + Math.sin(yaw) * horizontal,
    target.y + Math.sin(pitch) * distance + .5 * size,
    target.z - Math.cos(yaw) * horizontal,
  );
  camera.lookAt(target);
  renderer.render(scene, camera);
}

for (const character of characters) character.setPreviewClip('Idle', 'BILLY');
syncLineup();
refreshPanel();
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => {
  for (const character of characters) character.dispose();
  goat.dispose();
  physics.dispose();
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  pedestal.geometry.dispose();
  (pedestal.material as THREE.Material).dispose();
  renderer.dispose();
}, { once: true });
