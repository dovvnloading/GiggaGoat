import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  createWorldScene, generateIsland, hashIsland, landAreaAtTideLevel,
  type ColliderDescriptor, type IslandData, type WorldScene,
} from '../index';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing world viewer element #' + id);
  return node as T;
}
const host = element<HTMLDivElement>('app');
const seedInput = element<HTMLInputElement>('seed');
const cameraInput = element<HTMLSelectElement>('camera');
const tideInput = element<HTMLInputElement>('tide');
const tideLabel = element<HTMLOutputElement>('tide-label');
const dayInput = element<HTMLInputElement>('day');
const dayLabel = element<HTMLOutputElement>('day-label');
const labels = element<HTMLDivElement>('labels');
const stats = element<HTMLDivElement>('stats');
const poiToggle = element<HTMLInputElement>('show-pois');
const colliderToggle = element<HTMLInputElement>('show-colliders');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.25, 4000);
camera.position.set(310, 220, 390);
camera.lookAt(0, 40, 0);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 28, 0);
orbit.enableDamping = true;
orbit.minDistance = 10;
orbit.maxDistance = 950;
orbit.maxPolarAngle = Math.PI * 0.49;
const fly = new FlyControls(camera, renderer.domElement);
fly.movementSpeed = 75;
fly.rollSpeed = 0.34;
fly.dragToLook = true;
fly.autoForward = false;
fly.enabled = false;

let island: IslandData;
let worldView: WorldScene;
let colliderDebug: THREE.Group | null = null;
const labelById = new Map<string, HTMLDivElement>();
const projected = new THREE.Vector3();
const clock = new THREE.Clock();

function makeColliderGeometry(collider: ColliderDescriptor): THREE.BufferGeometry {
  if (collider.shape === 'heightfield') {
    throw new Error('Terrain wireframes are built from terrain chunks');
  }
  if (collider.shape === 'cuboid') {
    return new THREE.BoxGeometry(collider.size.x, collider.size.y, collider.size.z);
  }
  if (collider.shape === 'cylinder') {
    const radius = Math.max(collider.size.x, collider.size.z) / 2;
    return new THREE.CylinderGeometry(radius, radius, collider.size.y, 8);
  }
  const points: THREE.Vector3[] = [];
  const vertices = collider.vertices!;
  for (let i = 0; i < vertices.length; i += 3) {
    points.push(new THREE.Vector3(vertices[i]!, vertices[i + 1]!, vertices[i + 2]!));
  }
  return new ConvexGeometry(points);
}
function disposeDebug(): void {
  if (!colliderDebug) return;
  colliderDebug.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
      else object.material.dispose();
    }
  });
  colliderDebug.removeFromParent();
  colliderDebug = null;
}
function showDebug(): void {
  if (!colliderToggle.checked) {
    if (colliderDebug) colliderDebug.visible = false;
    return;
  }
  if (!colliderDebug) {
    colliderDebug = new THREE.Group();
    colliderDebug.name = 'physics-collider-preview';
    for (const chunk of worldView.chunks) {
      const overlay = new THREE.Mesh(chunk.geometry.clone(),
        new THREE.MeshBasicMaterial({
          color: 0xe6f2ff, wireframe: true, transparent: true,
          opacity: 0.18, depthTest: false,
        }));
      overlay.position.copy(chunk.position);
      colliderDebug.add(overlay);
    }
    for (const collider of island.colliders) {
      if (collider.shape === 'heightfield') continue;
      const mesh = new THREE.Mesh(makeColliderGeometry(collider),
        new THREE.MeshBasicMaterial({
          color: collider.body.type === 'dynamic' ? 0xffa85c : 0x53fae3,
          wireframe: true, transparent: true, opacity: 0.32, depthTest: false,
        }));
      const { position, rotationY } = collider.transform;
      mesh.position.set(position.x, position.y, position.z);
      mesh.rotation.y = rotationY;
      colliderDebug.add(mesh);
    }
    scene.add(colliderDebug);
  }
  colliderDebug.visible = true;
}
function updateStats(): void {
  const tide = Number(tideInput.value);
  tideLabel.value = tide.toFixed(1) + ' m';
  const area = landAreaAtTideLevel(island, tide);
  stats.textContent = 'Hash ' + hashIsland(island) +
    ' · ' + island.resolution + '² samples · ' + island.pois.length + ' POIs' +
    ' · ' + island.props.length + ' props · ' + island.relics.length + ' relics' +
    ' · Dry land ' + (area / 1_000_000).toFixed(3) + ' km²';
}
function regenerate(): void {
  if (worldView) worldView.dispose();
  disposeDebug();
  labels.replaceChildren();
  labelById.clear();
  island = generateIsland({ seed: seedInput.value, resolution: 193 });
  worldView = createWorldScene(island, { chunkSegments: 32 });
  scene.add(worldView.group);
  for (const poi of island.pois) {
    const label = document.createElement('div');
    label.className = 'poi';
    label.textContent = poi.name;
    labels.appendChild(label);
    labelById.set(poi.id, label);
  }
  tideInput.max = String(Math.ceil(island.tideLevels[island.tideLevels.length - 1]!));
  tideInput.value = '0';
  worldView.setTideLevel(0);
  worldView.setDayNight(Number(dayInput.value));
  showDebug();
  updateStats();
}
element<HTMLFormElement>('seed-form').addEventListener('submit', event => {
  event.preventDefault();
  regenerate();
});
cameraInput.addEventListener('change', () => {
  const inOrbit = cameraInput.value === 'orbit';
  orbit.enabled = inOrbit;
  fly.enabled = !inOrbit;
  if (inOrbit) orbit.target.set(0, 28, 0);
});
tideInput.addEventListener('input', () => {
  worldView.setTideLevel(Number(tideInput.value));
  updateStats();
});
dayInput.addEventListener('input', () => {
  const phase = Number(dayInput.value);
  worldView.setDayNight(phase);
  const hour = Math.floor(phase * 24);
  dayLabel.value = String(hour).padStart(2, '0') + ':00';
});
poiToggle.addEventListener('change', () => {
  labels.style.display = poiToggle.checked ? 'block' : 'none';
});
colliderToggle.addEventListener('change', showDebug);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
regenerate();
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.08);
  if (orbit.enabled) orbit.update();
  else fly.update(delta);
  worldView.updateCulling(camera);
  if (poiToggle.checked) {
    for (const poi of island.pois) {
      const node = labelById.get(poi.id)!;
      projected.set(poi.center.x, poi.center.y + (poi.id === 'mt-gigga' ? 13 : 10), poi.center.z)
        .project(camera);
      const visible = projected.z >= -1 && projected.z <= 1 &&
        Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      node.style.display = visible ? 'block' : 'none';
      if (visible) {
        node.style.left = ((projected.x * 0.5 + 0.5) * window.innerWidth).toFixed(1) + 'px';
        node.style.top = ((-projected.y * 0.5 + 0.5) * window.innerHeight).toFixed(1) + 'px';
      }
    }
  }
  renderer.render(scene, camera);
});
