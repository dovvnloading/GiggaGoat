import * as THREE from 'three';

/**
 * Retain the former 96×96 sea grid around the island, then fan its square
 * perimeter into three sparse circular rings. Only the distant edge changes:
 * shoreline waves keep their original vertex spacing and the last ring has
 * no square silhouette from elevated cameras.
 */
export function circularSeaGeometry(islandSize: number, divisions = 96, half = islandSize * 2.15 / 2): THREE.BufferGeometry {
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
