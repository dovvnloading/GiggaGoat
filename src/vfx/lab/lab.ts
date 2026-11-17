/** Production art QA: 01–09, growth aura centered by default. */
import * as THREE from 'three';
import { GoatCharacter } from '../../character/GoatCharacter';
import { RunningDustPuffs } from '../RunningDustPuffs';
import { LandingImpactRing } from '../LandingImpactRing';
import { HeadbuttImpactStars } from '../HeadbuttImpactStars';
import { WaterSplash } from '../WaterSplash';
import { CrateBreakDebris } from '../CrateBreakDebris';
import { TrampolineBoing } from '../TrampolineBoing';
import {
  TRAMPOLINE_MAT_Y, makeTrampolineBoingBurst, makeTrampolineBoingFrame,
  sampleTrampolineBoing, type TrampolineBoingBurst,
} from '../trampolineBoingMath';
import { LaunchPadBurst } from '../LaunchPadBurst';
import { ComboPopText } from '../ComboPopText';
import { GiggaGrowthPurpleAura } from '../GiggaGrowthPurpleAura';
import type { GrowthTier } from '../growthAuraMath';
import { makeComboPopCue } from '../comboPopMath';
import {
  LAUNCH_PAD_TOP_Y, makeLaunchPadBurstCue, makeLaunchPadBurstFrame,
  sampleLaunchPadBurst, type LaunchPadBurstCue,
} from '../launchPadMath';
import { getViewportSize } from './viewport';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing VFX lab element: ' + id);
  return found as T;
}

const canvas = element<HTMLCanvasElement>('stage');
const viewport = element<HTMLElement>('viewport');
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
const headbuttButton = element<HTMLButtonElement>('headbutt');
const headbuttPowerControl = element<HTMLInputElement>('headbutt-power');
const headbuttPowerLabel = element<HTMLOutputElement>('headbutt-power-value');
const waterButton = element<HTMLButtonElement>('water');
const waterSpeedControl = element<HTMLInputElement>('water-speed');
const waterSpeedLabel = element<HTMLOutputElement>('water-speed-value');
const waterMassControl = element<HTMLInputElement>('water-mass');
const waterMassLabel = element<HTMLOutputElement>('water-mass-value');
const crateButton = element<HTMLButtonElement>('crate');
const crateSizeControl = element<HTMLInputElement>('crate-size');
const crateSizeLabel = element<HTMLOutputElement>('crate-size-value');
const previewModeControl = element<HTMLSelectElement>('preview-mode');
const showcaseControls = element<HTMLElement>('showcase-controls');
const showcaseTriggers = element<HTMLElement>('showcase-triggers');
const trampolineButton = element<HTMLButtonElement>('trampoline');
const trampolineScaleControl = element<HTMLInputElement>('trampoline-scale');
const trampolineScaleLabel = element<HTMLOutputElement>('trampoline-scale-value');
const trampolineStrengthControl = element<HTMLInputElement>('trampoline-strength');
const trampolineStrengthLabel = element<HTMLOutputElement>('trampoline-strength-value');
const launchButton = element<HTMLButtonElement>('launch');
const launchStrengthControl = element<HTMLInputElement>('launch-strength');
const launchStrengthLabel = element<HTMLOutputElement>('launch-strength-value');
const launchControls = element<HTMLElement>('launch-controls');
const comboControls = element<HTMLElement>('combo-controls');
const comboReplayButton = element<HTMLButtonElement>('combo-replay');
const comboNextButton = element<HTMLButtonElement>('combo-next');
const comboReference = element<HTMLElement>('combo-reference');
const growthReference = element<HTMLElement>('growth-reference');
const growthControls = element<HTMLElement>('growth-controls');
const growthReplayButton = element<HTMLButtonElement>('growth-replay');
const growthNextButton = element<HTMLButtonElement>('growth-next');
const launchReference = element<HTMLElement>('launch-reference');
const targetTitle = element<HTMLElement>('target-title');
const trampolineControls = element<HTMLElement>('trampoline-controls');
const previewTitle = element<HTMLElement>('preview-title');
const poseHint = element<HTMLElement>('pose-hint');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfff3ea);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
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

const headbutt = new HeadbuttImpactStars({ capacity: 10 });
scene.add(headbutt.group);
const water = new WaterSplash({ capacity: 10 });
scene.add(water.group);
const crate = new CrateBreakDebris({ capacity: 8 });
scene.add(crate.group);
const trampoline = new TrampolineBoing({ capacity: 3 });
scene.add(trampoline.group);
const launchPad = new LaunchPadBurst({ capacity: 3 });
scene.add(launchPad.group);
const comboPop = new ComboPopText({ capacity: 4 });
scene.add(comboPop.group);
// An unscaled root is a stable hoof-level anchor across all four character tiers.
const growthAura = new GiggaGrowthPurpleAura({ capacity: 3 });
growthAura.attach(goat.root);
// A static faceted target for QA only; no collider or game physics.
const rockGeometry = new THREE.DodecahedronGeometry(0.44, 0);
const rockMaterial = new THREE.MeshToonMaterial({ color: 0x8e8194 });
const rock = new THREE.Mesh(rockGeometry, rockMaterial);
rock.name = 'decorative headbutt target rock';
rock.castShadow = true;
rock.receiveShadow = true;
scene.add(rock);
const headContact = new THREE.Vector3();

let heading = -1;
let cadence = Number(rateControl.value);
let paused = false;
let emissionClock = 0;
let landingClock = 0;
let headbuttClock = 0;
let waterClock = 0;
let crateClock = 0;
let trampolineClock = 0;
let launchClock = 0;
let comboClock = 0;
let comboIndex = 0;
let growthClock = 0;
let growthTier: GrowthTier = 0;
const growthTierNames = ['KID', 'BILLY', 'BIG', 'GIGGA'] as const;
const growthStageSeconds = [0.90, 1.65, 1.85, 4.05] as const;
let activeCombo = 2;
const comboSequence = [2, 3, 4] as const;
const comboContact = { x: 0, y: 1.7, z: 0 };
let previewMode: 'growth' | 'combo' | 'launch' | 'trampoline' | 'showcase' = 'growth';
let trampolineBurst: TrampolineBoingBurst | null = null;
const trampolinePreviewFrame = makeTrampolineBoingFrame();
const trampolineContact = { x: 0, y: 0, z: 0 };
const launchContact = { x: -1.50, y: 0, z: 0 };
const launchDirection = { x: 1, y: 0, z: 0 };
let launchCue: LaunchPadBurstCue | null = null;
const launchFrame = makeLaunchPadBurstFrame();
let lastTime = 0;
let yaw = 0;
let elevation = 0.19;
let distance = 5.1;
let width = 0;
let height = 0;
let pixelRatio = 0;
let pointer: { id: number; x: number; y: number } | null = null;
let disposed = false;
const lookAt = new THREE.Vector3(-0.35, 0.83, 0);

function setDirection(value: string): void {
  heading = value === 'right' ? 1 : -1;
  goat.root.rotation.y = heading < 0 ? Math.PI / 2 : -Math.PI / 2;
  goat.root.position.set(heading < 0 ? -0.91 : 0.91, 0, 0);
  dust.clear();
  landing.clear();
  headbutt.clear();
  water.clear();
  crate.clear();
  trampoline.clear();
  launchPad.clear();
  comboPop.clear();
  growthAura.clear();
  emissionClock = 0;
  landingClock = 0;
  headbuttClock = 0;
  waterClock = 0;
  crateClock = 0;
  trampolineClock = 0;
  launchClock = 0;
  comboClock = 0;
  comboIndex = 0;
  growthClock = 0;
  growthTier = 0;
  trampolineBurst = null;
  launchCue = null;
  goat.mountWorldPosition('head', headContact);
  rock.position.set(headContact.x + heading * 0.58, 0.38, headContact.z - 0.05);

  const showcase = previewMode === 'showcase';
  const boing = previewMode === 'trampoline';
  const isCombo = previewMode === 'combo';
  const isGrowth = previewMode === 'growth';
  for (const effect of [dust, landing, headbutt, water, crate]) {
    effect.group.visible = showcase;
  }
  trampoline.group.visible = boing;
  launchPad.group.visible = previewMode === 'launch';
  comboPop.group.visible = isCombo;
  growthAura.group.visible = isGrowth;
  rock.visible = showcase;
  goat.root.visible = !isCombo;
  floor.visible = !isCombo;
  (scene.background as THREE.Color).setHex(isGrowth ? 0xfff0fc : isCombo ? 0xfff7f5 : 0xfff3ea);
  showcaseControls.hidden = !showcase;
  showcaseTriggers.hidden = !showcase;
  trampolineControls.hidden = !boing;
  launchControls.hidden = previewMode !== 'launch';
  comboControls.hidden = !isCombo;
  growthControls.hidden = !isGrowth;
  comboReference.hidden = !isCombo;
  growthReference.hidden = !isGrowth;
  launchReference.hidden = isCombo || isGrowth;
  targetTitle.textContent = isGrowth ? '09 · GIGGA GROWTH PURPLE AURA · approved target'
    : isCombo ? '08 · COMBO POP TEXT · approved target'
    : '07 · Launch Pad Burst · target';
  burstButton.disabled = !showcase;

  previewTitle.textContent = isGrowth
    ? '09 · GIGGA growth purple aura · Kid → Billy → Big → GIGGA'
    : isCombo
      ? '08 · Combo Pop Text · x2 → x3 → x4! · squash, stretch and float'
    : showcase
      ? '01–05 · Dust + landing + headbutt + water + crate · drag to orbit'
    : boing
      ? '06 · Trampoline boing · squash → snap → flight · drag to orbit'
      : '07 · Launch pad burst · lit arrows → gold spikes → flight trails · drag to orbit';
  poseHint.textContent = isGrowth
    ? '09 · Hoof halo → lilac spirals + sparks → GIGGA flare → quiet aura'
    : isCombo
      ? '08 · Blue/yellow → orange/gold → purple with extra stars'
    : showcase
      ? '01–05 · Five looping legacy effects'
    : boing
      ? '06 · Downward dip → golden fan → violet launch arcs'
      : '07 · Glowing steel pad → gold fountain → long golden goat trail';
  lookAt.set(isGrowth ? 0 : isCombo ? 0 : showcase ? -0.35 : boing ? 0 : 0.22,
    isGrowth ? 1.82 : isCombo ? 1.98 : showcase ? 0.83 : boing ? 1.70 : 1.63, 0);
  distance = isGrowth ? 8.8 : isCombo ? 6.7 : showcase ? 5.1 : boing ? 7.7 : 8.9;
  goat.root.rotation.z = 0;
  goat.setPreview(isGrowth || boing ? 'stand' : 'sprint', isGrowth ? 'KID' : 'BILLY');
  if (isGrowth) {
    emitGrowthTier(0);
  } else if (isCombo) {
    emitCombo();
  } else if (boing) {
    goat.root.rotation.y = -Math.PI / 2;
    emitTrampoline();
    poseTrampolineGoat();
  } else if (previewMode === 'launch') {
    emitLaunch();
    poseLaunchGoat();
  }
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

function emitHeadbutt(): void {
  // Preview the same visual headbutt action used by the existing character rig.
  goat.play('headbutt', 0.45);
  goat.update(0);
  goat.mountWorldPosition('head', headContact);
  headbutt.emit(
    { x: headContact.x + heading * 0.31, y: headContact.y - 0.08, z: headContact.z + 0.12 },
    { x: heading, y: 0, z: 0 },
    Number(headbuttPowerControl.value),
  );
}

function emitWater(): void {
  // Contact at the water surface below the goat; cosmetic only, no physics.
  water.emit(
    { x: goat.root.position.x, y: 0, z: 0.16 },
    Number(waterSpeedControl.value), Number(waterMassControl.value),
  );
}

function emitTrampoline(): void {
  const scale = Number(trampolineScaleControl.value);
  const strength = Number(trampolineStrengthControl.value);
  trampolineBurst = makeTrampolineBoingBurst(trampolineContact, scale, strength);
  trampolineClock = 0;
  trampoline.emit(trampolineContact, scale, strength);
}

function poseTrampolineGoat(): void {
  const frame = trampolineBurst &&
    sampleTrampolineBoing(trampolineBurst, trampolineClock, trampolinePreviewFrame);
  const lift = frame?.goatLift ?? 0;
  goat.root.position.set(0, TRAMPOLINE_MAT_Y + lift, 0);
  goat.root.rotation.z = -0.12 * Math.min(1, Math.max(0, lift / 1.5));
}

function emitLaunch(): void {
  const strength = Number(launchStrengthControl.value);
  launchCue = makeLaunchPadBurstCue(launchContact, launchDirection, strength);
  launchClock = 0;
  launchPad.emit(launchContact, launchDirection, strength);
}

function emitGrowthTier(tier: GrowthTier): void {
  growthTier = tier;
  growthClock = 0;
  goat.root.position.set(0, 0, 0);
  goat.root.rotation.set(0, Math.PI / 2, 0);
  goat.setPreview('stand', growthTierNames[tier]);
  growthAura.triggerGrow(tier);
}

function nextGrowthTier(): void {
  emitGrowthTier(((growthTier + 1) % 4) as GrowthTier);
}

function emitCombo(): void {
  activeCombo = comboSequence[comboIndex]!;
  comboIndex = (comboIndex + 1) % comboSequence.length;
  comboClock = 0;
  comboPop.emit(comboContact, activeCombo);
}

function poseLaunchGoat(): void {
  const frame = launchCue && sampleLaunchPadBurst(launchCue, launchClock, launchFrame);
  goat.root.position.set(launchContact.x + (frame?.goatX ?? 0),
    launchContact.y + (frame?.goatY ?? LAUNCH_PAD_TOP_Y + 0.17), 0);
  goat.root.rotation.y = -Math.PI / 2;
  goat.root.rotation.z = frame?.goatPitch ?? 0;
}

function emitCrate(): void {
  // Standalone break preview next to the goat, not a gameplay collider.
  crate.emit(
    { x: goat.root.position.x - heading * 1.24, y: 0, z: -0.85 },
    { x: heading, y: 0, z: 0 },
    Number(crateSizeControl.value),
  );
}

function refreshUi(): void {
  state.textContent = previewMode === 'growth'
    ? (paused ? 'Paused' : 'Running') + ' / ' + growthTierNames[growthTier] +
      ' / ' + growthAura.activeCount + ' growth pulses / GIGGA hold at tier 3'
    : previewMode === 'combo'
    ? (paused ? 'Paused' : 'Running') + ' / COMBO x' + activeCombo +
      (activeCombo >= 4 ? '!' : '') + ' / pop → overshoot → rise + fade'
    : previewMode === 'launch'
      ? (paused ? 'Paused' : 'Running') + ' / ' + launchPad.activeCount +
      ' gold launch / lit arrows + spike fountain + golden flight trails'
    : previewMode === 'trampoline'
      ? (paused ? 'Paused' : 'Running') + ' / ' + trampoline.activeCount +
        ' trampoline bounce / target mat + speed rays + launch arcs'
      : (paused ? 'Paused' : 'Running') + ' / ' +
        dust.activeCount + ' dust sprites / ' + landing.activeCount +
        ' landing rings / ' + headbutt.activeCount + ' headbutt impacts / ' +
        water.activeCount + ' water splashes / ' +
        crate.activeCount + ' crate breaks';
  pauseButton.textContent = paused ? 'Resume motion' : 'Pause motion';
  pauseButton.setAttribute('aria-pressed', String(paused));
  rateLabel.textContent = cadence.toFixed(1) + '/s';
  impactStrengthLabel.textContent = Number(impactStrengthControl.value).toFixed(1);
  headbuttPowerLabel.textContent = Number(headbuttPowerControl.value).toFixed(1);
  waterSpeedLabel.textContent = Number(waterSpeedControl.value).toFixed(1);
  waterMassLabel.textContent = Number(waterMassControl.value).toFixed(1);
  crateSizeLabel.textContent = Number(crateSizeControl.value).toFixed(2);
  trampolineScaleLabel.textContent = Number(trampolineScaleControl.value).toFixed(2);
  trampolineStrengthLabel.textContent = Number(trampolineStrengthControl.value).toFixed(1);
  launchStrengthLabel.textContent = Number(launchStrengthControl.value).toFixed(1);
}

previewModeControl.addEventListener('change', () => {
  previewMode = previewModeControl.value === 'growth' ? 'growth' :
    previewModeControl.value === 'combo' ? 'combo' :
    previewModeControl.value === 'showcase' ? 'showcase' :
    previewModeControl.value === 'trampoline' ? 'trampoline' : 'launch';
  setDirection(directionControl.value);
  if (previewMode === 'showcase') {
    emitHoof(); dust.update(0.19);
    emitLanding(); landing.update(0.19);
    emitHeadbutt(); headbutt.update(0.27);
    emitWater(); water.update(0.37);
    emitCrate(); crate.update(0.34);
  }
  refreshUi();
});
directionControl.addEventListener('change', () => {
  setDirection(directionControl.value);
  if (previewMode === 'showcase') {
    emitHoof();
    dust.update(0.14);
  }
});
rateControl.addEventListener('input', () => {
  cadence = Number(rateControl.value);
  refreshUi();
});
impactStrengthControl.addEventListener('input', refreshUi);
headbuttPowerControl.addEventListener('input', refreshUi);
waterSpeedControl.addEventListener('input', refreshUi);
waterMassControl.addEventListener('input', refreshUi);
crateSizeControl.addEventListener('input', refreshUi);
trampolineScaleControl.addEventListener('input', () => { emitTrampoline(); poseTrampolineGoat(); refreshUi(); });
trampolineStrengthControl.addEventListener('input', () => { emitTrampoline(); poseTrampolineGoat(); refreshUi(); });
growthReplayButton.addEventListener('click', () => {
  if (previewMode !== 'growth') {
    previewMode = 'growth';
    previewModeControl.value = 'growth';
    setDirection(directionControl.value);
  } else {
    growthAura.clear();
    emitGrowthTier(0);
  }
  refreshUi();
});
growthNextButton.addEventListener('click', () => {
  if (previewMode !== 'growth') {
    previewMode = 'growth';
    previewModeControl.value = 'growth';
    setDirection(directionControl.value);
  }
  nextGrowthTier();
  if (paused && growthTier > 0) {
    growthClock = 0.43;
    growthAura.update(0.43);
  }
  refreshUi();
});
comboReplayButton.addEventListener('click', () => {
  if (previewMode !== 'combo') {
    previewMode = 'combo';
    previewModeControl.value = 'combo';
    setDirection(directionControl.value);
  } else {
    comboPop.clear();
    comboIndex = 0;
    emitCombo();
  }
  if (paused) { comboPop.update(0.16); comboClock = 0.16; }
  refreshUi();
});
comboNextButton.addEventListener('click', () => {
  comboPop.clear();
  emitCombo();
  if (paused) { comboPop.update(0.16); comboClock = 0.16; }
  refreshUi();
});
launchStrengthControl.addEventListener('input', () => {
  if (previewMode === 'launch') { launchPad.clear(); emitLaunch(); poseLaunchGoat(); }
  refreshUi();
});
launchButton.addEventListener('click', () => {
  if (previewMode !== 'launch') {
    previewMode = 'launch';
    previewModeControl.value = 'launch';
    setDirection(directionControl.value);
  } else {
    launchPad.clear();
    emitLaunch();
  }
  if (paused && launchCue) {
    const seek = launchCue.lifetime * 0.61;
    launchPad.update(seek);
    launchClock = seek;
    poseLaunchGoat();
  }
  refreshUi();
});
trampolineButton.addEventListener('click', () => {
  if (previewMode !== 'trampoline') {
    previewMode = 'trampoline';
    previewModeControl.value = 'trampoline';
    setDirection(directionControl.value);
  } else {
    emitTrampoline();
  }
  if (paused && trampolineBurst) {
    const seek = trampolineBurst.lifetime * 0.65;
    trampoline.update(seek);
    trampolineClock = seek;
    poseTrampolineGoat();
  }
  refreshUi();
});
crateButton.addEventListener('click', () => {
  emitCrate();
  if (paused) crate.update(0.31); // show flying planks in paused art review
  refreshUi();
});
waterButton.addEventListener('click', () => {
  emitWater();
  if (paused) water.update(0.37); // hold a tall cyan crown for art review
  refreshUi();
});
headbuttButton.addEventListener('click', () => {
  emitHeadbutt();
  if (paused) headbutt.update(0.31); // show gold stars in the paused comparison
  refreshUi();
});
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
  headbutt.clear();
  water.clear();
  crate.clear();
  trampoline.clear();
  launchPad.clear();
  comboPop.clear();
  growthAura.clear();
  emissionClock = 0;
  landingClock = 0;
  headbuttClock = 0;
  waterClock = 0;
  crateClock = 0;
  trampolineClock = 0;
  launchClock = 0;
  comboClock = 0;
  comboIndex = 0;
  trampolineBurst = null;
  launchCue = null;
  if (previewMode === 'trampoline') poseTrampolineGoat();
  else if (previewMode === 'launch') poseLaunchGoat();
  else goat.root.position.y = 0;
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

// Measure only the fixed-aspect-ratio wrapper, never the canvas that
// renderer.setSize() updates. This prevents a resize/layout feedback loop.
function resizeViewport(): void {
  const size = getViewportSize(viewport.clientWidth, window.devicePixelRatio);
  if (!size) return; // Hidden or not yet laid out.

  if (size.width === width && size.height === height && size.pixelRatio === pixelRatio) return;
  const dprChanged = size.pixelRatio !== pixelRatio;
  width = size.width;
  height = size.height;
  pixelRatio = size.pixelRatio;
  if (dprChanged) renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false); // CSS sizing belongs exclusively to .viewport.
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const viewportObserver = new ResizeObserver(resizeViewport);
viewportObserver.observe(viewport);
window.addEventListener('resize', resizeViewport);

function frame(now: number): void {
  if (disposed) return;
  requestAnimationFrame(frame);
  const dt = lastTime ? Math.min(0.05, Math.max(0, (now - lastTime) / 1000)) : 0;
  lastTime = now;
  if (!paused) {
    if (previewMode === 'growth') {
      goat.update(dt);
      growthAura.update(dt);
      growthClock += dt;
      if (growthClock >= growthStageSeconds[growthTier]) nextGrowthTier();
    } else if (previewMode === 'combo') {
      comboClock += dt;
      comboPop.update(dt);
      if (comboClock >= 1.67) emitCombo();
    } else {
    goat.update(dt);
    if (previewMode === 'launch') {
      launchClock += dt;
      launchPad.update(dt);
      if (!launchCue || launchClock >= launchCue.lifetime) emitLaunch();
      poseLaunchGoat();
    } else if (previewMode === 'trampoline') {
      trampolineClock += dt;
      trampoline.update(dt);
      if (!trampolineBurst || trampolineClock >= trampolineBurst.lifetime) {
        emitTrampoline();
      }
      poseTrampolineGoat();
    } else {
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
    headbuttClock += dt;
    if (headbuttClock >= 2.75) {
      headbuttClock %= 2.75;
      emitHeadbutt();
    }
    headbutt.update(dt);
    waterClock += dt;
    if (waterClock >= 3.2) {
      waterClock %= 3.2;
      emitWater();
    }
    water.update(dt);
    crateClock += dt;
    if (crateClock >= 3.85) {
      crateClock %= 3.85;
      emitCrate();
    }
    crate.update(dt);
    }
    }
  }

  const horizontal = Math.cos(elevation) * distance;
  camera.position.set(
    lookAt.x + Math.sin(yaw) * horizontal,
    lookAt.y + Math.sin(elevation) * distance + 0.42,
    lookAt.z + Math.cos(yaw) * horizontal,
  );
  camera.lookAt(lookAt);

  // Also catches DPR changes when a tab is dragged between displays without
  // any element or window resize event. Size changes only when values differ.
  resizeViewport();
  refreshUi();
  renderer.render(scene, camera);
}

setDirection(directionControl.value);
goat.update(0);
// Start at Kid; 01–08 seed their own previews when selected.
refreshUi();
resizeViewport();
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => {
  if (disposed) return;
  disposed = true;
  viewportObserver.disconnect();
  window.removeEventListener('resize', resizeViewport);
  dust.dispose();
  landing.dispose();
  headbutt.dispose();
  water.dispose();
  crate.dispose();
  trampoline.dispose();
  launchPad.dispose();
  comboPop.dispose();
  growthAura.dispose();
  rockGeometry.dispose();
  rockMaterial.dispose();
  goat.dispose();
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  renderer.dispose();
});
