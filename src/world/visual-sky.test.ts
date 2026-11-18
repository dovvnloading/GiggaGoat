import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CLOUD_LIBRARY_MODELS } from './library-props';
import { ART_BOOKMARKS } from './viewer/bookmarks';
import { TOON_RAMP } from './visual-props';
import { buildSkyVisuals, GOLDEN_HOUR_SKY, SKY_HORIZON_COLOR } from './visual-sky';


afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function makeClouds() {
  // Synthetic flat-based, source-painted GLBs: no network/DOM needed in Vitest.
  const paths: string[] = [];
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    paths.push(url);
    const index = CLOUD_LIBRARY_MODELS.findIndex(path => url.endsWith(path));
    const geometry = new THREE.BoxGeometry(60, 22, 34);
    geometry.translate(0, 11, 0);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: [0xffffff, 0xdcd8ee, 0xf6e4ef][index] ?? 0xffffff,
    })));
    return { scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  });
  vi.stubGlobal('document', {});
  const sky = buildSkyVisuals();
  const meshList = (): THREE.InstancedMesh[] => sky.group.children.filter(
    child => child.name.startsWith('puffy-cloud-banks-'),
  ) as THREE.InstancedMesh[];
  // No ellipsoid fallback, not even while the GLB promises are pending.
  expect(meshList()).toHaveLength(0);
  await vi.waitFor(() => expect(meshList()).toHaveLength(3));
  return { sky, paths, clouds: meshList().sort((a, b) => a.name.localeCompare(b.name)) };
}

describe('storybook sky clouds (Hoofington E2)', () => {
  it('uses a cloud-only bright toon ramp, white daytime tint and cool emissive fill', async () => {
    const { sky, clouds } = await makeClouds();
    expect(clouds).toHaveLength(3);
    expect(clouds[0]!.material).toBeInstanceOf(THREE.MeshToonMaterial);
    const material = clouds[0]!.material as THREE.MeshToonMaterial;
    expect(material.vertexColors).toBe(true);
    expect(clouds.every(cloud => cloud.material === material)).toBe(true);
    expect(material.gradientMap).toBeInstanceOf(THREE.DataTexture);
    expect(material.gradientMap).not.toBe(TOON_RAMP);

    const ramp = material.gradientMap as THREE.DataTexture;
    expect(Array.from(ramp.image.data as Uint8Array)).toEqual([
      214, 214, 214, 255,
      232, 232, 232, 255,
      246, 246, 246, 255,
      255, 255, 255, 255,
    ]);
    expect(ramp.image.width).toBe(4);
    expect(ramp.image.height).toBe(1);
    expect(ramp.magFilter).toBe(THREE.NearestFilter);
    expect(ramp.minFilter).toBe(THREE.NearestFilter);
    expect(ramp.generateMipmaps).toBe(false);

    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.emissive.getHex()).toBe(0xffffff);
    expect(material.emissiveIntensity).toBe(0.3);
    expect(material.fog).toBe(true);
    expect(material.opacity).toBeCloseTo(0.94);

    const goldenHour = sky.update(0.265);
    expect(material.color.getHex()).toBe(0xffcdb6);
    expect(material.opacity).toBeCloseTo(0.18 + goldenHour.daylight * 0.76);
    sky.update(0.5);
    expect(material.color.getHex()).toBe(0xffffff);
  });

  it('loads exactly three authored cloud models, preserving each model\'s paint in a single draw', async () => {
    const { sky, clouds, paths } = await makeClouds();
    expect(paths).toHaveLength(3);
    expect(paths.map(url => CLOUD_LIBRARY_MODELS.find(path => url.endsWith(path)))).toEqual([
      'assets/library/custom/sky/cloud-a.glb',
      'assets/library/custom/sky/cloud-b.glb',
      'assets/library/custom/sky/cloud-c.glb',
    ]);
    expect(clouds).toHaveLength(3);
    expect(clouds.every(mesh => mesh instanceof THREE.InstancedMesh)).toBe(true);
    expect(clouds.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(24);
    expect(clouds.map(mesh => mesh.count)).toEqual([8, 8, 8]);
    // Model material RGBs survive baking instead of being replaced by a
    // uniform procedurally tinted ellipsoid (one geometry per model).
    const reds = clouds.map(mesh => {
      const paint = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      expect(paint).toBeDefined();
      return paint.getX(0);
    });
    expect(new Set(reds.map(value => value.toFixed(4))).size).toBeGreaterThan(1);
    expect(sky.group.children.filter(child => child instanceof THREE.InstancedMesh))
      .toHaveLength(3);
  });

  it('does not draw ellipsoid substitutes while cloud models are still loading', () => {
    vi.stubGlobal('document', {});
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(
      () => new Promise(() => {}),
    );
    const sky = buildSkyVisuals();
    expect(sky.group.children.filter(child => child instanceof THREE.InstancedMesh))
      .toHaveLength(0);
    expect(sky.group.getObjectByName('puffy-cloud-banks')).toBeUndefined();
  });
  it('binds the same linear daytime horizon to the unfogged dome and both fog setups', () => {
    const sky = buildSkyVisuals();
    const dome = sky.group.getObjectByName('gradient-sky') as THREE.Mesh;
    const material = dome.material as THREE.ShaderMaterial;
    expect(material.fog).toBe(false);
    expect(material.uniforms['uHorizon']!.value).toBe(SKY_HORIZON_COLOR);
    expect(material.fragmentShader).toContain('mix(uHorizon,');
    expect(SKY_HORIZON_COLOR).toEqual(new THREE.Color(0.76, 0.88, 0.98));

    // The viewer initializes in the browser, so assert the exact live scene
    // assignment instead of constructing a WebGLRenderer under node/Vitest.
    const viewer = readFileSync(new URL('./viewer/viewer.ts', import.meta.url), 'utf8');
    expect(viewer).toMatch(/scene\.fog = new THREE\.Fog\(SKY_HORIZON_COLOR, island\.size \* 0\.9, island\.size \* 3\.2\)/);
    const islandSize = 600;
    const viewerFog = new THREE.Fog(SKY_HORIZON_COLOR, islandSize * 0.9, islandSize * 3.2);
    expect(viewerFog.color.equals(SKY_HORIZON_COLOR)).toBe(true);
    expect(viewerFog.near).toBe(540);
    expect(viewerFog.far).toBe(1920);

    const game = readFileSync(new URL('../core/GameView.ts', import.meta.url), 'utf8');
    expect(game).toMatch(/this\.scene\.fog = new THREE\.FogExp2\(SKY_HORIZON_COLOR, \.0016\)/);
    const gameFog = new THREE.FogExp2(SKY_HORIZON_COLOR, .0016);
    expect(gameFog.color.equals(SKY_HORIZON_COLOR)).toBe(true);
    expect(gameFog.density).toBe(.0016);
    // Do not change the graphics-quality fog-density tiers.
    expect(game).toContain("settings.graphics === 'low' ? .0032 :");
    expect(game).toContain("settings.graphics === 'medium' ? .0023 : .0016;");
  });

  it('keeps the same 24 deterministic bank positions and RNG sequence in the 300–380 m band', async () => {
    const { clouds } = await makeClouds();
    let seed = 0x49a0b12d;
    const rand = (): number => {
      seed = (Math.imul(seed ^ (seed >>> 13), 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const matrix = new THREE.Matrix4();
    for (let bank = 0; bank < 24; bank++) {
      const a = rand() * Math.PI * 2;
      const r = 330 + rand() * 380;
      const heightFraction = rand();
      const breadth = 28 + rand() * 28;
      const expectedScale = 0.8 + (breadth - 28) / 28 * 0.6;
      const cloud = clouds[bank % 3]!;
      cloud.getMatrixAt(Math.floor(bank / 3), matrix);
      const p = new THREE.Vector3(), scale = new THREE.Vector3();
      matrix.decompose(p, new THREE.Quaternion(), scale);
      expect(p.x).toBeCloseTo(Math.cos(a) * r, 3);
      expect(p.z).toBeCloseTo(Math.sin(a) * r, 3);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(330 - 0.001);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(710 + 0.001);
      expect(scale.x).toBeCloseTo(expectedScale, 5);
      expect(scale.y).toBeCloseTo(scale.x, 5);
      expect(scale.z).toBeCloseTo(scale.x, 5);
      expect(scale.x).toBeGreaterThanOrEqual(0.8);
      expect(scale.x).toBeLessThanOrEqual(1.4);
      expect(p.y).toBeCloseTo(300 + heightFraction * (80 - 22 * expectedScale), 3);
      const bounds = cloud.geometry.boundingBox!.clone().applyMatrix4(matrix);
      expect(bounds.min.y).toBeGreaterThanOrEqual(300 - 0.001);
      expect(bounds.max.y).toBeLessThanOrEqual(380 + 0.001);
      for (const bookmark of ART_BOOKMARKS) {
        expect(bounds.containsPoint(new THREE.Vector3(
          bookmark.camera.x, bookmark.camera.y, bookmark.camera.z)),
          'cloud bank ' + bank + ' contains bookmark ' + bookmark.id).toBe(false);
      }
      // The six retired per-puff draws must still advance the star seed.
      for (let puff = 0; puff < 3; puff++) {
        rand(); rand();
      }
    }
    // Star positions continue from the old cloud RNG stream, not a re-seed.
    const sky = buildSkyVisuals();
    const star = sky.group.getObjectByName('night-stars') as THREE.Points;
    const positions = star.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = rand() * Math.PI * 2, y = rand() * 0.91 + 0.08;
    const horizontal = Math.sqrt(1 - y * y);
    expect(positions.getX(0)).toBeCloseTo(Math.cos(a) * horizontal * 1250, 3);
    expect(positions.getY(0)).toBeCloseTo(y * 1250, 3);
  });
  it('draws transparent GLB clouds after the sea without disabling fog', async () => {
    const { clouds } = await makeClouds();
    expect(clouds.length).toBeLessThanOrEqual(3);
    for (const cloud of clouds) {
      expect(cloud.renderOrder).toBe(3);
      expect((cloud.material as THREE.MeshToonMaterial).fog).toBe(true);
      expect((cloud.material as THREE.MeshToonMaterial).depthWrite).toBe(false);
    }
  });
  it('uses saturated three-stop golden-hour colours without changing noon blue', () => {
    const sky = buildSkyVisuals();
    const dome = sky.group.getObjectByName('gradient-sky') as THREE.Mesh;
    const shader = dome.material as THREE.ShaderMaterial;
    expect(shader.fog).toBe(false);
    const uniforms = shader.uniforms;
    expect(shader.fragmentShader).toContain('mix(uSunsetHorizon, uSunsetMid,');
    expect(shader.fragmentShader).toContain('mix(sunset, uSunsetZenith,');
    expect(shader.fragmentShader).toContain('max(uDay, uGolden)');
    expect(shader.fragmentShader).toContain('glow * uSunGlowStrength');

    sky.update(0.29);
    expect(uniforms['uGolden']!.value).toBe(1);
    expect((uniforms['uSunsetHorizon']!.value as THREE.Color).getHex())
      .toBe(0xffb27a);
    expect((uniforms['uSunsetMid']!.value as THREE.Color).getHex())
      .toBe(0xd98bc4);
    expect((uniforms['uSunsetZenith']!.value as THREE.Color).getHex())
      .toBe(0x6b5fd1);
    expect((uniforms['uSunsetHorizon']!.value as THREE.Color))
      .toBe(GOLDEN_HOUR_SKY.horizon);
    expect((uniforms['uSunsetMid']!.value as THREE.Color))
      .toBe(GOLDEN_HOUR_SKY.mid);
    expect((uniforms['uSunsetZenith']!.value as THREE.Color))
      .toBe(GOLDEN_HOUR_SKY.zenith);
    expect(uniforms['uSunGlowStrength']!.value)
      .toBeGreaterThanOrEqual(0.29 * 1.6);

    sky.update(0.5);
    expect(uniforms['uGolden']!.value).toBe(0);
    expect(uniforms['uDay']!.value).toBe(1);
    expect(uniforms['uSunGlowStrength']!.value).toBeCloseTo(0.29, 10);
    expect(uniforms['uHorizon']!.value).toBe(SKY_HORIZON_COLOR);
    // The untouched noon gradient still runs from the old blue horizon to
    // the original sky-blue zenith, with no sunset or night contribution.
    expect(shader.fragmentShader)
      .toContain('vec3 sunny = mix(uHorizon, vec3(0.08, 0.48, 0.94), horizon);');
    expect(SKY_HORIZON_COLOR).toEqual(new THREE.Color(0.76, 0.88, 0.98));
    const blueZenith = new THREE.Color(0.08, 0.48, 0.94);
    for (const h of [0, 0.25, 0.5, 0.75, 1]) {
      const expectedNoon = SKY_HORIZON_COLOR.clone().lerp(blueZenith, h);
      const fromUnchangedDayPath = (uniforms['uHorizon']!.value as THREE.Color)
        .clone().lerp(blueZenith, h);
      expect(fromUnchangedDayPath.equals(expectedNoon)).toBe(true);
    }
    expect(shader.fragmentShader).toContain('vec3 night = mix(vec3(0.18, 0.22, 0.38),');
  });

});

describe('IS-23 fog follows the true sky-dome horizon', () => {
  it('matches the dome gradient at y=0 through night, golden hour and noon', () => {
    const sky = buildSkyVisuals();
    const dome = sky.group.getObjectByName('gradient-sky') as THREE.Mesh;
    const shader = dome.material as THREE.ShaderMaterial;
    const h = THREE.MathUtils.smoothstep(0, -0.15, 0.90);
    for (const phase of [0.025, 0.285, 0.5]) {
      const state = sky.update(phase);
      const sunny = (shader.uniforms['uHorizon']!.value as THREE.Color).clone()
        .lerp(new THREE.Color(0.08, 0.48, 0.94), h);
      const sunset = GOLDEN_HOUR_SKY.horizon.clone()
        .lerp(GOLDEN_HOUR_SKY.mid, THREE.MathUtils.smoothstep(h, 0, 0.5))
        .lerp(GOLDEN_HOUR_SKY.zenith, THREE.MathUtils.smoothstep(h, 0.5, 1));
      const night = new THREE.Color(0.18, 0.22, 0.38)
        .lerp(new THREE.Color(0.018, 0.045, 0.14), h);
      const expected = night.lerp(sunny.lerp(sunset, state.golden),
        Math.max(state.daylight, state.golden));
      for (const component of ['r', 'g', 'b'] as const) {
        expect(Math.abs(state.horizon[component] - expected[component]),
          'sky horizon ' + component + ' at phase ' + phase).toBeLessThan(0.01);
      }
    }
    const night = sky.update(0.025).horizon.clone();
    const luminance = night.r * 0.2126 + night.g * 0.7152 + night.b * 0.0722;
    expect(luminance).toBeLessThan(0.25);
    const golden = sky.update(0.285).horizon.clone();
    expect(golden.r).toBeGreaterThan(golden.b + 0.2);
    // The existing dome uses a nonzero smoothstep at y=0. In display sRGB,
    // the unchanged noon gradient differs from the old fog RGB by <0.02.
    const day = sky.update(0.5).horizon.clone().convertLinearToSRGB();
    const oldDay = SKY_HORIZON_COLOR.clone().convertLinearToSRGB();
    for (const component of ['r', 'g', 'b'] as const) {
      expect(Math.abs(day[component] - oldDay[component])).toBeLessThan(0.02);
    }
  });

  it('copies sky horizon to WorldScene fogColor for each phase and preset', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const world = createWorldScene(island, { chunkSegments: 16 });
    const sky = buildSkyVisuals();
    try {
      const fog = world.fogColor;
      expect(fog).toBeInstanceOf(THREE.Color);
      for (const [phase, preset] of [
        [0.025, 'night'], [0.285, 'golden-hour'], [0.5, 'day'],
      ] as const) {
        world.setDayNight(phase);
        const expected = sky.update(phase).horizon;
        for (const component of ['r', 'g', 'b'] as const) {
          expect(Math.abs(world.fogColor[component] - expected[component]),
            'world fog ' + component + ' at phase ' + phase).toBeLessThan(0.01);
        }
        world.setLightingPreset(preset);
        expect(world.fogColor).toBe(fog);
        expect(world.fogColor.equals(expected)).toBe(true);
      }
    } finally {
      world.dispose();
    }
  });

  it('synchronizes both scene fogs and renderer clear colours at every change', () => {
    const viewer = readFileSync(new URL('./viewer/viewer.ts', import.meta.url), 'utf8');
    expect(viewer).toContain('scene.fog?.color.copy(worldView.fogColor)');
    expect(viewer).toContain('renderer.setClearColor(worldView.fogColor)');
    expect(viewer).toMatch(/worldView\.setDayNight\(phase\);\s*syncFogColor\(\)/);
    expect(viewer).toMatch(/worldView\.setLightingPreset\(preset\);\s*syncFogColor\(\)/);
    const game = readFileSync(new URL('../core/GameView.ts', import.meta.url), 'utf8');
    expect(game).toContain('this.scene.fog.color.copy(this.world.fogColor)');
    expect(game).toContain('this.renderer.setClearColor(this.world.fogColor)');
  });
});
