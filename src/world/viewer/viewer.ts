import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  createWorldScene, generateIsland, hashIsland, heightAt, landAreaAtTideLevel,
  type ColliderDescriptor, type IslandData, type WorldScene,
} from '../index';
import { applyBookmarkCamera, ART_BOOKMARKS, findBookmark } from './bookmarks';
import { updateOrbitCamera } from './orbit-terrain';
import { paintingAssetUrl } from './reference-art';
import { createStaticShadowCache } from './shadow-cache';
import { createAdaptiveViewerResolution } from './adaptive-resolution';
import { SKY_HORIZON_COLOR } from '../visual-sky';

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
const bookmarkInput = element<HTMLSelectElement>('bookmark');
const compareToggle = element<HTMLInputElement>('compare');
const presetInput = element<HTMLSelectElement>('preset');
const reference = element<HTMLElement>('reference');
const referenceImage = element<HTMLImageElement>('reference-image');
const referenceCaption = element<HTMLElement>('reference-caption');
const performance = element<HTMLElement>('perf');
const captureButton = element<HTMLButtonElement>('capture-all');
for (const bookmark of ART_BOOKMARKS) {
  const option = document.createElement('option');
  option.value = bookmark.id;
  option.textContent = bookmark.label;
  bookmarkInput.appendChild(option);
}
bookmarkInput.value = '07';

const renderer = new THREE.WebGLRenderer({ antialias: true });
const resolutionBudget = createAdaptiveViewerResolution(window.devicePixelRatio);
renderer.setPixelRatio(resolutionBudget.ratio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// These static casters/light need one shadow pass per change, not one every frame.
const shadowCache = createStaticShadowCache(renderer.shadowMap);
// Match the game (no tone mapping): ACES at 1.2 exposure bleached the
// painting's pastels toward cream, so the Lab no longer showed real colours.
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.25, 4000);
camera.position.set(310, 220, 390);
camera.lookAt(0, 40, 0);

const orbitCamera = camera.clone();
const orbit = new OrbitControls(orbitCamera, renderer.domElement);
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

// The standalone world viewer needs a visible scale/avatar reference for the
// street-level third-person paintings, without importing anything from core.
function makeStreetGoat(): THREE.Group {
  const goat = new THREE.Group();
  goat.name = 'street-bookmark-goat';
  const cream = new THREE.MeshToonMaterial({ color: 0xf4e5bb });
  const tan = new THREE.MeshToonMaterial({ color: 0xbd9264 });
  const hoof = new THREE.MeshToonMaterial({ color: 0x62574c });
  const scarf = new THREE.MeshToonMaterial({ color: 0xff891e });
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 1), cream);
  body.scale.set(0.95, 0.68, 1.5);
  body.position.y = 1.48;
  goat.add(body);
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.53, 1), cream);
  head.position.set(0, 1.93, -1.08);
  head.scale.set(0.9, 1.02, 1.0);
  goat.add(head);
  const muzzle = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), tan);
  muzzle.position.set(0, 1.72, -1.50);
  muzzle.scale.set(1.1, 0.73, 0.75);
  goat.add(muzzle);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.47, 6), tan);
    horn.position.set(side * 0.32, 2.48, -1.07);
    horn.rotation.z = side * 0.33;
    goat.add(horn);
    const ear = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25, 0), tan);
    ear.position.set(side * 0.55, 2.13, -1.05);
    ear.scale.set(0.93, 0.30, 0.63);
    goat.add(ear);
    for (const front of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 1.07, 6), cream);
      leg.position.set(side * 0.44, 0.61, front * 0.67);
      goat.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.17, 0.29), hoof);
      shoe.position.set(side * 0.44, 0.12, front * 0.67 - 0.05);
      goat.add(shoe);
    }
  }
  const bandana = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.13, 5, 12), scarf);
  bandana.rotation.x = Math.PI / 2;
  bandana.position.set(0, 1.61, -0.85);
  goat.add(bandana);
  goat.visible = false;
  goat.traverse(part => { if (part instanceof THREE.Mesh) part.castShadow = false; });
  return goat;
}
const streetGoat = makeStreetGoat();
scene.add(streetGoat);

let island: IslandData;
let worldView: WorldScene;
function updateCameraControls(delta: number): void {
  if (orbit.enabled) updateOrbitCamera(camera, orbit, island);
  else fly.update(delta);
}
function setCameraAspect(aspect: number): void {
  camera.aspect = orbitCamera.aspect = aspect;
  camera.updateProjectionMatrix();
  orbitCamera.updateProjectionMatrix();
}
function syncFogColor(): void {
  scene.fog?.color.copy(worldView.fogColor);
  renderer.setClearColor(worldView.fogColor);
}
function applyDayNight(phase: number): void {
  worldView.setDayNight(phase);
  syncFogColor();
}
// Share the invalidation path with the live viewer and the bookmark exporter.
function renderWorldFrame(): void {
  if (worldView.updateCulling(camera)) shadowCache.invalidate();
  shadowCache.beforeRender();
  renderer.render(scene, camera);
}
let colliderDebug: THREE.Group | null = null;
const labelById = new Map<string, HTMLDivElement>();
const projected = new THREE.Vector3();
const clock = new THREE.Clock();
let elapsed = 0;
let fps = 60;
let sampleSeconds = 0;
let capturing = false;

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
      const { position, rotationY, rotationX = 0 } = collider.transform;
      mesh.position.set(position.x, position.y, position.z);
      mesh.rotation.set(rotationX, rotationY, 0, 'YXZ');
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
  scene.fog = new THREE.Fog(SKY_HORIZON_COLOR, island.size * 0.9, island.size * 3.2);
  worldView = createWorldScene(island, { chunkSegments: 32 });
  shadowCache.invalidate();
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
  applyDayNight(Number(dayInput.value));
  showDebug();
  updateStats();
  applyBookmark(bookmarkInput.value);
}
function applyBookmark(id: string): void {
  const mark = findBookmark(id);
  if (!mark || !worldView) return;
  // Bookmark 08 is explicitly a third-person village composition; 11 uses
  // the same foreground scale reference among the downtown shop fronts.
  streetGoat.visible = id === '08' || id === '11';
  if (streetGoat.visible) {
    const scale = island.size / 600;
    // At bookmark 11 the art places a small goat at the left foreground,
    // not directly on the camera's central ray (which clipped its horns).
    // Hoofington's bookmark-08 framing is intentionally unchanged.
    const goatX = mark.camera.x - (id === '11' ? 4.4 : 0) * scale;
    const goatZ = mark.camera.z - (id === '11' ? 14 : 6.5) * scale;
    streetGoat.position.set(goatX, heightAt(island, goatX, goatZ), goatZ);
    streetGoat.scale.setScalar(scale * (id === '11' ? 0.78 : 1));
  }
  orbit.enabled = true;
  fly.enabled = false;
  cameraInput.value = 'orbit';
  applyBookmarkCamera(orbitCamera, orbit, mark);
  camera.fov = mark.fov;
  camera.updateProjectionMatrix();
  updateOrbitCamera(camera, orbit);
  dayInput.value = String(mark.day);
  applyDayNight(mark.day);
  shadowCache.invalidate();
  const hour = Math.floor(mark.day * 24);
  dayLabel.value = String(hour).padStart(2, '0') + ':00';
  presetInput.value = mark.day < 0.1 ? 'night' : mark.day < 0.35 ? 'golden-hour' : 'day';
  tideInput.value = String(mark.tide);
  worldView.setTideLevel(mark.tide);
  referenceImage.src = paintingAssetUrl(mark.image);
  referenceImage.alt = mark.label + ' environment concept art';
  referenceCaption.textContent = mark.label + ' · live view / original painting';
  reference.hidden = !compareToggle.checked;
  updateStats();
}
/**
 * A single downloadable contact sheet: at 1024×768 each, all 11 rendered
 * bookmarks at left and the original paintings at right. This deliberately
 * uses the actual WebGLRenderer/camera rather than an unrendered mockup.
 */
async function captureAllBookmarks(): Promise<void> {
  if (capturing) return;
  capturing = true;
  captureButton.disabled = true;
  const originalLabel = captureButton.textContent;
  const saved = {
    id: bookmarkInput.value,
    position: camera.position.clone(),
    orbitPosition: orbitCamera.position.clone(),
    quaternion: camera.quaternion.clone(),
    fov: camera.fov,
    target: orbit.target.clone(),
    orbitEnabled: orbit.enabled,
    flyEnabled: fly.enabled,
    cameraMode: cameraInput.value,
    day: dayInput.value,
    tide: tideInput.value,
    preset: presetInput.value,
    compare: compareToggle.checked,
    pixelRatio: renderer.getPixelRatio(),
  };
  const width = 1024, height = 768, captionHeight = 35;
  const rowHeight = height + captionHeight;
  const sheet = document.createElement('canvas');
  sheet.width = width * 2;
  sheet.height = rowHeight * ART_BOOKMARKS.length;
  const ctx = sheet.getContext('2d');
  try {
    if (!ctx) throw new Error('2D canvas unavailable');
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    setCameraAspect(width / height);
    for (const [row, mark] of ART_BOOKMARKS.entries()) {
      captureButton.textContent = 'Capturing ' + (row + 1) + ' / ' + ART_BOOKMARKS.length;
      applyBookmark(mark.id);
      setCameraAspect(width / height);
      renderWorldFrame();
      const y = row * rowHeight;
      // Copy immediately after render, before WebGL clears its backbuffer.
      ctx.drawImage(renderer.domElement, 0, y, width, height);
      const painting = new Image();
      painting.src = paintingAssetUrl(mark.image);
      await painting.decode();
      const factor = Math.min(width / painting.naturalWidth, height / painting.naturalHeight);
      const w = painting.naturalWidth * factor, h = painting.naturalHeight * factor;
      ctx.fillStyle = '#172b39';
      ctx.fillRect(width, y, width, height);
      ctx.drawImage(painting, width + (width - w) / 2, y + (height - h) / 2, w, h);
      ctx.fillStyle = '#132235';
      ctx.fillRect(0, y + height, width * 2, captionHeight);
      ctx.fillStyle = '#f1f8ff';
      ctx.font = '18px sans-serif';
      ctx.fillText(mark.label + ' — live / seed ' + seedInput.value, 15, y + height + 24);
      ctx.fillText('Concept painting · ' + mark.image, width + 15, y + height + 24);
    }
    const blob = await new Promise<Blob>((resolve, reject) => sheet.toBlob(
      output => output ? resolve(output) : reject(new Error('PNG encoding failed')), 'image/png'));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'billy-isle-' + seedInput.value.replace(/[^a-z0-9_-]/gi, '_') +
      '-bookmark-comparison.png';
    link.click();
    // Browsers must have time to consume the object URL after the click.
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (error) {
    console.error('Bookmark comparison capture failed:', error);
    captureButton.textContent = 'Capture failed (see console)';
  } finally {
    applyBookmark(saved.id);
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    orbitCamera.position.copy(saved.orbitPosition);
    camera.fov = orbitCamera.fov = saved.fov;
    setCameraAspect(window.innerWidth / window.innerHeight);
    orbit.target.copy(saved.target);
    orbit.enabled = saved.orbitEnabled;
    fly.enabled = saved.flyEnabled;
    cameraInput.value = saved.cameraMode;
    bookmarkInput.value = saved.id;
    dayInput.value = saved.day;
    tideInput.value = saved.tide;
    presetInput.value = saved.preset;
    compareToggle.checked = saved.compare;
    reference.hidden = !saved.compare;
    applyDayNight(Number(saved.day));
    shadowCache.invalidate();
    worldView.setTideLevel(Number(saved.tide));
    const hour = Math.floor(Number(saved.day) * 24);
    dayLabel.value = String(hour).padStart(2, '0') + ':00';
    updateStats();
    renderer.setPixelRatio(saved.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    capturing = false;
    captureButton.disabled = false;
    if (captureButton.textContent?.startsWith('Capturing')) {
      captureButton.textContent = originalLabel;
    }
  }
}
captureButton.addEventListener('click', () => { void captureAllBookmarks(); });

element<HTMLFormElement>('seed-form').addEventListener('submit', event => {
  event.preventDefault();
  regenerate();
});
cameraInput.addEventListener('change', () => {
  const inOrbit = cameraInput.value === 'orbit';
  if (inOrbit) orbitCamera.position.copy(camera.position);
  orbit.enabled = inOrbit;
  fly.enabled = !inOrbit;
  streetGoat.visible = inOrbit &&
    (bookmarkInput.value === '08' || bookmarkInput.value === '11');
  // Preserve the current reference-art camera target on return to Orbit.
});
bookmarkInput.addEventListener('change', () => applyBookmark(bookmarkInput.value));
compareToggle.addEventListener('change', () => {
  reference.hidden = !compareToggle.checked;
});
presetInput.addEventListener('change', () => {
  const preset = presetInput.value as 'day' | 'golden-hour' | 'night';
  worldView.setLightingPreset(preset);
  syncFogColor();
  shadowCache.invalidate();
  const phase = preset === 'day' ? 0.5 : preset === 'golden-hour' ? 0.285 : 0.025;
  dayInput.value = String(phase);
  dayLabel.value = String(Math.floor(phase * 24)).padStart(2, '0') + ':00';
});
tideInput.addEventListener('input', () => {
  worldView.setTideLevel(Number(tideInput.value));
  updateStats();
});
dayInput.addEventListener('input', () => {
  const phase = Number(dayInput.value);
  applyDayNight(phase);
  shadowCache.invalidate();
  const hour = Math.floor(phase * 24);
  dayLabel.value = String(hour).padStart(2, '0') + ':00';
});
poiToggle.addEventListener('change', () => {
  labels.style.display = poiToggle.checked ? 'block' : 'none';
});
colliderToggle.addEventListener('change', showDebug);
window.addEventListener('resize', () => {
  setCameraAspect(window.innerWidth / window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
});
regenerate();
// Optional browser profiling bridge. Not active in normal viewer sessions.
// The benchmark synchronously waits for WebGL completion to measure actual
// frame cost rather than mistaking a 60 Hz rAF cadence for GPU throughput.
if (new URLSearchParams(window.location.search).has('profile')) {
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  Object.assign(window, {
    __worldProfile: {
      pixelRatio(ratio: number): void {
        renderer.setPixelRatio(THREE.MathUtils.clamp(ratio, 0.5, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
      },
      water(visible: boolean): void { worldView.water.visible = visible; },
      sky(visible: boolean): void {
        const dome = worldView.group.getObjectByName('gradient-sky');
        if (dome) dome.visible = visible;
      },
      shadows(enabled: boolean): void {
        renderer.shadowMap.enabled = enabled;
        if (enabled) shadowCache.invalidate();
      },
      outlines(visible: boolean): void {
        // Culling owns mesh.visible and would restore an outline next frame;
        // the material switch makes this pass-disabled diagnostic stable.
        worldView.group.traverse(object => {
          if (object.name.startsWith('outline-') && object instanceof THREE.Mesh) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) material.visible = visible;
          }
        });
      },
      /** Debug rendered geometry including instanced copies at the active camera. */
      meshCosts(): { name: string; triangles: number }[] {
        worldView.group.updateMatrixWorld(true);
        const clip = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4()
          .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const result: { name: string; triangles: number }[] = [];
        worldView.group.traverse(node => {
          if (!(node instanceof THREE.Mesh) || !node.visible) return;
          let ancestor = node.parent;
          while (ancestor && ancestor !== worldView.group) {
            if (!ancestor.visible) return;
            ancestor = ancestor.parent;
          }
          if (node.frustumCulled && !clip.intersectsObject(node)) return;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          if (!materials.some(mat => mat.visible)) return;
          const vertices = node.geometry.index?.count ??
            node.geometry.getAttribute('position')?.count ?? 0;
          const instances = node instanceof THREE.InstancedMesh ? node.count : 1;
          result.push({ name: node.name || node.parent?.name || node.type,
            triangles: Math.floor(vertices * instances / 3) });
        });
        return result.sort((a, b) => b.triangles - a.triangles).slice(0,45);
      },
      /** Profiling-only QA: confirm the authored Dam is on screen at bookmark 14. */
      damHeroState(): { loaded: boolean; inFrame: boolean;
        reservoirHidden: boolean; camera: number[]; target: number[] } {
        const model = worldView.group.getObjectByName('the-dam-model');
        const clip = model?.getWorldPosition(new THREE.Vector3()).project(camera);
        return {
          loaded: Boolean(model),
          inFrame: Boolean(clip && clip.z >= -1 && clip.z <= 1 &&
            Math.abs(clip.x) < 1 && Math.abs(clip.y) < 1),
          reservoirHidden: worldView.group.getObjectByName('dam-reservoir')?.visible !== true,
          camera: camera.position.toArray(),
          target: orbit.target.toArray(),
        };
      },
      /** Source-model QA at the painting's bookmark-11 camera. */
      downtownState(): { loaded: boolean; models: number; triangles: number;
        signs: number; awnings: boolean } {
        const root = worldView.group.getObjectByName('downtown-library-models');
        const batch = root?.getObjectByName('downtown-library-batched');
        return {
          loaded: root?.userData['ready'] === true && batch instanceof THREE.Mesh,
          models: Number(root?.userData['loadedModels'] ?? 0),
          triangles: root?.children.reduce((count, node) =>
            node instanceof THREE.Mesh && node.name.startsWith('downtown-library-batched')
              ? count + (node.geometry.index?.count ??
                node.geometry.getAttribute('position').count) / 3 : count, 0) ?? 0,
          signs: Number(root?.userData['signCount'] ?? 0),
          awnings: Boolean(root?.getObjectByName('downtown-striped-awnings')),
        };
      },
      /** Real-Chrome QA: all sourced prop batches must finish without fallbacks. */
      propLibraryState(): { ready: boolean; loaded: number; failed: number; pending: number } {
        const root = worldView.group.getObjectByName('handcrafted-props');
        return {
          ready: root?.userData['libraryReady'] === true,
          loaded: Number(root?.userData['libraryLoaded'] ?? 0),
          failed: Number(root?.userData['libraryFailed'] ?? 0),
          pending: Number(root?.userData['libraryPending'] ?? 0),
        };
      },
      /** Runtime QA for the painting's sourced-village asset handoff. */
      hoofingtonState(): { loaded: boolean; models: number; triangles: number } {
        const root = worldView.group.getObjectByName('hoofington-library-models');
        const batch = root?.getObjectByName('hoofington-library-batched');
        return {
          loaded: root?.userData['ready'] === true && batch instanceof THREE.Mesh,
          models: Number(root?.userData['loadedModels'] ?? 0),
          triangles: root?.children.reduce((count, node) =>
            node instanceof THREE.Mesh && node.name.startsWith('hoofington-library-batched')
              ? count + (node.geometry.index?.count ??
                node.geometry.getAttribute('position').count) / 3 : count, 0) ?? 0,
        };
      },
      measure(frames = 16): {
        frameTimesMs: number[]; drawCalls: number; triangles: number;
        width: number; height: number; pixelRatio: number; gpu: string;
      } {
        const frameTimesMs: number[] = [];
        for (let i = 0; i < frames + 4; i++) {
          const start = window.performance.now();
          worldView.update(elapsed + i / 60);
          updateCameraControls(1 / 60);
          renderWorldFrame();
          gl.finish();
          if (i >= 4) frameTimesMs.push(window.performance.now() - start);
        }
        return {
          frameTimesMs,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          width: renderer.domElement.width,
          height: renderer.domElement.height,
          pixelRatio: renderer.getPixelRatio(),
          gpu: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) :
            gl.getParameter(gl.RENDERER)),
        };
      },
    },
  });
}
renderer.setAnimationLoop(() => {
  if (capturing) return;
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.08);
  // Measure real delivered-frame time, including browser composition. A tab
  // coming back from suspension must never be interpreted as a slow GPU.
  const nextRatio = document.hidden ? null : resolutionBudget.frame(rawDelta);
  if (nextRatio !== null) {
    renderer.setPixelRatio(nextRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  elapsed += delta;
  fps = fps * 0.90 + (1 / Math.max(delta, 0.001)) * 0.10;
  sampleSeconds += delta;
  worldView.update(elapsed);
  updateCameraControls(delta);
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
  renderWorldFrame();
  if (sampleSeconds >= 0.4) {
    const info = renderer.info.render;
    performance.textContent = 'FPS ' + fps.toFixed(0) +
      ' · Draw calls ' + info.calls.toLocaleString() +
      ' · Triangles ' + info.triangles.toLocaleString() +
      ' · Meshes ' + island.props.length.toLocaleString() +
      ' · Resolution ' + renderer.getPixelRatio().toFixed(2) + '×';
    sampleSeconds = 0;
  }
});
