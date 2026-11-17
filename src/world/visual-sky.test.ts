import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOON_RAMP } from './visual-props';
import { buildSkyVisuals, SKY_HORIZON_COLOR } from './visual-sky';

function makeClouds() {
  const sky = buildSkyVisuals();
  const clouds = sky.group.getObjectByName('puffy-cloud-banks');
  expect(clouds).toBeInstanceOf(THREE.InstancedMesh);
  return { sky, clouds: clouds as THREE.InstancedMesh };
}

describe('storybook sky clouds (Hoofington E2)', () => {
  it('uses a cloud-only bright toon ramp, white daytime tint and cool emissive fill', () => {
    const { sky, clouds } = makeClouds();
    expect(clouds.material).toBeInstanceOf(THREE.MeshToonMaterial);
    const material = clouds.material as THREE.MeshToonMaterial;
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

  it('keeps 72 smoothed, flattened puffs in a single instanced mesh', () => {
    const { clouds } = makeClouds();
    expect(clouds.count).toBe(72);
    expect(clouds.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
    expect((clouds.geometry as THREE.IcosahedronGeometry).parameters.detail).toBe(2);

    const firstBank = Array.from({ length: 3 }, (_, index) => {
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      clouds.getMatrixAt(index, matrix);
      matrix.decompose(position, new THREE.Quaternion(), scale);
      return { position, scale };
    });
    for (const puff of firstBank) {
      expect(puff.scale.y).toBeGreaterThanOrEqual(20 * 0.62 - 0.001);
      expect(puff.scale.y).toBeLessThanOrEqual(30 * 0.62 + 0.001);
    }
    expect(firstBank[2]!.position.x - firstBank[0]!.position.x)
      .toBeCloseTo(firstBank[0]!.scale.x * 2 * 0.63 * 1.25, 3);
    expect(firstBank[1]!.position.z - firstBank[0]!.position.z)
      .toBeCloseTo(18 * 1.25, 3);
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

  it('places the same deterministic 24 banks farther out and above the island', () => {
    const { clouds } = makeClouds();
    let seed = 0x49a0b12d;
    const rand = (): number => {
      seed = (Math.imul(seed ^ (seed >>> 13), 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const matrix = new THREE.Matrix4();
    const get = (index: number): THREE.Vector3 => {
      clouds.getMatrixAt(index, matrix);
      return new THREE.Vector3().setFromMatrixPosition(matrix);
    };
    for (let i = 0; i < clouds.count / 3; i++) {
      const a = rand() * Math.PI * 2;
      const r = 330 + rand() * 380;
      const y = 150 + rand() * 100;
      rand(); // breadth: same fourth random draw as before
      const left = get(i * 3), middle = get(i * 3 + 1);
      const centreZ = (left.z + middle.z) / 2;
      expect(Math.hypot(middle.x, centreZ)).toBeGreaterThanOrEqual(330 - 0.001);
      expect(Math.hypot(middle.x, centreZ)).toBeLessThanOrEqual(710 + 0.001);
      expect(left.y).toBeGreaterThanOrEqual(150 - 0.001);
      expect(left.y).toBeLessThanOrEqual(250 + 0.001);
      expect(middle.x).toBeCloseTo(Math.cos(a) * r, 3);
      expect(centreZ).toBeCloseTo(Math.sin(a) * r, 3);
      expect(left.y).toBeCloseTo(y, 3);
      for (let puff = 0; puff < 3; puff++) {
        rand(); // puff height
        rand(); // puff depth
      }
    }
  });

  it('draws transparent cloud puffs after the sea without disabling fog', () => {
    const { clouds } = makeClouds();
    expect(clouds.renderOrder).toBe(3);
    expect((clouds.material as THREE.MeshToonMaterial).fog).toBe(true);
    expect((clouds.material as THREE.MeshToonMaterial).depthWrite).toBe(false);
  });
});
