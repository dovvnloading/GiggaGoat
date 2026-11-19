import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Matrix4, MathUtils, Vector3, Vector4 } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sectionCenter } from './access-path';
import { pinesLogEntries } from './pines-log-access';
import { accessPathVisual } from './visual-access-path';
import type { IslandData, PropDescriptor, Vec3 } from './types';

/** Exposed turf at the buried timber ends becomes an earthen approach. */
export function paintPinesLogAprons(shader: WebGLProgramParametersWithUniforms, island: IslandData): void {
  const bridge = island.props.find(prop => prop.poiId === 'whispering-pines' && prop.kind === 'log-bridge');
  if (!bridge) return;
  const scale = island.size / 600;
  const aprons = pinesLogEntries(island, bridge).map(({ side, sections: [start, end] }) => {
    const toe = sectionCenter(start), firstJoint = sectionCenter(end);
    const dx = firstJoint.x - toe.x, dz = firstJoint.z - toe.z;
    const length = Math.hypot(dx, dz);
    const halfWidth = (section: typeof start) =>
      Math.hypot(section.outer.x - section.inner.x, section.outer.z - section.inner.z) / (2 * scale);
    // The south bank's crossfall hides timber farther into the approach.
    const cover = side < 0 ? .82 : .42;
    return {
      frame: new Vector4(toe.x, toe.z, dx / length, dz / length),
      limit: new Vector3(halfWidth(start), MathUtils.lerp(halfWidth(start), halfWidth(end), cover),
        length * cover / scale),
    };
  });
  shader.uniforms['uPinesApronFrame'] = { value: aprons.map(apron => apron.frame) };
  shader.uniforms['uPinesApronLimit'] = { value: aprons.map(apron => apron.limit) };
  shader.uniforms['uPinesApronSoil'] = { value: new Color(0x977b59) };
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec4 uPinesApronFrame[${aprons.length}];
uniform vec3 uPinesApronLimit[${aprons.length}];
uniform vec3 uPinesApronSoil;

vec3 pinesApronGround(vec3 terrain, vec2 world, float scale) {
  for (int i = 0; i < ${aprons.length}; i++) {
    vec4 frame = uPinesApronFrame[i];
    vec2 delta = (world - frame.xy) / scale;
    if (max(abs(delta.x), abs(delta.y)) > 2.5) continue;
    vec3 limit = uPinesApronLimit[i];
    float along = dot(delta, frame.zw);
    float across = dot(delta, vec2(-frame.w, frame.z));
    float width = mix(limit.x, limit.y, clamp(along / limit.z, 0.0, 1.0));
    float shoulder = 1.0 - smoothstep(width - 0.22, width + 0.03, abs(across));
    float approach = smoothstep(-1.25, -0.70, along) *
      (1.0 - smoothstep(limit.z - 0.42, limit.z, along));
    float blend = shoulder * approach;
    if (blend <= 0.0) continue;
    float tone = 0.98 + 0.025 * sin(2.7 * along + across) * sin(3.1 * across - along);
    return mix(terrain, uPinesApronSoil * tone, blend * 0.94);
  }
  return terrain;
}`).replace('#include <alphamap_fragment>', `diffuseColor.rgb = pinesApronGround(diffuseColor.rgb, vWorld.xz, uTerrainScale);
#include <alphamap_fragment>`);
}

/** Add both bank treads to the current log batch, in its instance-local coordinates. */
export function appendPinesLogEntries(source: BufferGeometry, island: IslandData, bridge: PropDescriptor): BufferGeometry {
  const scale = island.size / 600;
  const entries = pinesLogEntries(island, bridge);
  const timber = [0x9a714c, 0xa47b53, 0x956d49, 0xab8058];
  const sample = (start: Vec3, end: Vec3, t: number): number[] => [
    MathUtils.lerp(start.x, end.x, t), MathUtils.lerp(start.y, end.y, t) + .003 * scale,
    MathUtils.lerp(start.z, end.z, t),
  ];
  const joinery = entries.flatMap(({ sections, supports }) => {
    const planks = sections.slice(1).flatMap((b, segment) => {
      const a = sections[segment]!;
      const length = Math.hypot(b.outer.x - a.outer.x, b.outer.z - a.outer.z);
      const count = Math.max(1, Math.round(length / (.48 * scale)));
      return Array.from({ length: count }, (_, index) => {
        const from = (index + .018) / count, to = (index + .982) / count;
        const left = sample(a.outer, b.outer, from), right = sample(a.inner, b.inner, from);
        const topLeft = sample(a.outer, b.outer, to), topRight = sample(a.inner, b.inner, to);
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute([
          ...left, ...right, ...topRight, ...left, ...topRight, ...topLeft,
        ], 3));
        geometry.computeVertexNormals();
        return { geometry, color: timber[(segment + index) % timber.length]! };
      });
    });
    const legs = supports.map(({ size, transform: { position, rotationY } }) => ({
      geometry: new BoxGeometry(size.x, size.y, size.z).rotateY(rotationY)
        .translate(position.x, position.y, position.z),
      color: 0x6e4e36,
    }));
    return [...planks, ...legs];
  });
  const tread = accessPathVisual('pines-bank-timber', entries.map(entry => [...entry.sections]), [],
    entries[0]!.thickness, scale, 0x6d4c33, 0x6d4c33, joinery);
  const { position, rotationY } = bridge.transform;
  const { x, y, z } = bridge.size;
  tread.geometry.applyMatrix4(new Matrix4().makeScale(1 / x, 1 / y, 1 / z)
    .multiply(new Matrix4().makeRotationY(-rotationY))
    .multiply(new Matrix4().makeTranslation(-position.x, -position.y, -position.z)));
  source.deleteAttribute('uv');
  const combined = mergeGeometries([source, tread.geometry], false);
  tread.geometry.dispose();
  (tread.material as import('three').Material).dispose();
  if (!combined) throw new Error('Pines log and bank treads must share the same vertex attributes');
  combined.computeBoundingBox();
  combined.computeBoundingSphere();
  source.dispose();
  return combined;
}
