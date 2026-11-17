import * as THREE from 'three';
import type { IslandData, RiverPoint } from './types';
import { gridSample } from './terrain';

interface AnimatedUniforms {
  uTime: { value: number };
  uLevel: { value: number };
}
export interface WaterVisuals {
  sea: THREE.Mesh;
  inland: THREE.Group;
  update(time: number, tide: number): void;
}

/** Float height atlas lets the sea shade by actual terrain depth, including rising tide. */
function seaMaterial(island: IslandData): { material: THREE.ShaderMaterial;
  uniforms: AnimatedUniforms } {
  const atlas = new THREE.DataTexture(
    island.heights.slice(), island.resolution, island.resolution,
    THREE.RedFormat, THREE.FloatType,
  );
  atlas.magFilter = THREE.LinearFilter;
  atlas.minFilter = THREE.LinearFilter;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.needsUpdate = true;
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: island.seaLevel },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uTerrain: { value: atlas },
      uSize: { value: island.size },
      uShallow: { value: new THREE.Color('#21A8C6') },
      uDeep: { value: new THREE.Color('#0F669E') },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: [
      'uniform float uTime;',
      'varying vec3 vWorld;',
      'void main() {',
      '  vec3 p = position;',
      '  p.z -= 0.15 * sin(position.x * 0.10 + uTime * 1.7)',
      '        + 0.11 * cos(position.y * 0.12 - uTime * 1.3);',
      '  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uTerrain;',
      'uniform float uSize, uLevel, uTime;',
      'uniform vec3 uShallow, uDeep;',
      'varying vec3 vWorld;',
      'void main() {',
      '  vec2 atlasUV = clamp(vWorld.xz / uSize + 0.5, 0.0, 1.0);',
      '  float ground = texture2D(uTerrain, atlasUV).r;',
      '  float depth = max(0.0, uLevel - ground);',
      '  float shallow = smoothstep(0.0, 36.0, depth);',
      '  vec3 color = mix(uShallow, uDeep, shallow);',
      '  // One shared moving wave controls both colour bands and shoreline foam.',
      '  // Formerly every fragment evaluated six transcendental operations,',
      '  // a noise hash and a pow(., 22) sparkle even over the open ocean.',
      '  float wave = 0.5 + 0.5 * sin(dot(vWorld.xz, vec2(0.23, 0.18))',
      '    + uTime * 1.25);',
      '  color += vec3(0.025, 0.060, 0.062) * wave * (1.0 - shallow);',
      '  float coast = 1.0 - smoothstep(0.35, 3.9, depth);',
      '  float foam = smoothstep(0.68, 0.97, wave);',
      '  color = mix(color, vec3(0.88, 0.96, 0.92), coast * foam * 0.66);',
      '  float cover = smoothstep(-0.24, 0.48, uLevel - ground);',
      '  gl_FragColor = vec4(color, 0.88 * cover);',
      '}',
    ].join('\n'),
  });
  // Release the height atlas with the shader, not by allocating one per frame.
  const originalDispose = material.dispose.bind(material);
  material.dispose = (): void => { atlas.dispose(); originalDispose(); };
  return { material, uniforms };
}
function inlandMaterial(): { material: THREE.ShaderMaterial; time: { value: number } } {
  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: [
      'varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  vUv = uv;',
      '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime; varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  float stream = sin(vUv.y * 45.0 - uTime * 5.0 +',
      '    sin(vWorld.x * 0.16) * 2.0);',
      '  float edge = smoothstep(0.72, 0.97, abs(vUv.x * 2.0 - 1.0));',
      '  float streak = smoothstep(0.62, 0.94, stream);',
      '  vec3 blue = mix(vec3(0.09, 0.57, 0.72), vec3(0.29, 0.79, 0.84),',
      '    0.48 + 0.2 * stream);',
      '  vec3 col = mix(blue, vec3(0.92, 0.98, 0.92),',
      '    edge * (0.46 + streak * 0.42) + streak * 0.12);',
      '  gl_FragColor = vec4(col, 0.91);',
      '}',
    ].join('\n'),
  });
  return { material, time };
}
function riverMesh(points: readonly RiverPoint[], material: THREE.Material): THREE.Mesh {
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  let accumulated = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!, a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length, nz = dx / length;
    if (i) {
      const prev = points[i - 1]!;
      accumulated += Math.hypot(p.x - prev.x, p.z - prev.z);
    }
    const y = p.level + 0.12;
    vertices.push(p.x - nx * p.width * 0.5, y, p.z - nz * p.width * 0.5,
      p.x + nx * p.width * 0.5, y, p.z + nz * p.width * 0.5);
    uvs.push(0, accumulated / 10, 1, accumulated / 10);
    if (i > 0) {
      const k = i * 2;
      indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rippling-river';
  return mesh;
}
function makeFalls(group: THREE.Group, material: THREE.Material,
  a: THREE.Vector3, b: THREE.Vector3, width: number, id: string): void {
  const direction = new THREE.Vector3().subVectors(b, a);
  const side = new THREE.Vector3(direction.z, 0, -direction.x).normalize()
    .multiplyScalar(width / 2);
  if (side.lengthSq() < 0.001) side.set(width / 2, 0, 0);
  const vertices = [
    ...a.clone().sub(side).toArray(), ...a.clone().add(side).toArray(),
    ...b.clone().sub(side).toArray(), ...b.clone().add(side).toArray(),
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 0,5, 1,5], 2));
  g.setIndex([0,2,1, 1,2,3]);
  g.computeVertexNormals();
  const fall = new THREE.Mesh(g, material);
  fall.name = id;
  group.add(fall);
  const foam = new THREE.Mesh(new THREE.TorusGeometry(width * 0.44, 0.27, 5, 24),
    new THREE.MeshBasicMaterial({
      color: 0xe5ffff, transparent: true, opacity: 0.75, depthWrite: false,
    }));
  foam.position.copy(b);
  foam.rotation.x = -Math.PI / 2;
  group.add(foam);
}
/** Reusable animated sea, river, reservoir and waterfall visual effects. */
export function buildWaterVisuals(island: IslandData): WaterVisuals {
  const seaMat = seaMaterial(island);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(island.size * 2.15, island.size * 2.15, 96, 96),
    seaMat.material,
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = island.seaLevel;
  sea.name = 'rising-sea';
  sea.renderOrder = 2;
  const inland = new THREE.Group();
  inland.name = 'rivers-reservoir-and-falls';
  const stream = inlandMaterial();
  // The bespoke Dam plunge-pool surface occupies the middle reaches. Do
  // not draw the old thin river ribbon over it: its extra side vertices
  // make a bright diagonal sheet across the otherwise sculpted pool.
  const upstream = riverMesh(island.river.slice(0, 5), stream.material);
  upstream.name = 'rippling-river';
  const forestOutflow = riverMesh(island.river.slice(10), stream.material);
  forestOutflow.name = 'forest-river-after-dam';
  inland.add(upstream, forestOutflow);
  const lake = island.reservoir;
  const reservoir = new THREE.Mesh(new THREE.CircleGeometry(1, 64), stream.material);
  reservoir.name = 'dam-reservoir';
  reservoir.rotation.x = -Math.PI / 2;
  reservoir.position.set(lake.center.x, lake.level + 0.12, lake.center.z);
  reservoir.scale.set(lake.radiusX, lake.radiusZ, 1);
  inland.add(reservoir);
  // Cascades wherever a river segment descends across a mountain terrace.
  for (let i = 0; i < island.river.length - 1; i++) {
    const a = island.river[i]!, b = island.river[i + 1]!;
    if (a.level - b.level < 3.4 * island.size / 600) continue;
    const x = (a.x + b.x) * 0.5, z = (a.z + b.z) * 0.5;
    makeFalls(inland, stream.material,
      new THREE.Vector3(x, a.level + 0.3, z),
      new THREE.Vector3(x + (b.x - a.x) * 0.18, b.level + 0.2,
        z + (b.z - a.z) * 0.18), (a.width + b.width) * 0.4,
      'mountain-waterfall-' + i);
  }
  const scale = island.size / 600;
  // Visible terrace cascades on the southeast face. The northern stream's
  // waterfalls are on the opposite side of Mt. Gigga from bookmark 12.
  // Anchor each curtain to the sampled terraced slope, rather than projecting
  // giant floating waterfall billboards from an arbitrary height.
  for (const [i, angle] of [0.54, 0.89].entries()) {
    const upperRadius = (i === 0 ? 38 : 74) * scale;
    const lowerRadius = (i === 0 ? 46 : 83) * scale;
    const x0 = Math.cos(angle) * upperRadius, z0 = Math.sin(angle) * upperRadius;
    const x1 = Math.cos(angle) * lowerRadius, z1 = Math.sin(angle) * lowerRadius;
    const upper = gridSample(island, x0, z0);
    const lower = gridSample(island, x1, z1);
    if (upper - lower > 3 * scale) {
      makeFalls(inland, stream.material,
        new THREE.Vector3(x0, upper + 0.26 * scale, z0),
        new THREE.Vector3(x1, lower + 0.18 * scale, z1),
        (i === 0 ? 5.1 : 4.2) * scale,
        'front-terrace-waterfall-' + (i + 1));
    }
  }
  // The four spillway sheets and their foam now come from the custom Dam GLB.
  // Keep the mountain and river cascades, but do not draw duplicate dam falls.
  return {
    sea, inland,
    update(time: number, tide: number): void {
      seaMat.uniforms.uTime.value = time;
      seaMat.uniforms.uLevel.value = tide;
      stream.time.value = time;
      sea.position.y = tide;
      inland.visible = tide < lake.level + 2 * scale;
    },
  };
}
