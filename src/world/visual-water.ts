import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData, RiverPoint } from './types';
import { gridSample } from './terrain';

/**
 * Retain the former 96×96 sea grid around the island, then fan its square
 * perimeter into three sparse circular rings. Only the distant edge changes:
 * shoreline waves keep their original vertex spacing and the last ring has
 * no square silhouette from elevated cameras.
 */
function circularSeaGeometry(islandSize: number): THREE.BufferGeometry {
  const divisions = 96;
  const half = islandSize * 2.15 / 2;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const add = (x: number, y: number): number => {
    const index = positions.length / 3;
    positions.push(x, y, 0); // local XY; the sea rotates onto world XZ
    uvs.push(x / (2 * half) + 0.5, y / (2 * half) + 0.5);
    return index;
  };
  for (let j = 0; j <= divisions; j++) {
    for (let i = 0; i <= divisions; i++) {
      add(-half + i * 2 * half / divisions, -half + j * 2 * half / divisions);
    }
  }
  const stride = divisions + 1;
  for (let j = 0; j < divisions; j++) {
    for (let i = 0; i < divisions; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride + 1, d = a + stride;
      indices.push(a, b, c, a, c, d);
    }
  }

  // Traverse the square counter-clockwise; each ring reuses the same angles
  // so the stitched outer triangles have no gaps or T-junctions.
  const boundary: number[] = [];
  for (let i = 0; i < divisions; i++) boundary.push(i);
  for (let j = 0; j < divisions; j++) boundary.push(j * stride + divisions);
  for (let i = divisions; i > 0; i--) boundary.push(divisions * stride + i);
  for (let j = divisions; j > 0; j--) boundary.push(j * stride);
  let inner = boundary;
  for (const radius of [1.7, 2.7, 4].map(factor => factor * islandSize)) {
    const outer = boundary.map(index => {
      const x = positions[index * 3]!, y = positions[index * 3 + 1]!;
      const scale = radius / Math.hypot(x, y);
      return add(x * scale, y * scale);
    });
    for (let i = 0; i < inner.length; i++) {
      const next = (i + 1) % inner.length;
      indices.push(inner[i]!, outer[i]!, outer[next]!,
        inner[i]!, outer[next]!, inner[next]!);
    }
    inner = outer;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Extend the terrain's square border down to a deep, circular seabed.
 * Three rings share 128 angular samples: the first ray/square intersection
 * coincides with the terrain's +/-size/2 grid boundary in world XZ.
 */
function seabedSkirtGeometry(island: IslandData): THREE.BufferGeometry {
  const sides = 128;
  const scale = island.size / 600;
  const half = island.size / 2;
  const positions: number[] = [], colours: number[] = [], indices: number[] = [];
  const wetSand = new THREE.Color(0xd9c79a);
  const shallows = new THREE.Color(0x5fa9a8);
  const deep = new THREE.Color(0x1d5f73);
  for (let i = 0; i < sides; i++) {
    const theta = i * Math.PI * 2 / sides;
    const x = Math.cos(theta), z = Math.sin(theta);
    const distance = half / Math.max(Math.abs(x), Math.abs(z));
    for (const [radius, y, colour] of [
      [distance, gridSample(island, x * distance, z * distance) - 0.05 * scale, wetSand],
      [distance * 1.35, island.seaLevel - 10 * scale, shallows],
      [island.size * 4, island.seaLevel - 40 * scale, deep],
    ] as const) {
      positions.push(x * radius, y, z * radius);
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    for (let ring = 0; ring < 2; ring++) {
      const a = i * 3 + ring, b = next * 3 + ring;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

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
      // ShaderMaterial does not inject fog uniforms automatically. Include the
      // standard set so refreshFogUniforms works in real WebGL scenes.
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...uniforms,
      uTerrain: { value: atlas },
      uSize: { value: island.size },
      uShallow: { value: new THREE.Color(0x48c9c9) },
      uDeep: { value: new THREE.Color(0x2a8fc0) },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    vertexShader: [
      'uniform float uTime;',
      '#include <fog_pars_vertex>',
      'varying vec3 vWorld;',
      'void main() {',
      '  vec3 p = position;',
      '  p.z -= 0.15 * sin(position.x * 0.10 + uTime * 1.7)',
      '        + 0.11 * cos(position.y * 0.12 - uTime * 1.3);',
      '  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;',
      '  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * mvPosition;',
      '  #include <fog_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uTerrain;',
      'uniform float uSize, uLevel, uTime;',
      'uniform vec3 uShallow, uDeep;',
      'varying vec3 vWorld;',
      '#include <fog_pars_fragment>',
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
      '  #include <fog_fragment>',
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
function riverMesh(points: readonly RiverPoint[], material: THREE.Material,
  damCenter?: { x: number; z: number }): THREE.Mesh {
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
      const prev = points[i - 1]!;
      const horizontalRun = Math.hypot(p.x - prev.x, p.z - prev.z);
      const nearDam = damCenter !== undefined && Math.hypot(
        (prev.x + p.x) / 2 - damCenter.x,
        (prev.z + p.z) / 2 - damCenter.z,
      ) <= 70;
      // The Dam landscape owns steep drops by its pool and spillway. Leave
      // the vertices/UVs intact, but never emit their sloping river quads.
      if (!nearDam || prev.level - p.level <= 0.25 * horizontalRun) {
        const k = i * 2;
        indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
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
  const newWidth = width * 2.6;
  const side = new THREE.Vector3(direction.z, 0, -direction.x).normalize()
    .multiplyScalar(newWidth / 2);
  if (side.lengthSq() < 0.001) side.set(newWidth / 2, 0, 0);
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
  // Five shallow, partly submerged foam flecks share one draw per cascade.
  // Fixed size variations keep the silhouettes organic without consuming RNG.
  const offsets = [-0.4, -0.2, 0, 0.2, 0.4] as const;
  const sizeJitter = [0.94, 1.11, 0.89, 1.07, 0.97] as const;
  const foam = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xeaf8ff, transparent: true, opacity: 0.6, depthWrite: false,
    }), offsets.length);
  foam.name = id + '-foam';
  const sideways = side.clone().normalize();
  const dummy = new THREE.Object3D();
  for (const [index, offset] of offsets.entries()) {
    dummy.position.copy(b).addScaledVector(sideways, offset * newWidth);
    dummy.position.y -= newWidth * 0.03; // sink the centre below the pool surface
    const fleckWidth = newWidth * sizeJitter[index]!;
    dummy.scale.set(fleckWidth * 0.16, fleckWidth * 0.07, fleckWidth * 0.16);
    dummy.updateMatrix();
    foam.setMatrixAt(index, dummy.matrix);
  }
  foam.instanceMatrix.needsUpdate = true;
  foam.computeBoundingSphere();
  group.add(foam);
}
/** Reusable animated sea, river, reservoir and waterfall visual effects. */
export function buildWaterVisuals(island: IslandData): WaterVisuals {
  const seaMat = seaMaterial(island);
  const sea = new THREE.Mesh(
    circularSeaGeometry(island.size),
    seaMat.material,
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = island.seaLevel;
  sea.name = 'rising-sea';
  sea.renderOrder = 2;
  const skirt = new THREE.Mesh(seabedSkirtGeometry(island),
    new THREE.MeshLambertMaterial({ vertexColors: true, fog: true }));
  skirt.name = 'seabed-skirt';
  skirt.renderOrder = 1;
  skirt.castShadow = false;
  skirt.receiveShadow = false;
  // The water renderer already adds the sea to the scene. Parent the skirt
  // there without making it follow the sea's rotation or changing tide:
  // Rx(-90) * T(0, 0, -tide) * Rx(+90) cancels in world coordinates.
  skirt.rotation.x = Math.PI / 2;
  skirt.position.z = -island.seaLevel;
  sea.add(skirt);
  const inland = new THREE.Group();
  inland.name = 'rivers-reservoir-and-falls';
  const stream = inlandMaterial();
  const damPlot = island.plots.find(plot => plot.poiId === 'the-dam');
  // The bespoke Dam plunge-pool surface occupies the middle reaches. Do
  // not draw the old thin river ribbon over it: its extra side vertices
  // make a bright diagonal sheet across the otherwise sculpted pool.
  const upstream = riverMesh(island.river.slice(0, 5), stream.material,
    damPlot?.center);
  upstream.name = 'rippling-river';
  const forestOutflow = riverMesh(island.river.slice(11), stream.material,
    damPlot?.center);
  forestOutflow.name = 'forest-river-after-dam';
  // Both reaches use the same animated shader. Merge their disconnected
  // index buffers into one draw so the new shoreline foam costs no extra
  // scene mesh. The Dam plunge pool remains an intentional gap between them.
  const riverGeometry = mergeGeometries([upstream.geometry, forestOutflow.geometry]);
  if (riverGeometry) {
    upstream.geometry.dispose();
    forestOutflow.geometry.dispose();
    upstream.geometry = riverGeometry;
    inland.add(upstream);
  } else {
    inland.add(upstream, forestOutflow);
  }
  const lake = island.reservoir;
  const scale = island.size / 600;
  const reservoirHeight = lake.level - 1.5 * scale; // Visual only; gameplay lake.level stays fixed.
  const reservoirGeometry = new THREE.CircleGeometry(1, 64);
  const positions = reservoirGeometry.getAttribute('position');
  const colours: number[] = [];
  const deep = new THREE.Color(0x2a8fc0), shore = new THREE.Color(0x48c9c9);
  const paint = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    paint.copy(deep).lerp(shore, Math.min(1,
      Math.hypot(positions.getX(i), positions.getY(i))));
    colours.push(paint.r, paint.g, paint.b);
  }
  reservoirGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  // Only the reservoir shader reads the radial paint. Rivers and waterfalls
  // keep their existing animated water material, and both share the uTime clock.
  const reservoirMaterial = stream.material.clone();
  reservoirMaterial.uniforms['uTime'] = stream.material.uniforms['uTime']!;
  reservoirMaterial.vertexShader = stream.material.vertexShader
    .replace('varying vec2 vUv; varying vec3 vWorld;',
      'attribute vec3 color; varying vec3 vReservoirColor; varying vec2 vUv; varying vec3 vWorld;')
    .replace('  vUv = uv;', '  vUv = uv; vReservoirColor = color;');
  reservoirMaterial.fragmentShader = stream.material.fragmentShader
    .replace('uniform float uTime; varying vec2 vUv; varying vec3 vWorld;',
      'uniform float uTime; varying vec3 vReservoirColor; varying vec2 vUv; varying vec3 vWorld;')
    .replace('  gl_FragColor = vec4(col, 0.91);',
      '  gl_FragColor = vec4(mix(vReservoirColor, col, 0.18), 0.91);');
  const reservoir = new THREE.Mesh(reservoirGeometry, reservoirMaterial);
  reservoir.name = 'dam-reservoir';
  reservoir.rotation.x = -Math.PI / 2;
  reservoir.position.set(lake.center.x, reservoirHeight, lake.center.z);
  reservoir.scale.set(lake.radiusX, lake.radiusZ, 1);

  const foam = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.02, 64),
    new THREE.MeshBasicMaterial({
      color: 0xf2fbff, opacity: 0.7, transparent: true,
      depthWrite: false, side: THREE.DoubleSide,
    }));
  foam.name = 'dam-reservoir-foam';
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(lake.center.x, reservoirHeight + 0.05 * scale, lake.center.z);
  foam.scale.set(lake.radiusX, lake.radiusZ, 1);
  inland.add(reservoir, foam);
  // Cascades wherever a river segment descends across a mountain terrace.
  // Never overlay the bespoke Dam plot with a diagonal cyan sheet.
  const insideDamPlot = (x: number, z: number): boolean =>
    damPlot !== undefined && Math.hypot(x - damPlot.center.x,
      z - damPlot.center.z) <= damPlot.radius;
  for (let i = 0; i < island.river.length - 1; i++) {
    const a = island.river[i]!, b = island.river[i + 1]!;
    if (a.level - b.level < 3.4 * island.size / 600) continue;
    const x = (a.x + b.x) * 0.5, z = (a.z + b.z) * 0.5;
    if (insideDamPlot(x, z)) continue;
    makeFalls(inland, stream.material,
      new THREE.Vector3(x, a.level + 0.3, z),
      new THREE.Vector3(x + (b.x - a.x) * 0.18, b.level + 0.2,
        z + (b.z - a.z) * 0.18), (a.width + b.width) * 0.4,
      'mountain-waterfall-' + i);
  }
  // Visible terrace cascades on the southeast face. The northern stream's
  // waterfalls are on the opposite side of Mt. Gigga from bookmark 12.
  // Anchor each curtain to the sampled terraced slope, rather than projecting
  // giant floating waterfall billboards from an arbitrary height.
  for (const [i, angle] of [0.54, 0.89].entries()) {
    const upperRadius = (i === 0 ? 38 : 74) * scale;
    const lowerRadius = (i === 0 ? 46 : 83) * scale;
    const x0 = Math.cos(angle) * upperRadius, z0 = Math.sin(angle) * upperRadius;
    const x1 = Math.cos(angle) * lowerRadius, z1 = Math.sin(angle) * lowerRadius;
    if (insideDamPlot(x0, z0)) continue;
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
      skirt.position.z = -tide; // Keep the skirt fixed under the rising sea.
      inland.visible = tide < lake.level + 2 * scale;
    },
  };
}
