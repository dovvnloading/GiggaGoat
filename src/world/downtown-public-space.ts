import { Color, Vector2, Vector3, Vector4 } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import type { IslandData } from './types';

const DOWNTOWN_PUBLIC_SPACES = [
  { id: 'fountain-square', left: -29.2, right: -9.5, near: -60, far: -45.2,
    corner: 2.2, centre: 0xd6c7b3, border: 0xad9e92 },
  { id: 'market-court', left: 9.6, right: 34, near: 44.7, far: 66.5,
    corner: 2.6, centre: 0xcfa889, border: 0xaa8276 },
  { id: 'west-service-lane', left: -29.9, right: -27.05, near: -29.5, far: 33,
    corner: .65, centre: 0xadb2b6, border: 0x929da3 },
  { id: 'east-service-lane', left: 27.05, right: 29.9, near: -29.5, far: 33,
    corner: .65, centre: 0x949fa4, border: 0x7a8992 },
] as const;

function downtownCentre(island: IslandData) {
  return island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
}

/** World-space references for the same paved footprints in scenery and render. */
export function downtownPublicSpaces(island: IslandData) {
  const city = downtownCentre(island);
  const scale = island.size / 600;
  return DOWNTOWN_PUBLIC_SPACES.map(space => ({
    ...space,
    left: city.x + space.left * scale,
    right: city.x + space.right * scale,
    near: city.z + space.near * scale,
    far: city.z + space.far * scale,
    corner: space.corner * scale,
  }));
}

export function downtownPublicSpaceAt(spaces: ReturnType<typeof downtownPublicSpaces>,
  x: number, z: number, margin = 0): boolean {
  return spaces.some(space => {
    const dx = Math.min(x - space.left, space.right - x);
    const dz = Math.min(z - space.near, space.far - z);
    return Math.min(dx, dz, (dx + dz - space.corner) * Math.SQRT1_2) >= -margin;
  });
}

/** The paving is painted on the terrain, so both terrain LODs share its edges. */
export function paintDowntownGround(shader: WebGLProgramParametersWithUniforms, island: IslandData): void {
  const city = downtownCentre(island);
  const spaces = DOWNTOWN_PUBLIC_SPACES;
  shader.uniforms['uDowntownOrigin'] = { value: new Vector2(city.x, city.z) };
  // The old courtyard mesh bridged the grade with long triangles. Paint its
  // footprint on the same terrain that supports the service ramp and stock.
  shader.uniforms['uDowntownServiceCourt'] = { value: new Vector3(-40, -35, 14.8) };
  shader.uniforms['uDowntownCourtStone'] = { value: new Color(0xc2b6a2) };
  shader.uniforms['uDowntownBounds'] = { value: spaces.map(s =>
    new Vector4(s.left, s.near, s.right, s.far)) };
  shader.uniforms['uDowntownCorners'] = { value: spaces.map(s => s.corner) };
  shader.uniforms['uDowntownPaving'] = { value: spaces.map(s => new Color(s.centre)) };
  shader.uniforms['uDowntownEdging'] = { value: spaces.map(s => new Color(s.border)) };
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
uniform vec2 uDowntownOrigin;
uniform vec3 uDowntownServiceCourt;
uniform vec3 uDowntownCourtStone;
uniform vec4 uDowntownBounds[${spaces.length}];
uniform float uDowntownCorners[${spaces.length}];
uniform vec3 uDowntownPaving[${spaces.length}];
uniform vec3 uDowntownEdging[${spaces.length}];

vec3 downtownGround(vec3 grass, vec2 point) {
  float aa = clamp(length(fwidth(point)), 0.035, 0.35);
  if (point.x < -55.2 || point.x > 35.0 || abs(point.y) > 68.0) return grass;
  vec2 tile = point / vec2(1.7, 1.1);
  tile.x += mod(floor(tile.y), 2.0) * 0.5;
  vec2 seam = abs(fract(tile) - 0.5);
  float grout = smoothstep(0.46 - aa * 0.35, 0.49 + aa * 0.35, max(seam.x, seam.y));
  float tone = 0.96 + mod(dot(floor(tile), vec2(3.0, 7.0)), 5.0) * 0.018;
  for (int i = 0; i < ${spaces.length}; i++) {
    vec4 bounds = uDowntownBounds[i];
    vec2 edge = min(point - bounds.xy, bounds.zw - point);
    float clearance = min(min(edge.x, edge.y), (edge.x + edge.y - uDowntownCorners[i]) * 0.7071);
    if (clearance < -aa) continue;
    vec3 stone = mix(uDowntownEdging[i], uDowntownPaving[i], smoothstep(0.48, 0.65, clearance));
    return mix(grass, stone * tone * (1.0 - grout * 0.11), smoothstep(-aa, aa, clearance));
  }
  float courtEdge = uDowntownServiceCourt.z - length(point - uDowntownServiceCourt.xy);
  float stoneTone = tone * (1.0 - grout * 0.11);
  vec3 court = uDowntownCourtStone * mix(0.86, stoneTone, smoothstep(0.4, 0.7, courtEdge));
  return mix(grass, court, smoothstep(-aa, aa, courtEdge));
}`,
  ).replace('diffuseColor.rgb = mix(diffuseColor.rgb, uStone, rock);',
    `diffuseColor.rgb = mix(diffuseColor.rgb, uStone, rock);
diffuseColor.rgb = downtownGround(diffuseColor.rgb, (vWorld.xz - uDowntownOrigin) / uTerrainScale);`,
  );
}
