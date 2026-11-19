import * as THREE from 'three';
import { circularSeaGeometry } from '../world/sea-geometry';
import { gridSample } from '../world/terrain';
import { pixel } from './SoftwareFrame';
import { softwareGeometry, type SoftwareGeometry } from './software-geometry';

interface SeaSurface {
  geometry: SoftwareGeometry;
  ground: Float32Array;
  interior: Float32Array;
  colours: Uint32Array;
  lastLevel: number;
}

const surfaces = new WeakMap<THREE.ShaderMaterial, SeaSurface>();
const smooth = THREE.MathUtils.smoothstep;

/** Sample the same height atlas, tide and water palette as the GLSL sea. */
export function softwareSea(material: THREE.ShaderMaterial): SeaSurface | undefined {
  const u = material.uniforms;
  const atlas = u.uTerrain?.value as THREE.DataTexture | undefined;
  if (!atlas) return;
  const size = u.uSize!.value as number;
  const level = u.uLevel!.value as number;
  let surface = surfaces.get(material);
  if (!surface) {
    const grid = circularSeaGeometry(size, 48, size * .53);
    const geometry = softwareGeometry(grid, 'full');
    grid.dispose();
    const count = geometry.sources.length;
    const ground = new Float32Array(count), interior = new Float32Array(count);
    const terrain = { size, heights: atlas.image.data as Float32Array, resolution: atlas.image.width };
    for (let i = 0; i < count; i++) {
      const x = geometry.positions[3 * i]!, z = -geometry.positions[3 * i + 1]!;
      ground[i] = gridSample(terrain, x, z);
      interior[i] = 1 - smooth(Math.max(Math.abs(x), Math.abs(z)) / size, .48, .5);
    }
    surface = { geometry, ground, interior, colours: new Uint32Array(count), lastLevel: -Infinity };
    surfaces.set(material, surface);
  }
  if (Math.abs(level - surface.lastLevel) < .06 * size / 600) return surface;
  surface.lastLevel = level;
  const flood = smooth((level - u.uSeaDatum!.value) * 600 / size, 8, 30);
  const shelf = THREE.MathUtils.lerp(36, 11 * size / 600, flood);
  const shallow = (u.uShallow!.value as THREE.Color).getHex();
  const deep = (u.uDeep!.value as THREE.Color).getHex();
  const dr = deep >>> 16, dg = deep >>> 8 & 255, db = deep & 255;
  for (let i = 0; i < surface.colours.length; i++) {
    const depth = level - surface.ground[i]!;
    const shoal = (1 - smooth(depth, 0, shelf)) * surface.interior[i]! * (1 - flood * .58);
    surface.colours[i] = pixel(dr + ((shallow >>> 16) - dr) * shoal,
      dg + ((shallow >>> 8 & 255) - dg) * shoal, db + ((shallow & 255) - db) * shoal);
  }
  return surface;
}

const damColours = new WeakMap<SoftwareGeometry, { colours: Uint32Array; phase: number }>();

/** The river mesh carries outlet coordinates; the reservoir carries depth at each vertex. */
export function softwareDamWater(mesh: THREE.Mesh, material: THREE.ShaderMaterial, data: SoftwareGeometry): Uint32Array {
  const u = material.uniforms;
  const phase = Math.floor(u.uTime!.value * 12);
  let cache = damColours.get(data);
  if (cache?.phase === phase) return cache.colours;
  if (!cache) {
    cache = { colours: new Uint32Array(data.sources.length), phase };
    damColours.set(data, cache);
  }
  cache.phase = phase;
  const depth = mesh.geometry.getAttribute('depth'), time = phase / 12;
  const outlets = u.uOutlets?.value as THREE.Vector4 | undefined;
  const impact = u.uImpact?.value as THREE.Vector2 | undefined;
  for (let i = 0; i < data.sources.length; i++) {
    const x = data.positions[3 * i]!, z = data.positions[3 * i + 2]!;
    if (depth) {
      const deep = smooth(depth.getX(data.sources[i]!) / u.uScale!.value, 0, 2.9);
      const ripple = Math.sin(x * .48 + z * .32 - time * 1.12);
      cache.colours[i] = pixel(77 - 44 * deep + 3 * ripple, 186 - 69 * deep + 5 * ripple,
        176 - 15 * deep + 5 * ripple);
    } else if (outlets && impact) {
      const run = z - impact.x, bend = smooth(run, 3, 25);
      let gap = Infinity;
      for (let lane = 0; lane < 4; lane++) {
        gap = Math.min(gap, Math.abs(x - outlets.getComponent(lane) - (1.5 - lane) * bend));
      }
      const flow = Math.sin(z * .61 - time * 2.4 + Math.sin(x * .76));
      const lane = 1 - smooth(gap / impact.y, .78, 1.17);
      const foam = lane * smooth(run, -1.35, .5) * (1 - smooth(run, 2, 33)) * (.59 + .29 * flow);
      cache.colours[i] = pixel(19 + foam * 213, 166 + flow * 6 + foam * 78, 189 + flow * 6 + foam * 54);
    }
  }
  return cache.colours;
}
