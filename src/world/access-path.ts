import type { PropColliderDescriptor, Vec3 } from './types';

export interface AccessSection {
  outer: Vec3;
  inner: Vec3;
}

export function sectionCenter(section: AccessSection): Vec3 {
  return {
    x: (section.outer.x + section.inner.x) / 2,
    y: (section.outer.y + section.inner.y) / 2,
    z: (section.outer.z + section.inner.z) / 2,
  };
}

export function accessGuard(sections: readonly AccessSection[],
  side: keyof AccessSection, scale: number): AccessSection[] {
  return sections.map(section => {
    const edge = section[side];
    const across = section[side === 'outer' ? 'inner' : 'outer'];
    const width = Math.hypot(across.x - edge.x, across.z - edge.z);
    const inset = .18 * scale / width;
    const y = edge.y + 1.22 * scale;
    return {
      outer: { ...edge, y },
      inner: {
        x: edge.x + (across.x - edge.x) * inset,
        y,
        z: edge.z + (across.z - edge.z) * inset,
      },
    };
  });
}

export function accessSlabs(prefix: string, sections: readonly AccessSection[],
  thickness: number): PropColliderDescriptor[] {
  return sections.slice(1).map((end, index) => {
    const start = sections[index]!;
    const corners = [start.outer, start.inner, end.inner, end.outer];
    const position = sectionCenter(start);
    const vertices = new Float32Array([0, -thickness].flatMap(lift =>
      corners.flatMap(p => [p.x - position.x, p.y - position.y + lift, p.z - position.z])));
    const extent = (axis: keyof Vec3): number => {
      const samples = corners.map(p => p[axis]);
      return Math.max(...samples) - Math.min(...samples);
    };
    return {
      id: prefix + index,
      shape: 'convex',
      body: { type: 'static' },
      transform: { position, rotationY: 0 },
      size: { x: extent('x'), y: extent('y') + thickness, z: extent('z') },
      vertices,
    };
  });
}
