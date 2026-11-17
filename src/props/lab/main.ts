import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PropFactory, type Size3, type BuildPieceType,
  getBuildPieceSize, GIG_BOARD_SIZE, SURFACE_HALF_EXTENTS,
  getSurfaceFootprint } from '../index';

const stage = document.querySelector<HTMLDivElement>('#stage');
const status = document.querySelector<HTMLDivElement>('#status');
if (!stage || !status) throw new Error('Props lab DOM is incomplete');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8e5f5);
scene.fog = new THREE.Fog(0xb8e5f5, 75, 130);
const camera = new THREE.PerspectiveCamera(48, 1, .1, 150);
camera.position.set(19, 32, 47);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.25, 0);
controls.maxPolarAngle = Math.PI * .49;
controls.maxDistance = 112;
controls.minDistance = 8;

scene.add(new THREE.HemisphereLight(0xffffff, 0x88976a, 2.1));
const sun = new THREE.DirectionalLight(0xfff4d6, 3.0);
sun.position.set(-17, 33, 23);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -58;
sun.shadow.camera.right = 58;
sun.shadow.camera.top = 58;
sun.shadow.camera.bottom = -58;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(170, 170),
  new THREE.MeshToonMaterial({ color: 0xc5d78f }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(78, 78, 0x9cb16d, 0xb6c77c);
grid.position.y = .015;
scene.add(grid);

const factory = new PropFactory();
const oldMaterials: THREE.Material[] = [];
const oldGeometries: THREE.BufferGeometry[] = [];
const labels: THREE.CanvasTexture[] = [];

function oldMaterial(hex: number): THREE.Material {
  const mat = new THREE.MeshToonMaterial({ color: hex, side: THREE.DoubleSide });
  oldMaterials.push(mat);
  return mat;
}
function oldMesh(parent: THREE.Group, geometry: THREE.BufferGeometry,
  hex: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, oldMaterial(hex));
  oldGeometries.push(geometry);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function oldBox(parent: THREE.Group, s: Size3, hex: number,
  x = 0, y = 0, z = 0): void {
  oldMesh(parent, new THREE.BoxGeometry(s.x, s.y, s.z), hex, x, y, z);
}
function oldRamp(parent: THREE.Group): void {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -1,-.9,-1, 1,-.9,-1, -1,-.9,1,
    1,-.9,1, -1,.9,1, 1,.9,1,
  ], 3));
  geo.setIndex([0,2,1, 1,2,3, 2,4,3, 3,4,5, 0,1,4, 1,5,4, 0,4,2, 1,3,5]);
  geo.computeVertexNormals();
  oldMesh(parent, geo, 0xc9924f);
}
function oldMarker(kind: 'trampoline' | 'launch'): THREE.Group {
  const group = new THREE.Group();
  const half = SURFACE_HALF_EXTENTS;
  oldBox(group, getSurfaceFootprint(half), kind === 'trampoline' ? 0x7a4cff : 0xff891e,
    0, half.y + .09, 0);
  const rim = oldMesh(group, new THREE.TorusGeometry(1.6, .105, 7, 24),
    0xffd833, 0, half.y + .19, 0);
  rim.rotation.x = -Math.PI / 2;
  if (kind === 'launch') {
    const arrow = oldMesh(group, new THREE.ConeGeometry(.7, 1.6, 3),
      0xfff3cc, 0, half.y + .22, 0);
    arrow.rotation.x = -Math.PI / 2;
  }
  return group;
}
function oldBoard(): THREE.Group {
  const group = new THREE.Group();
  oldMesh(group, new THREE.CylinderGeometry(.23, .3, 3, 6), 0xffd833, 0, 1.5, 0);
  oldBox(group, { x: 3.6, y: 1.9, z: .32 }, 0x6542b9, 0, 3.3, 0);
  return group;
}

type OldKind = 'board' | 'crate' | 'debris' | 'trampoline' | 'launch'
  | 'hay' | 'barrel' | BuildPieceType;
interface Sample {
  label: string;
  legacy: OldKind;
  size: Size3;
  height: number;
  create: () => THREE.Group;
}
const crate = { x: 1.5, y: 1.5, z: 1.5 };
const debris = { x: .55, y: .55, z: .55 };
const gigHay = { x: 2.1, y: 1.2, z: 1.5 };
const gigBarrel = { x: 1.3, y: 1.7, z: 1.3 };
const gigSupply = { x: 1.7, y: 1.4, z: 1.6 };
const surface = getSurfaceFootprint();
const build = (type: BuildPieceType): Sample => ({
  label: 'BUILD · ' + type.toUpperCase(), legacy: type, size: getBuildPieceSize(type),
  height: type === 'wall' ? 1 : type === 'ramp' ? .9 : .23,
  create: () => factory.createBuildPiece(type),
});
const samples: Sample[] = [
  { label: 'GIG CLIPBOARD', legacy: 'board', size: GIG_BOARD_SIZE,
    height: 0, create: () => factory.createGigBoard() },
  { label: 'SUPPLY CRATE', legacy: 'crate', size: crate,
    height: .75, create: () => factory.createCrate(crate) },
  { label: 'CRATE DEBRIS', legacy: 'debris', size: debris,
    height: .275, create: () => factory.createCrateDebris(.55) },
  { label: 'TRAMPOLINE', legacy: 'trampoline', size: surface,
    height: .22, create: () => factory.createTrampoline() },
  { label: 'LAUNCH MARKER', legacy: 'launch', size: surface,
    height: .22, create: () => factory.createLaunchPad() },
  { label: 'GIG · HAY', legacy: 'hay', size: gigHay,
    height: .6, create: () => factory.createGigProp(gigHay, 'hay') },
  { label: 'GIG · BARREL', legacy: 'barrel', size: gigBarrel,
    height: .85, create: () => factory.createGigProp(gigBarrel, 'barrel') },
  { label: 'GIG · SUPPLIES', legacy: 'crate', size: gigSupply,
    height: .7, create: () => factory.createGigProp(gigSupply, 'crate') },
  build('floor'), build('wall'), build('ramp'), build('launch-pad'),
];

function makeLegacy(s: Sample): THREE.Group {
  if (s.legacy === 'board') return oldBoard();
  if (s.legacy === 'trampoline' || s.legacy === 'launch') return oldMarker(s.legacy);
  const root = new THREE.Group();
  if (s.legacy === 'ramp') oldRamp(root);
  else oldBox(root, s.size, s.legacy === 'hay' || s.legacy === 'floor'
    ? 0xf2c14f : s.legacy === 'launch-pad' ? 0xff891e :
      s.legacy === 'wall' ? 0xe8aa57 : 0x8f67a7);
  return root;
}

function label(text: string, x: number, z: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff2c4';
  ctx.strokeStyle = '#a66a34';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(8, 8, 752, 112, 26);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5b3921';
  ctx.font = '900 48px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 384, 65);
  const texture = new THREE.CanvasTexture(canvas);
  labels.push(texture);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false,
  }));
  sprite.scale.set(6.4, 1.07, 1);
  sprite.position.set(x, 5.3, z - 2.5);
  scene.add(sprite);
}
const roots: THREE.Group[] = [];
samples.forEach((sample, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const centerX = (col - 1) * 13;
  const centerZ = (row - 1.5) * 9.5;
  const before = makeLegacy(sample);
  const after = sample.create();
  before.position.set(centerX - 2.5, sample.height, centerZ);
  after.position.set(centerX + 2.5, sample.height, centerZ);
  scene.add(before, after);
  roots.push(before, after);
  label(sample.label, centerX, centerZ);
  label('BOX', centerX - 2.5, centerZ + 2.6);
  label('LIBRARY', centerX + 2.5, centerZ + 2.6);
});
status.textContent = 'Fetching CC0 library models…';
void factory.whenReady().then(() => {
  const ready = roots.filter(r => r.userData.assetStatus === 'ready').length;
  const fallback = roots.filter(r => r.userData.assetStatus === 'fallback').length;
  status.textContent = ready + ' library props ready' +
    (fallback ? ' · ' + fallback + ' fallback' : ' · all models loaded');
});

function resize(): void {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
window.addEventListener('beforeunload', () => {
  renderer.setAnimationLoop(null);
  controls.dispose();
  factory.dispose();
  for (const geo of oldGeometries) geo.dispose();
  for (const material of oldMaterials) material.dispose();
  for (const texture of labels) texture.dispose();
  renderer.dispose();
});
