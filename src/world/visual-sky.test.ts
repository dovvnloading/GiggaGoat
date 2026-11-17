import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOON_RAMP } from './visual-props';
import { buildSkyVisuals } from './visual-sky';

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
    expect(material.emissive.getHex()).toBe(0xdfe9f7);
    expect(material.emissiveIntensity).toBe(0.18);
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
});
