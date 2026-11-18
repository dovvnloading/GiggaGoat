import * as THREE from 'three';
import type { IslandData } from './types';
import { ROADSIDE_GRAVEL, roadsideStops } from './roadside-stops';

/** Tint the real ground so the small turnouts remain seated at every terrain LOD. */
export function paintRoadsideGravel(shader: THREE.WebGLProgramParametersWithUniforms, island: IslandData): void {
  const stops = roadsideStops(island);
  if (!stops.length) return;
  shader.uniforms['uRoadsideFrames'] = { value: stops.map(stop =>
    new THREE.Vector4(stop.origin.x, stop.origin.z, stop.tangent.x, stop.tangent.z)) };
  shader.uniforms['uRoadsideSides'] = { value: stops.map(stop => stop.plan.side) };
  shader.uniforms['uRoadsideGravel'] = { value: stops.map(stop => new THREE.Color(stop.plan.gravel)) };
  const { laneHalfWidth, laneStart, laneEnd, padAlongRadius, padAcrossCentre, padAcrossRadius } = ROADSIDE_GRAVEL;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec4 uRoadsideFrames[${stops.length}];
uniform float uRoadsideSides[${stops.length}];
uniform vec3 uRoadsideGravel[${stops.length}];

vec3 roadsideGravel(vec3 ground, vec2 world, float scale) {
  for (int i = 0; i < ${stops.length}; i++) {
    vec4 frame = uRoadsideFrames[i];
    vec2 delta = (world - frame.xy) / scale;
    if (dot(delta, delta) > 660.0) continue;
    float along = dot(delta, frame.zw);
    float across = dot(delta, vec2(-frame.w, frame.z)) * uRoadsideSides[i];
    float lane = min(${laneHalfWidth.toFixed(2)} - abs(along), min(across - ${laneStart.toFixed(2)}, ${laneEnd.toFixed(2)} - across));
    float pad = 1.0 - length(vec2(along / ${padAlongRadius.toFixed(2)}, (across - ${padAcrossCentre.toFixed(2)}) / ${padAcrossRadius.toFixed(2)}));
    float edge = max(lane, pad * ${padAcrossRadius.toFixed(2)});
    float mask = smoothstep(-0.35, 0.52, edge);
    if (mask < 0.01) continue;
    float grain = 0.97 + 0.025 * sin(along * 3.9 + across * 2.1) * sin(across * 4.2);
    return mix(ground, uRoadsideGravel[i] * grain, mask * 0.91);
  }
  return ground;
}`).replace('diffuseColor.rgb = mix(diffuseColor.rgb, uStone, rock);',
    `diffuseColor.rgb = mix(diffuseColor.rgb, uStone, rock);
diffuseColor.rgb = roadsideGravel(diffuseColor.rgb, vWorld.xz, uTerrainScale);`);
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, direction: number): void {
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 23 * direction, y);
  ctx.lineTo(x + 22 * direction, y);
  ctx.moveTo(x + 3 * direction, y - 20);
  ctx.lineTo(x + 23 * direction, y);
  ctx.lineTo(x + 3 * direction, y + 20);
  ctx.stroke();
}

/** One atlas labels both readable faces of each ordinary, collidable signpost. */
export function buildRoadsideSigns(island: IslandData): THREE.Mesh | null {
  const stops = roadsideStops(island);
  if (!stops.length || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const width = 512, height = 128;
  canvas.width = width * 2;
  canvas.height = height * stops.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const [row, stop] of stops.entries()) {
    const sign = island.props.find(p => p.id === 'roadside-' + stop.plan.id + '-sign')!;
    const { position } = sign.transform;
    for (const col of [0, 1]) {
      const face = col === 0 ? 1 : -1;
      const arrow = -stop.plan.side * face;
      const startX = col * width, startY = row * height;
      ctx.fillStyle = stop.plan.sign;
      ctx.fillRect(startX, startY, width, height);
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#fae8bd';
      ctx.strokeRect(startX + 9, startY + 9, width - 18, height - 18);
      ctx.fillStyle = '#fff4da';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 56px sans-serif';
      ctx.fillText(stop.plan.title, startX + width / 2 - arrow * 31, startY + 67, width - 118);
      drawArrow(ctx, startX + width / 2 + arrow * 199, startY + 65, arrow);

      const forward = stop.tangent;
      // The signpost GLB's inset panel reaches 0.23 of its fitted depth.
      const forwardOffset = .24 * sign.size.z * face;
      const centerX = position.x + forward.x * forwardOffset;
      const centerZ = position.z + forward.z * forwardOffset;
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const horizontal = sign.size.x * .34 * x * arrow;
        positions.push(centerX + stop.normal.x * horizontal,
          position.y + sign.size.y * (.19 + y * .18),
          centerZ + stop.normal.z * horizontal);
        uv.push((col + (x + 1) / 2) / 2, 1 - (row + (1 - y) / 2) / stops.length);
      }
      const corner = positions.length / 3 - 4;
      indices.push(corner, corner + 1, corner + 2, corner, corner + 2, corner + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  material.addEventListener('dispose', () => texture.dispose());
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'roadside-stop-signs';
  return mesh;
}
