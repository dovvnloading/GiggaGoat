import * as THREE from 'three';
import { simplifiedWorldGeometry } from './lod';
import { kitShape, kitPreview } from './kit-preview';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData, PropDescriptor, PropKind } from './types';
import { gridSample } from './terrain';
import { fitLibraryModel, isAuthoredLibraryAsset } from './library-fit';
import { TOON_RAMP, BUILDING_RAMP } from './visual-props';
import type { AccessSection } from './access-path';
import { groundUV, type ApplyGroundMap } from './district-ground';
import { LIGHTHOUSE_FOOTPATH, capeSurface, keeperCottagePiers, lighthouseAccess,
  lighthouseOuterGuard } from './lighthouse-access';
import { accessArrows, accessPathVisual } from './visual-access-path';

export interface LighthouseVisuals {
  group: THREE.Group;
  isFallbackHidden(mesh: THREE.InstancedMesh): boolean;
  setLighting(daylight: number, golden: number): void;
  updateCulling(position: THREE.Vector3): void;
  dispose(): void;
}

interface Placement {
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  yaw?: number; pitch?: number; roll?: number;
}

const STONE = 0xa7a8af;
const CLIFF_STONE = 0x8c919e; // The terrain shader's exposed rock swatch.
const WOOD = 0x97603d;
const DARK_WOOD = 0x63432e;
const CREAM = 0xf6e6c5;
const GOLD = 0xffcf56;

type ToonShader = Parameters<THREE.Material['onBeforeCompile']>[0];

/** A local material grade shared by the cape's terrain and its cliff boulders. */
export function makeCapeLighting(island: IslandData) {
  const centre = island.pois.find(poi => poi.id === 'old-lighthouse')!.center;
  const uniforms = {
    uCapeCentre: { value: new THREE.Vector2(centre.x, centre.z) },
    uCapeScale: { value: island.size / 600 },
    uCapeGolden: { value: 0 },
    uCapeSun: { value: new THREE.Vector3(1, 0, 0) },
  };
  return {
    setSun(golden: number, direction: THREE.Vector3): void {
      uniforms.uCapeGolden.value = golden;
      uniforms.uCapeSun.value.set(direction.x, 0.15, direction.z).normalize();
    },
    paint(shader: ToonShader): void {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec2 uCapeCentre;
uniform float uCapeScale, uCapeGolden;
uniform vec3 uCapeSun;`).replace('#include <normal_fragment_begin>', `
if (uCapeGolden > 0.001) {
  vec3 capeFace = cross(dFdx(vWorld), dFdy(vWorld));
  float capeRadius = length(vWorld.xz - uCapeCentre) / uCapeScale;
  float capeFade = uCapeGolden * (1.0 - smoothstep(32.0, 41.0, capeRadius));
  if (capeFade > 0.001) {
    vec3 face = normalize(capeFace) * (gl_FrontFacing ? 1.0 : -1.0);
    float sunFacing = smoothstep(-0.18, 0.62, dot(face, uCapeSun));
    float skylitRim = smoothstep(7.0, 17.0, vWorld.y / uCapeScale) *
      smoothstep(0.24, 0.58, face.y) * (1.0 - smoothstep(0.74, 0.98, face.y));
    float key = max(sunFacing, 0.68 * skylitRim);
    vec3 coolStone = diffuseColor.rgb * vec3(0.81, 0.90, 1.14);
    vec3 warmEdge = diffuseColor.rgb * vec3(1.18, 1.06, 0.87) + vec3(0.046, 0.015, 0.002);
    float steep = 1.0 - smoothstep(0.6, 0.95, face.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(coolStone, warmEdge, key),
      capeFade * (0.28 + 0.72 * steep));
  }
}
#include <normal_fragment_begin>`);
    },
  };
}

function makeBeacon(tower: PropDescriptor, scale: number) {
  const p = tower.transform.position;
  // Match the twelve open glass faces in the shipped source model and the
  // shared baker's 98% envelope. The iron frame keeps its original geometry.
  const pane = new THREE.CylinderGeometry(1.95, 1.95, 3.2, 12, 1, true);
  const yScale = 0.98 * tower.size.y / 29;
  pane.scale(0.98 * tower.size.x / 9, yScale, 0.98 * tower.size.z / 9);
  const glow = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uGlow: glow },
    fog: true,
    vertexShader: `
varying vec2 vPane;
#include <fog_pars_vertex>
void main() {
  vPane = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `
uniform float uGlow;
varying vec2 vPane;
#include <fog_pars_fragment>
void main() {
  float lens = 1.0 - smoothstep(0.13, 0.49, abs(vPane.y - 0.52));
  float ridges = 0.5 + 0.5 * cos(vPane.y * 42.0);
  vec3 glass = mix(vec3(0.52, 0.31, 0.14), vec3(0.96, 0.76, 0.45), 0.32 + 0.48 * lens);
  vec3 fire = mix(vec3(1.0, 0.53, 0.13), vec3(1.0, 0.99, 0.83),
    lens * (0.92 + 0.08 * ridges));
  gl_FragColor = sRGBTransferEOTF(vec4(mix(glass, fire, uGlow), 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  const glass = new THREE.Mesh(pane, material);
  glass.name = 'lighthouse-glowing-lantern-room';
  glass.position.set(p.x, p.y + 7.7 * yScale, p.z);
  glass.rotation.y = tower.transform.rotationY;

  const pixels = 32;
  const rgba = new Uint8Array(pixels * pixels * 4);
  for (let row = 0; row < pixels; row++) for (let column = 0; column < pixels; column++) {
    const radius = Math.hypot((column + 0.5) * 2 / pixels - 1, (row + 0.5) * 2 / pixels - 1);
    const i = (row * pixels + column) * 4;
    rgba.fill(255, i, i + 3);
    rgba[i + 3] = Math.round(220 * (1 - THREE.MathUtils.smoothstep(radius, 0.07, 0.96)) ** 2);
  }
  const falloff = new THREE.DataTexture(rgba, pixels, pixels);
  falloff.magFilter = THREE.LinearFilter;
  falloff.minFilter = THREE.LinearFilter;
  falloff.needsUpdate = true;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xffb74a, map: falloff, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true, opacity: 0, transparent: true,
  }));
  halo.name = 'lighthouse-lantern-halo';
  halo.position.copy(glass.position);
  halo.scale.set(13.5 * scale, 8.4 * scale, 1);
  halo.visible = false;
  return {
    glass, halo,
    setLighting(daylight: number, golden: number): void {
      glow.value = Math.max(golden * 0.96, 1 - THREE.MathUtils.smoothstep(daylight, 0.05, 0.7));
      halo.visible = glow.value > 0.02;
      halo.material.opacity = 0.53 * glow.value;
    },
    dispose(): void { falloff.dispose(); halo.material.dispose(); },
  };
}

/**
 * MeshToonMaterial does not declare flatShading in Three.js's r187 TS types,
 * but WebGLRenderer checks this shader flag for flat face normals.
 */
function rockToonMaterial(color: number | THREE.Color): THREE.MeshToonMaterial {
  return Object.assign(new THREE.MeshToonMaterial({
    color, gradientMap: BUILDING_RAMP, side: THREE.DoubleSide,
  }), { flatShading: true });
}

/** Merge all painted parts into one vertex-coloured mesh per landmark. */
function makePainter() {
  const painted: THREE.BufferGeometry[] = [];
  function add(geometry: THREE.BufferGeometry, color: number, at: Placement): void {
    const unpacked = geometry.index ? geometry.toNonIndexed() : geometry;
    if (unpacked !== geometry) geometry.dispose();
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(at.x, at.y, at.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        at.pitch ?? 0, at.yaw ?? 0, at.roll ?? 0, 'YXZ',
      )),
      new THREE.Vector3(at.width, at.height, at.depth),
    );
    unpacked.applyMatrix4(transform);
    unpacked.computeVertexNormals();
    const paint = new THREE.Color(color);
    const count = unpacked.getAttribute('position').count;
    const vertexColors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      vertexColors[i * 3] = paint.r;
      vertexColors[i * 3 + 1] = paint.g;
      vertexColors[i * 3 + 2] = paint.b;
    }
    unpacked.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
    painted.push(unpacked);
  }
  function box(color: number, x: number, y: number, z: number,
    width: number, height: number, depth: number,
    yaw = 0, roll = 0): void {
    add(new THREE.BoxGeometry(1, 1, 1), color,
      { x, y, z, width, height, depth, yaw, roll });
  }
  function beam(color: number, from: THREE.Vector3, to: THREE.Vector3,
    radius: number): void {
    const direction = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 6);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), direction.normalize(),
    ));
    add(geometry, color, {
      x: (from.x + to.x) / 2, y: (from.y + to.y) / 2,
      z: (from.z + to.z) / 2, width: 1, height: 1, depth: 1,
    });
  }
  function finish(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const geometry = mergeGeometries(painted, false);
    painted.forEach(part => part.dispose());
    if (!geometry) throw new Error('Cannot batch lighthouse landmark ' + name);
    const material = new THREE.MeshToonMaterial({
      color: 0xffffff, side: THREE.DoubleSide, vertexColors: true,
      gradientMap: TOON_RAMP,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name + '-merged-colours';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    return group;
  }
  return { add, box, beam, finish };
}

/**
 * Batch the fixed cape furnishings and harbor art in world space.
 * Groups remain as named semantic anchors for art inspection and gameplay.
 */
function batchHeroMeshes(root: THREE.Group, name: string,
  select: (mesh: THREE.Mesh) => boolean): THREE.Mesh {
  root.updateMatrixWorld(true);
  const sources: THREE.Mesh[] = [];
  root.traverse(item => {
    if (item instanceof THREE.Mesh && select(item)) sources.push(item);
  });
  const pieces: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();
  const instanceColor = new THREE.Color();
  for (const source of sources) {
    const material = Array.isArray(source.material)
      ? source.material[0]! : source.material;
    const base = 'color' in material && material.color instanceof THREE.Color
      ? material.color : new THREE.Color(0xffffff);
    const instances = source instanceof THREE.InstancedMesh ? source.count : 1;
    for (let i = 0; i < instances; i++) {
      const geometry = source.geometry.index
        ? source.geometry.toNonIndexed() : source.geometry.clone();
      const transform = source.matrixWorld.clone();
      if (source instanceof THREE.InstancedMesh) {
        source.getMatrixAt(i, matrix);
        transform.multiply(matrix);
        if (source.instanceColor) source.getColorAt(i, instanceColor);
        else instanceColor.setHex(0xffffff);
      } else instanceColor.setHex(0xffffff);
      geometry.applyMatrix4(transform);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const oldColors = geometry.getAttribute('color');
      const count = geometry.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let vertex = 0; vertex < count; vertex++) {
        const k = vertex * 3;
        colors[k] = (oldColors ? oldColors.getX(vertex) : 1) *
          base.r * instanceColor.r;
        colors[k + 1] = (oldColors ? oldColors.getY(vertex) : 1) *
          base.g * instanceColor.g;
        colors[k + 2] = (oldColors ? oldColors.getZ(vertex) : 1) *
          base.b * instanceColor.b;
      }
      // Uniform attributes are mandatory for one BufferGeometryUtils merge.
      for (const attribute of Object.keys(geometry.attributes)) {
        if (attribute !== 'position' && attribute !== 'normal') {
          geometry.deleteAttribute(attribute);
        }
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      pieces.push(geometry);
    }
  }
  const merged = mergeGeometries(pieces, false);
  pieces.forEach(piece => piece.dispose());
  if (!merged) throw new Error('Cannot batch Old Lighthouse meshes: ' + name);
  sources.forEach(source => {
    // Preserve lightweight named art anchors for World Lab inspections even
    // though their geometry is now part of one merged GPU draw.
    const parent = source.parent;
    source.removeFromParent();
    if (parent) {
      const anchor = new THREE.Object3D();
      anchor.name = source.name;
      parent.add(anchor);
    }
    source.geometry.dispose();
    if (Array.isArray(source.material)) source.material.forEach(mat => mat.dispose());
    else source.material.dispose();
  });
  merged.userData.preserveSilhouette = true;
  const mesh = new THREE.Mesh(merged, new THREE.MeshToonMaterial({
    color: 0xffffff, vertexColors: true, gradientMap: TOON_RAMP,
    side: THREE.DoubleSide,
  }));
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  root.add(mesh);
  return mesh;
}

/** A strip conforming to the heightfield: decorative, not a false flat collider. */
function makeWindingFootpath(island: IslandData, center: { x: number; z: number }, applyMap?: ApplyGroundMap): THREE.Mesh {
  const scale = island.size / 600;
  const curve = new THREE.CatmullRomCurve3(LIGHTHOUSE_FOOTPATH.map(([dx, dz]) =>
    new THREE.Vector3(center.x + dx! * scale, 0, center.z + dz! * scale)), false, 'centripetal');
  const vertices: number[] = [], indices: number[] = [], colours: number[] = [];
  const across = [-1.23, -.70, .70, 1.23];
  for (let i = 0; i <= 72; i++) {
    const t = i / 72;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const nx = tangent.z, nz = -tangent.x;
    const width = (1.7 + Math.sin(t * Math.PI) * 0.35) * scale;
    for (const side of across) {
      const x = point.x + side * nx * width;
      const z = point.z + side * nz * width;
      colours.push(1, 1, 1, Math.abs(side) > 1 ? 0 : 1);
      vertices.push(x, gridSample(island, x, z) + 0.16 * scale, z);
    }
    if (i > 0) {
      for (let j = 0; j < across.length - 1; j++) {
        const k = i * across.length + j, prev = k - across.length;
        indices.push(prev, prev + 1, k, prev + 1, k + 1, k);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: 0xbe9864, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  groundUV(geometry, 3.8 * scale);
  applyMap?.(material, 'old-lighthouse');
  mesh.name = 'lighthouse-winding-dirt-path';
  return mesh;
}

export function keeperCottageFoundationGeometry(island: IslandData,
  cottage: PropDescriptor): THREE.BufferGeometry[] {
  return keeperCottagePiers(island, cottage).map(({ corners }) => {
    const geometry = new THREE.BufferGeometry();
    const positions = [...corners.map(corner => corner.top), ...corners.map(corner => corner.foot)]
      .flatMap(({ x, y, z }) => [x, y, z]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex([
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
      3, 0, 4, 3, 4, 7,
    ]);
    const faces = geometry.toNonIndexed();
    geometry.dispose();
    faces.computeVertexNormals();
    return faces;
  });
}

function makeCottage(prop: PropDescriptor): THREE.Group {
  const cottage = new THREE.Group();
  cottage.name = 'lighthouse-keeper-cottage';
  cottage.position.copy(prop.transform.position);
  cottage.rotation.y = prop.transform.rotationY;
  const model = new THREE.Mesh(kitPreview('cottage', prop.size),
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: BUILDING_RAMP }));
  model.scale.copy(prop.size);
  model.name = 'keeper-cottage-kit-house';
  cottage.add(model);
  return cottage;
}

function makeSeaCave(island: IslandData, cave: PropDescriptor): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighthouse-recessed-sea-cave';
  const p = cave.transform.position, s = cave.size;
  const floor = p.y - s.y / 2;
  group.position.set(p.x, floor, p.z);
  group.rotation.y = cave.transform.rotationY;
  const stone = makePainter();
  const wall = STONE, roof = 0x92949c, interior = 0x39485b;
  // Local +Z is the open sea-facing entrance, local -Z the Rapier back wall.
  // The two deeply extending jambs and a roof make an actual recess rather
  // than a painted black slab closing the mouth.
  stone.box(wall, -s.x * 0.41, s.y * 0.36, 0,
    s.x * 0.20, s.y * 0.72, s.z * 1.07);
  stone.box(wall, s.x * 0.41, s.y * 0.36, 0,
    s.x * 0.20, s.y * 0.72, s.z * 1.07);
  stone.box(roof, 0, s.y * 0.84, 0, s.x * 1.08, s.y * 0.32, s.z * 1.12);
  stone.box(interior, 0, s.y * 0.34, -s.z * 0.46,
    s.x * 0.65, s.y * 0.68, s.z * 0.11);
  // Side walls recede into the cliff; only the rear is dark.
  stone.box(0x737780, -s.x * 0.30, s.y * 0.34, -s.z * 0.18,
    s.x * 0.07, s.y * 0.62, s.z * 0.50);
  stone.box(0x737780, s.x * 0.30, s.y * 0.34, -s.z * 0.18,
    s.x * 0.07, s.y * 0.62, s.z * 0.50);
  group.add(stone.finish('sea-cave-stone-arch'));

  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    rockToonMaterial(0xa8a8b0), 13);
  rocks.name = 'lighthouse-cave-sunlit-arch-boulders';
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 13; i++) {
    const a = (i / 12) * Math.PI;
    dummy.position.set(
      Math.cos(a) * s.x * 0.47,
      s.y * (0.47 + Math.sin(a) * 0.47),
      s.z * 0.47 + Math.sin(i * 2.3) * 0.25,
    );
    dummy.rotation.set(0.12 * i, i * 0.63, 0.1 * Math.sin(i));
    dummy.scale.set(s.x * 0.145, s.y * 0.15, s.z * 0.24);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  const secret = island.relics.find(relic =>
    relic.poiId === 'old-lighthouse' && relic.hint.includes('Inside the sea cave'));
  if (secret) {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 1.1, 0.48, 10),
      new THREE.MeshToonMaterial({ color: 0x99959b, gradientMap: TOON_RAMP }));
    pedestal.name = 'lighthouse-relic-plinth';
    pedestal.position.set(secret.position.x, secret.position.y - 0.7,
      secret.position.z);
    group.parent?.add(pedestal);
    // This object is attached in world coordinates after group placement.
    const statue = makePainter();
    const x = secret.position.x, y = secret.position.y - 0.38, z = secret.position.z;
    statue.add(new THREE.DodecahedronGeometry(1, 0), GOLD,
      { x, y: y + 0.57, z, width: 0.88, height: 0.53, depth: 0.49 });
    statue.add(new THREE.DodecahedronGeometry(1, 0), GOLD,
      { x: x + 0.36, y: y + 0.91, z, width: 0.36, height: 0.39, depth: 0.36 });
    for (const dx of [-0.26, 0.25]) for (const dz of [-0.18, 0.18]) {
      statue.box(GOLD, x + dx, y + 0.20, z + dz, 0.12, 0.42, 0.12);
    }
    for (const dz of [-0.14, 0.14]) {
      statue.add(new THREE.ConeGeometry(0.09, 0.32, 6), GOLD,
        { x: x + 0.41, y: y + 1.24, z: z + dz,
          width: 1, height: 1, depth: 1, roll: dz > 0 ? -0.28 : 0.28 });
    }
    const gold = statue.finish('lighthouse-golden-goat-relic');
    gold.traverse(part => {
      if (part instanceof THREE.Mesh) {
        part.material = new THREE.MeshBasicMaterial({ color: GOLD });
      }
    });
    // A small unshadowed warm light makes the relic illuminate the real
    // recess. The collider and secret-relic coordinates remain untouched.
    const warmLight = new THREE.PointLight(0xffb64f, 2.7, 10 * island.size / 600, 2);
    warmLight.name = 'lighthouse-relic-warm-cave-glow';
    warmLight.position.set(secret.position.x, secret.position.y + 0.5, secret.position.z);
    warmLight.userData['worldSpaceRelic'] = true;
    // The world builder lifts these out to world space below.
    gold.userData['worldSpaceRelic'] = true;
    pedestal.userData['worldSpaceRelic'] = true;
    group.add(gold, pedestal, warmLight);
  }
  return group;
}

/** The library's static GLBs are normalized once and repeated as GPU instances. */
export function instantiateLibraryModel(root: THREE.Object3D, placements: readonly Placement[],
  name: string, rock: boolean, assetPath: string): THREE.Group {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const span = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(span.x) || Math.min(span.x, span.y, span.z) < 0.0001) {
    throw new Error('Empty or degenerate library model: ' + name);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const authored = isAuthoredLibraryAsset(assetPath);
  const normalize = new THREE.Matrix4()
    .makeScale(authored ? 1 / span.x : 1, authored ? 1 / span.y : 1,
      authored ? 1 / span.z : 1)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const group = new THREE.Group();
  group.name = name;
  const dummy = new THREE.Object3D();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(normalize.clone().multiply(object.matrixWorld));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    // One GPU draw and one toon material per GLB primitive. Preserve its own
    // stone/grass paint instead of overriding everything with emissive grey.
    const sourceMaterial = Array.isArray(object.material)
      ? object.material[0]! : object.material;
    const sourceColor = 'color' in sourceMaterial &&
      sourceMaterial.color instanceof THREE.Color
      ? sourceMaterial.color : new THREE.Color(0xffffff);
    const material = rock ? rockToonMaterial(sourceColor) : object.material;
    const instanced = new THREE.InstancedMesh(geometry, material, placements.length);
    instanced.name = name + '-instanced-part';
    instanced.castShadow = false;
    instanced.receiveShadow = false;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]!;
      const fit = fitLibraryModel(span,
        new THREE.Vector3(p.width, p.height, p.depth), assetPath);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.pitch ?? 0, (p.yaw ?? 0) + fit.yaw, p.roll ?? 0, 'YXZ');
      if (authored) dummy.scale.set(p.width, p.height, p.depth);
      else dummy.scale.copy(fit.scale);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    group.add(instanced);
  });
  return group;
}

export function makeLighthouseFooting(island: IslandData, tower: PropDescriptor): THREE.BufferGeometry {
  const { x, y, z } = tower.transform.position;
  const scale = island.size / 600;
  const top = y - tower.size.y * .49 + .025 * scale;
  const geometry = new THREE.CylinderGeometry(tower.size.x * .49, tower.size.x * .50, 1, 32);
  const vertices = geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const lower = capeSurface(island, x + vertices.getX(i), z + vertices.getZ(i));
    vertices.setY(i, vertices.getY(i) > 0 ? top : Math.min(top - .36 * scale, lower - .32 * scale));
  }
  geometry.translate(x, 0, z);
  geometry.computeVertexNormals();
  return geometry;
}

function makeCliffRocks(island: IslandData, placements: readonly Placement[],
  lighting: ReturnType<typeof makeCapeLighting>): THREE.InstancedMesh {
  const geometry = kitShape('rock');
  geometry.center();
  const geometrySize = geometry.boundingBox!.getSize(new THREE.Vector3());
  geometry.scale(1 / geometrySize.x, 1 / geometrySize.y, 1 / geometrySize.z);
  const positions = geometry.getAttribute('position');
  const footVertices = new Map<string, THREE.Vector3>();
  const painted = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i);
    if (point.y < 0) footVertices.set(point.toArray().join(','), point);
    const shade = 0.72 + 0.28 * THREE.MathUtils.smoothstep(point.y, -0.45, 0.40);
    painted.fill(shade, i * 3, i * 3 + 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(painted, 3));
  const material = rockToonMaterial(CLIFF_STONE);
  material.gradientMap = TOON_RAMP;
  material.vertexColors = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vWorld;').replace('#include <begin_vertex>', `
#include <begin_vertex>
vWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    lighting.paint(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vWorld;');
  };
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = 'lighthouse-cliff-boulders';
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const sample = new THREE.Vector3();
  const sink = 0.24 * island.size / 600;
  const feet = [...footVertices.values()];
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.y + p.height * 0.15, p.z);
    dummy.rotation.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0, 'YXZ');
    dummy.scale.set(p.width, p.height, p.depth);
    dummy.updateMatrix();
    // Seat the inward half of the base where it actually overlaps the slope.
    // Centre-only height sampling leaves the downhill vertices in midair.
    const clearance = feet.map(foot => {
      sample.copy(foot).applyMatrix4(dummy.matrix);
      return sample.y - capeSurface(island, sample.x, sample.z);
    }).sort((a, b) => a - b);
    const contact = clearance[Math.floor((clearance.length - 1) / 2)]!;
    dummy.position.y -= Math.max(0, contact + sink);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** The west lookout cantilevers into the cape instead of standing over the sea. */
function makeLookoutBraces(island: IslandData, deck: PropDescriptor): THREE.Group {
  const scale = island.size / 600;
  const { x, y, z } = deck.transform.position;
  const { x: width, y: height, z: depth } = deck.size;
  const yaw = deck.transform.rotationY;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const at = (across: number, along: number, elevation: number): THREE.Vector3 =>
    new THREE.Vector3(x + across * cos + along * sin, elevation,
      z - across * sin + along * cos);
  const underside = y - height / 2, deckTop = y + height / 2;
  const east = at(width / 2, 0, 0), west = at(-width / 2, 0, 0);
  const inland = capeSurface(island, east.x, east.z) >= capeSurface(island, west.x, west.z) ? 1 : -1;
  const timber = makePainter();
  const tieHeight = underside - 0.17 * scale;
  const outerX = -inland * width * 0.43;
  for (const side of [-1, 1]) {
    const along = side * depth * 0.36;
    const bracket = at(outerX, along, tieHeight);
    const heel = at(inland * width * 0.39, along, 0);
    heel.y = Math.min(underside - 2.8 * scale,
      capeSurface(island, heel.x, heel.z) - 0.55 * scale);
    timber.beam(DARK_WOOD, bracket, heel, 0.21 * scale);
    timber.beam(WOOD, bracket, at(inland * width * 0.43, along, tieHeight), 0.19 * scale);
  }
  timber.beam(DARK_WOOD, at(outerX, -depth * 0.43, tieHeight),
    at(outerX, depth * 0.43, tieHeight), 0.19 * scale);
  // A narrow chevron on the planks identifies the landing below the path.
  // It sits inside the existing deck so the cliff approach stays usable.
  for (const side of [-1, 1]) {
    const markY = deckTop + 0.018 * scale;
    timber.beam(GOLD, at(inland * width * 0.18, side * depth * 0.17, markY),
      at(-inland * width * 0.07, 0, markY), 0.034 * scale);
  }
  return timber.finish('lighthouse-lookout-cliff-braces-and-landing');
}

function makeFlowers(island: IslandData, center: { x: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighthouse-grass-and-wildflowers';
  const scale = island.size / 600;
  const dummy = new THREE.Object3D();
  const grass = new THREE.InstancedMesh(
    kitShape('grassClump'),
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_RAMP }), 32);
  const flowers = new THREE.InstancedMesh(
    kitShape('flower'),
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_RAMP }), 32);
  for (let i = 0; i < 32; i++) {
    const angle = i * 2.399963 + 0.2;
    const r = (10 + (i % 4) * 2.9) * scale;
    const x = center.x + Math.cos(angle) * r;
    const z = center.z + Math.sin(angle) * r;
    const ground = gridSample(island, x, z);
    dummy.position.set(x, ground, z);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.setScalar(0.63 * scale);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + 0.4 * scale, gridSample(island, x + 0.4 * scale, z), z);
    dummy.scale.setScalar((i % 3 === 0 ? 1 : 0.7) * scale);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
  }
  for (const mesh of [grass, flowers]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/** One world-space toon draw for the two sagging hand-rails on each bridge side. */
function makeRopeBridgeRopes(island: IslandData): THREE.Mesh | undefined {
  // Dressing places -1 then +1 at each bridge point, so parity identifies
  // the same side of the bridge without assuming straight road segments.
  const posts = island.props.filter(prop =>
    prop.poiId === 'old-lighthouse' && prop.kind === 'rope-rail');
  const sides: PropDescriptor[][] = [[], []];
  posts.forEach((post, index) => sides[index % 2]!.push(post));

  const pieces: THREE.BufferGeometry[] = [];
  for (const side of sides) {
    for (let i = 1; i < side.length; i++) {
      const a = side[i - 1]!, b = side[i]!;
      const start = a.transform.position, end = b.transform.position;
      // Never span gaps between separate bridge sections.
      const span = Math.hypot(end.x - start.x, end.z - start.z);
      if (span >= 12) continue;
      for (const drop of [0.25, 1.2]) {
        const from = new THREE.Vector3(start.x, start.y + a.size.y / 2 - drop, start.z);
        const to = new THREE.Vector3(end.x, end.y + b.size.y / 2 - drop, end.z);
        const control = from.clone().add(to).multiplyScalar(0.5);
        // At t=0.5 a quadratic Bezier is halfway between its control
        // and the straight span, so twice the target sag lowers the midpoint.
        control.y -= 2 * (0.04 * span);
        pieces.push(new THREE.TubeGeometry(
          new THREE.QuadraticBezierCurve3(from, control, to), 8, 0.04, 5, false));
      }
    }
  }
  if (!pieces.length) return undefined;

  const geometry = mergeGeometries(pieces, false);
  pieces.forEach(piece => piece.dispose());
  if (!geometry) throw new Error('Cannot batch lighthouse rope bridge ropes');
  const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({
    color: 0xd9c49a, gradientMap: TOON_RAMP,
  }));
  mesh.name = 'lighthouse-rope-bridge-ropes';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Hide the generic instanced silhouettes already replaced by the lighthouse
 * composition. Instance order must stay intact for physics bindings, and
 * shared kinds (cottages and caves) must remain visible at other POIs.
 */
function suppressOldArt(island: IslandData, oldProps: THREE.Group,
  fullyHidden: Set<PropKind>): void {
  // The tower itself is NOT replaced: the generic 'lighthouse' prop is the
  // striped custom/lighthouse model (QA LH-1), and only the glow is added here.
  const replacedKinds: readonly PropKind[] = [
    'cottage', 'shipwreck', 'dock', 'cave-mouth', 'deck-stilts',
  ];
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const kind of replacedKinds) {
    const entries = island.props.filter(p => p.kind === kind &&
      !p.id.startsWith('the-dam-compat-'));
    const replaced = entries.flatMap((prop, i) =>
      prop.poiId === 'old-lighthouse' ? [i] : []);
    if (!replaced.length) continue;
    if (replaced.length === entries.length) fullyHidden.add(kind);
    // Also blank the architectural-detail and outline fallbacks, if any.
    for (const prefix of ['props-', 'architecture-details-', 'outline-']) {
      const mesh = oldProps.getObjectByName(prefix + kind);
      if (!(mesh instanceof THREE.InstancedMesh)) continue;
      for (const index of replaced) mesh.setMatrixAt(index, zero);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      // Do not flash an all-replaced legacy batch before the first cull.
      if (fullyHidden.has(kind)) mesh.visible = false;
    }
  }
}

function makeKeeperStairBraces(tower: PropDescriptor, sections: readonly AccessSection[],
  scale: number): THREE.Group {
  const timber = makePainter();
  const { position } = tower.transform;
  for (let i = 3; i < sections.length; i += 4) {
    const { inner, outer } = sections[i]!;
    const dx = inner.x - position.x, dz = inner.z - position.z;
    const inset = 2.35 * scale / Math.hypot(dx, dz);
    const y = inner.y - .34 * scale;
    const anchor = new THREE.Vector3(position.x + dx * inset, y, position.z + dz * inset);
    const end = new THREE.Vector3(outer.x, y, outer.z).lerp(anchor, .09);
    const heel = anchor.clone().add(new THREE.Vector3(0, -2.65 * scale, 0));
    timber.beam(WOOD, anchor, end, .17 * scale);
    timber.beam(DARK_WOOD, heel, end, .14 * scale);
  }
  return timber.finish('lighthouse-keeper-stair-braces');
}

export function buildLighthouseVisuals(island: IslandData,
  oldProps: THREE.Group, lighting: ReturnType<typeof makeCapeLighting>, applyMap?: ApplyGroundMap): LighthouseVisuals {
  const group = new THREE.Group();
  group.name = 'old-lighthouse-hero';
  const fullyHidden = new Set<PropKind>();
  const center = island.pois.find(p => p.id === 'old-lighthouse')!.center;
  const scale = island.size / 600;
  const local = (dx: number, dz: number): { x: number; z: number } =>
    ({ x: center.x + dx * scale, z: center.z + dz * scale });
  const get = (kind: string): PropDescriptor | undefined =>
    island.props.find(prop => prop.poiId === 'old-lighthouse' && prop.kind === kind);

  const footpath = makeWindingFootpath(island, center, applyMap);
  group.add(footpath);
  const lookout = get('platform');
  if (lookout) group.add(makeLookoutBraces(island, lookout));
  const cottage = get('cottage');
  if (cottage) {
    group.add(makeCottage(cottage));
    const footings = new THREE.Group();
    footings.name = 'lighthouse-keeper-cottage-foundation';
    for (const geometry of keeperCottageFoundationGeometry(island, cottage)) {
      footings.add(new THREE.Mesh(geometry, rockToonMaterial(0xa39d96)));
    }
    group.add(footings);
  }
  group.add(makeFlowers(island, center));

  const lighthouse = get('lighthouse');
  const beacon = lighthouse ? makeBeacon(lighthouse, scale) : undefined;
  if (lighthouse) {
    const foundation = new THREE.Mesh(makeLighthouseFooting(island, lighthouse),
      rockToonMaterial(CLIFF_STONE));
    foundation.name = 'lighthouse-stone-footing';
    foundation.receiveShadow = true;
    const stairs = lighthouseAccess(lighthouse, (x, z) => gridSample(island, x, z));
    group.add(foundation, accessPathVisual('lighthouse-keeper-stair', [stairs],
      [lighthouseOuterGuard(stairs, scale)], .34 * scale, scale, 0xceac7f, 0x704639,
      [accessArrows(stairs, scale, 0x77503a)]),
    makeKeeperStairBraces(lighthouse, stairs, scale));
  }

  const cave = get('cave-mouth');
  if (cave) {
    const seaCave = makeSeaCave(island, cave);
    // Cave masonry is in cave-local coordinates; treasure is in world space.
    for (const item of [...seaCave.children]) {
      if (item.userData['worldSpaceRelic']) {
        seaCave.remove(item);
        group.add(item);
      }
    }
    group.add(seaCave);
  }

  const dock = island.props.filter(prop =>
    prop.poiId === 'old-lighthouse' && prop.kind === 'dock');
  const dockArt = new THREE.Group();
  dockArt.name = 'lighthouse-pirate-kit-dock';
  for (const [index, prop] of dock.entries()) {
    // The kit includes the piles. Its walking planks are 0.9 m above the feet;
    // using the collider thickness to fit the whole model left gaps between piers.
    const boards = kitShape('keeperDock', true);
    const span = boards.boundingBox!.getSize(new THREE.Vector3());
    const sx = prop.size.x / span.x, sz = prop.size.z / span.z;
    const upright = Math.min(sx, sz);
    boards.scale(sx, upright, sz);
    const mesh = new THREE.Mesh(boards, new THREE.MeshToonMaterial({ vertexColors: true }));
    mesh.rotation.y = prop.transform.rotationY;
    mesh.position.copy(prop.transform.position);
    mesh.position.y += prop.size.y / 2 - .9 * upright + index * .008 * scale;
    dockArt.add(mesh);
  }
  group.add(dockArt);
  const bollards = makePainter();
  const lanterns: Placement[] = [];
  for (const [dx, dz] of [[19, 24], [31, 34], [-11, 13]]) {
    const p = local(dx!, dz!);
    const onDock = dx! > 0;
    const ground = onDock ? 2.7 * scale : gridSample(island, p.x, p.z);
    bollards.box(DARK_WOOD, p.x, ground + 1.25 * scale, p.z,
      0.26 * scale, 2.5 * scale, 0.26 * scale);
    lanterns.push({
      x: p.x, y: ground + 2.20 * scale, z: p.z,
      width: 1.25 * scale, height: 1.5 * scale, depth: 1.25 * scale,
    });
  }
  group.add(bollards.finish('lighthouse-warm-pier-lantern-posts'));

  // The life ring is a separate silhouette mounted to the outer pier rail.
  const ringPos = local(32, 32);
  const ringPlacement = [{ x: ringPos.x, y: 3.17 * scale, z: ringPos.z, width: 1.56 * scale,
    height: 1.56 * scale, depth: .32 * scale, yaw: .45 }];

  const row = local(37, 37);
  const rowY = -0.30 * scale;
  const boatPlacement: Placement[] = [{
    x: row.x, y: rowY, z: row.z,
    width: 7.5 * scale, height: 2.3 * scale, depth: 3.8 * scale,
    yaw: -0.55,
  }];
  const wreck = get('shipwreck');
  const wreckPlacement: Placement[] = [];
  const mastPlacement: Placement[] = [];
  if (wreck) {
    const p = wreck.transform.position;
    const base = Math.max(-1.5 * scale, p.y - wreck.size.y / 2);
    wreckPlacement.push({
      x: p.x, y: base, z: p.z,
      width: wreck.size.x, height: wreck.size.y * 1.45,
      depth: wreck.size.z, yaw: wreck.transform.rotationY,
      roll: -0.22,
    });
    const mast = local(-35, 7);
    mastPlacement.push({
      x: mast.x + 2.8 * scale, y: base + 2 * scale, z: mast.z,
      width: 2.7 * scale, height: 15 * scale, depth: 2.7 * scale,
      yaw: -0.18, roll: 0.44,
    });
  }

  // The ordinary rock batch already draws the collidable cape rocks.
  const rocks: Placement[] = [];
  // Shore boulders below the grass line, excluding the accessible cave floor.
  for (let i = 0; i < 16; i += 2) {
    const angle = i * 2.399963 + 0.65;
    const r = (28.0 + (i % 4) * 2.5) * scale;
    const x = center.x + Math.cos(angle) * r;
    const z = center.z + Math.sin(angle) * r;
    if (Math.hypot(x - (center.x + 2 * scale),
      z - (center.z + 23 * scale)) < 8 * scale) continue;
    const size = (3.2 + (i % 3) * 1.15) * scale;
    const ground = gridSample(island, x, z);
    rocks.push({
      x, y: Math.max(-1.8 * scale, ground - size * 0.12), z,
      width: size * 1.3, height: size, depth: size,
      yaw: angle, roll: Math.sin(i) * 0.18,
    });
  }
  // Faceted blocks embedded along the steep shoulder break up the former
  // smooth cliff wall. The single-piece stones share one lit instance batch.
  for (let i = 0; i < 88; i += 2) {
    const angle = i * 2.399963 + 0.8;
    const radius = (19.0 + (i % 9) * 1.05) * scale;
    const x = center.x + Math.cos(angle) * radius;
    const z = center.z + Math.sin(angle) * radius;
    const surface = gridSample(island, x, z);
    if (surface < 1.5 * scale || surface > 16 * scale ||
        Math.hypot(x - (center.x + 2 * scale),
          z - (center.z + 23 * scale)) < 8.5 * scale) continue;
    const extent = (3.1 + (i % 4) * 0.8) * scale;
    rocks.push({
      x, y: surface - extent * 0.37, z,
      width: extent * 1.35, height: extent * 0.96,
      depth: extent * 1.05, yaw: angle + (i % 3) * 0.2,
      roll: Math.sin(i * 1.9) * 0.29,
    });
  }
  const cliffRocks = makeCliffRocks(island, rocks, lighting);
  group.add(cliffRocks);

  // Bake the full kit ships, dock furniture and rigging into the static cape draw.
  function kitPlacements(kind: Parameters<typeof kitShape>[0], name: string, placements: Placement[]) {
    if (!placements.length) return;
    const source = new THREE.Mesh(kitShape(kind), new THREE.MeshLambertMaterial({ vertexColors: true }));
    const batch = instantiateLibraryModel(source, placements, name, false, '');
    group.add(batch);
    source.geometry.dispose();
    // The batched output now owns the shared material.
  }
  kitPlacements('tender', 'lighthouse-watercraft-kit-rowboat', boatPlacement);
  kitPlacements('shipwreck', 'lighthouse-pirate-kit-shipwreck', wreckPlacement);
  kitPlacements('wreckMast', 'lighthouse-broken-ship-mast', mastPlacement);
  kitPlacements('pierLantern', 'lighthouse-library-lanterns', lanterns);
  kitPlacements('life-ring', 'lighthouse-red-white-life-ring', ringPlacement);
  const harbour = batchHeroMeshes(group, 'lighthouse-static-painted-landmarks', mesh => mesh !== cliffRocks && mesh !== footpath);
  const fullHarbour = harbour.geometry;
  let farHarbour = fullHarbour, disposed = false;
  void simplifiedWorldGeometry(fullHarbour).then(low => {
    if (disposed && low !== fullHarbour) low.dispose();
    else farHarbour = low;
  });
  if (beacon) group.add(beacon.glass, beacon.halo);
  // Add after the hero batch so this stays one named Mesh and one draw call.
  const bridgeRopes = makeRopeBridgeRopes(island);
  if (bridgeRopes) group.add(bridgeRopes);

  // The cave retains separate logical arch and hidden-relic anchors after
  // its surfaces have been merged into the one static GPU draw.
  const caveAnchor = group.getObjectByName('lighthouse-recessed-sea-cave');
  if (caveAnchor) caveAnchor.add(new THREE.Object3D());

  suppressOldArt(island, oldProps, fullyHidden);
  return {
    group,
    isFallbackHidden(mesh: THREE.InstancedMesh): boolean {
      const kind = mesh.name.replace(/^(?:props-|architecture-details-|outline-)/, '');
      return fullyHidden.has(kind as PropKind);
    },
    updateCulling(position) {
      const dx = position.x - center.x, dz = position.z - center.z;
      harbour.geometry = dx * dx + dz * dz > (155 * scale) ** 2 ? farHarbour : fullHarbour;
    },
    setLighting(daylight: number, golden: number): void {
      beacon?.setLighting(daylight, golden);
    },
    dispose(): void {
      disposed = true;
      harbour.geometry = fullHarbour;
      if (farHarbour !== fullHarbour) farHarbour.dispose();
      beacon?.dispose();
      // All geometry/materials are released by WorldScene.dispose's traversal.
    },
  };
}
