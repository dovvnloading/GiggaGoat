import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { DOWNTOWN_MODELS, DOWNTOWN_BUILDING_SIZES } from './visual-downtown';
import { downtownFinish, paintPropFinish, propFinish } from './material-detail';
import { paintHoofingtonFacades } from './surface-paint';
import { bakeLibraryGeometry, type HoofPlacement } from './visual-hoofington';

function shaderFor(material: THREE.MeshToonMaterial) {
  const shader = {
    vertexShader: THREE.ShaderLib.toon!.vertexShader,
    fragmentShader: THREE.ShaderLib.toon!.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
  material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0],
    null as unknown as THREE.WebGLRenderer);
  return shader;
}

describe('local-metre architectural material finishes', () => {
  it('classifies named building surfaces without treating trim, signage or flowers as brick', () => {
    expect(downtownFinish('shop', 'wallY')).toBe(4);
    expect(downtownFinish('shop', 'wallY', true)).toBe(8);
    expect(downtownFinish('shop', 'roof')).toBe(5);
    expect(downtownFinish('shop', 'glass')).toBe(7);
    expect(downtownFinish('shop', 'cornice')).toBe(9);
    expect(downtownFinish('shop', 'door')).toBe(0);
    expect(downtownFinish('shop', 'flower')).toBe(0);
    expect(downtownFinish('building-type-j', 'Material')).toBe(10);
    expect(downtownFinish('awning', 'Material')).toBe(0);
    expect(downtownFinish('building-type-m', 'Material', true)).toBe(11);
  });
  it('checks the authored building GLB material coverage, not only synthetic meshes', () => {
    const keys = [...Object.keys(DOWNTOWN_BUILDING_SIZES), 'highrise'] as Array<keyof typeof DOWNTOWN_MODELS>;
    const coverage: Record<string, number[]> = {};
    for (const key of keys) {
      const glb = readFileSync('public/' + DOWNTOWN_MODELS[key]);
      const model = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as {
        meshes: Array<{ name?: string; primitives: Array<{ material?: number }> }>;
        materials?: Array<{ name?: string }>;
      };
      const styles = model.meshes.flatMap(mesh => mesh.primitives.map(primitive =>
        downtownFinish(mesh.name ?? '', model.materials?.[primitive.material ?? -1]?.name ?? '', key === 'brickHouse')));
      coverage[key] = [...new Set(styles)].sort((a, b) => a - b);
    }
    console.log('WORLD_FACADE_FINISH_COVERAGE ' + JSON.stringify(coverage));
    // At a minimum the town tower and brick townhouse must carry actual
    // surface treatment. Additional imported material labels are reported
    // for review rather than guessed from the source filename.
    expect(coverage.highrise).toContain(4);
    expect(coverage.brickHouse?.some(style => style === 8 || style === 11), JSON.stringify(coverage)).toBe(true);
  });
  it('keeps source positions and palette while carrying material IDs into the district batch', () => {
    const model = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: 0xc5a879 }); wall.name = 'wallY';
    const glass = new THREE.MeshStandardMaterial({ color: 0x7799b9 }); glass.name = 'glass';
    const trim = new THREE.MeshStandardMaterial({ color: 0xf0e2cc }); trim.name = 'window_frame';
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    model.add(new THREE.Mesh(geometry, wall));
    const pane = new THREE.Mesh(geometry, glass); pane.position.z = 1;
    const frame = new THREE.Mesh(geometry, trim); frame.position.z = 1.1;
    model.add(pane, frame);
    const placement: HoofPlacement<'brickHouse'> = {
      model: 'brickHouse', position: { x: 12, y: 5, z: -18 }, size: { x: 8, y: 10, z: 8 }, yaw: 1.2,
    };
    const models = new Map([['brickHouse' as const, model]]);
    const baked = bakeLibraryGeometry([placement], models, undefined, {
      brickHouse: 'assets/library/custom/downtown-shops/shop-m-pink.glb',
    })!;
    const baseline = bakeLibraryGeometry([placement], models, undefined, {
      brickHouse: 'assets/library/custom/',
    })!;
    expect(baked.getAttribute('position').array).toEqual(baseline.getAttribute('position').array);
    expect(baked.getAttribute('color').array).toEqual(baseline.getAttribute('color').array);
    const styles = baked.getAttribute('hoofingtonFacade');
    expect(styles.count).toBe(baked.getAttribute('position').count);
    expect(new Set(Array.from({ length: styles.count }, (_, i) => styles.getW(i)))).toEqual(new Set([0, 7, 8]));
    for (let i = 0; i < styles.count; i += 3) {
      expect(styles.getW(i)).toBe(styles.getW(i + 1));
      expect(styles.getW(i)).toBe(styles.getW(i + 2));
    }
    baked.dispose(); baseline.dispose(); geometry.dispose();
    wall.dispose(); glass.dispose(); trim.dispose();
  });
  it('adds filtered brick, stone and roof joints to the existing facade shader', () => {
    const material = new THREE.MeshToonMaterial();
    paintHoofingtonFacades(material, 2);
    const shader = shaderFor(material);
    expect(shader.uniforms.uFacadeScale?.value).toBe(.5);
    expect(shader.fragmentShader).toContain('mod(floor(course), 2.0)');
    expect(shader.fragmentShader).toContain('paintedJoint(m.z / 1.35');
    expect(shader.fragmentShader).toContain('glazing');
    expect(shader.fragmentShader).toContain('fwidth');
    material.dispose();
  });
  it('composes with existing shaders and preserves separate material program keys', () => {
    const a = new THREE.MeshToonMaterial(), b = new THREE.MeshToonMaterial();
    a.onBeforeCompile = shader => { shader.uniforms.original = { value: 7 }; };
    paintPropFinish(a, 'concrete', 1.5); paintPropFinish(b, 'timber', 1.5);
    const shader = shaderFor(a);
    expect(shader.uniforms.original?.value).toBe(7);
    expect(shader.uniforms.uFinishScale?.value).toBeCloseTo(2 / 3);
    expect(shader.vertexShader).toContain('length(instanceMatrix[0].xyz)');
    expect(shader.fragmentShader).toContain('fwidth(p)');
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(propFinish('concrete-column')).toBe('concrete');
    expect(propFinish('container')).toBe('corrugated');
    expect(propFinish('pier')).toBe('timber');
    expect(propFinish('tree-oak')).toBeUndefined();
    a.dispose(); b.dispose();
  });
});
