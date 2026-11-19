// AssemblyScript source for src/core/software-raster.wasm.
// Rebuild: npx --yes --package=assemblyscript@0.28.20 asc tools/software-raster.ts -o src/core/software-raster.wasm -O3 --runtime stub --importMemory --enable simd --noAssert
// A vertex is 20 bytes: screen X, screen Y, reciprocal depth, clip flags and RGBA.
@inline function channel(colour: u32, shift: u32): f32 { return f32((colour >> shift) & 255); }

/** Project a complete static instance in one call. Reuse its input storage for
 * homogeneous coordinates needed by the near-plane clipper. */
export function projectBatch(coords: usize, vertices: usize, matrix: usize, tints: usize,
  count: i32, halfWidth: f32, halfHeight: f32, near: f32, painted: bool): void {
  const xx = load<f32>(matrix), xy = load<f32>(matrix, 16), xz = load<f32>(matrix, 32), xt = load<f32>(matrix, 48);
  const yx = load<f32>(matrix, 4), yy = load<f32>(matrix, 20), yz = load<f32>(matrix, 36), yt = load<f32>(matrix, 52);
  const wx = load<f32>(matrix, 12), wy = load<f32>(matrix, 28), wz = load<f32>(matrix, 44), wt = load<f32>(matrix, 60);
  for (let i = 0; i < count; i++, coords += 12, vertices += 20) {
    const x = load<f32>(coords), y = load<f32>(coords, 4), z = load<f32>(coords, 8);
    const cx = xx * x + xy * y + xz * z + xt, cy = yx * x + yy * y + yz * z + yt;
    const w = wx * x + wy * y + wz * z + wt, iz: f32 = w >= near ? 1 / w : 0;
    store<f32>(coords, cx); store<f32>(coords, cy, 4); store<f32>(coords, w, 8);
    store<f32>(vertices, halfWidth * (1 + cx * iz));
    store<f32>(vertices, halfHeight * (1 - cy * iz), 4);
    store<f32>(vertices, iz, 8);
    store<u32>(vertices, u32(cx < -w) | (u32(cx > w) << 1) | (u32(cy < -w) << 2) |
      (u32(cy > w) << 3) | (u32(w < near) << 4), 12);
    if (painted) store<u32>(vertices, load<u32>(tints + usize(i * 4)), 16);
  }
}

function triangle(width: i32, height: i32, pixels: usize, depths: usize,
  a: usize, b: usize, c: usize, colour: u32, side: i32, bias: f32, smooth: bool): void {
  let ax = load<f32>(a), ay = load<f32>(a, 4);
  let bx = load<f32>(b), by = load<f32>(b, 4);
  let cx = load<f32>(c), cy = load<f32>(c, 4);
  let det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (abs(det) < .02 || (side == 0 && det > 0) || (side == 1 && det < 0)) return;
  let swap: usize;
  if (ay > by) { swap = a; a = b; b = swap; }
  if (load<f32>(b, 4) > load<f32>(c, 4)) { swap = b; b = c; c = swap; }
  if (load<f32>(a, 4) > load<f32>(b, 4)) { swap = a; a = b; b = swap; }
  ax = load<f32>(a); ay = load<f32>(a, 4);
  bx = load<f32>(b); by = load<f32>(b, 4);
  cx = load<f32>(c); cy = load<f32>(c, 4);
  const abx = bx - ax, aby = by - ay, acx = cx - ax, acy = cy - ay;
  const inv = f32(1) / (abx * acy - aby * acx);
  const az = load<f32>(a, 8) * bias, bz = load<f32>(b, 8) * bias, cz = load<f32>(c, 8) * bias;
  const dz = ((bz - az) * acy - (cz - az) * aby) * inv;
  const ca = load<u32>(a, 16), cb = load<u32>(b, 16), cc = load<u32>(c, 16);
  const ar = channel(ca, 0), ag = channel(ca, 8), ab = channel(ca, 16);
  const cr = channel(cc, 0) - ar, cg = channel(cc, 8) - ag, blueDiff = channel(cc, 16) - ab;
  const dr = ((channel(cb, 0) - ar) * acy - cr * aby) * inv;
  const dg = ((channel(cb, 8) - ag) * acy - cg * aby) * inv;
  const db = ((channel(cb, 16) - ab) * acy - blueDiff * aby) * inv;
  const lane = f32x4(0, 1, 2, 3);
  const zLane = f32x4.mul(lane, f32x4.splat(dz)), zStep = f32x4.splat(4 * dz);
  const rLane = f32x4.mul(lane, f32x4.splat(dr)), rStep = f32x4.splat(4 * dr);
  const gLane = f32x4.mul(lane, f32x4.splat(dg)), gStep = f32x4.splat(4 * dg);
  const bLane = f32x4.mul(lane, f32x4.splat(db)), bStep = f32x4.splat(4 * db);
  const flat = i32x4.splat(colour), alpha = i32x4.splat(0xff000000);
  const yEnd = min(height, i32(ceil(cy - .5)));
  for (let y = max(0, i32(ceil(ay - .5))); y < yEnd; y++) {
    const sy = f32(y) + .5, t = (sy - ay) / acy;
    const x1 = ax + acx * t;
    const x2 = sy < by ? ax + abx * (sy - ay) / aby : bx + (cx - bx) * (sy - by) / (cy - by);
    const first = max(0, i32(ceil(min(x1, x2) - .5)));
    const end = min(width, i32(ceil(max(x1, x2) - .5)));
    if (first >= end) continue;
    const offset = f32(first) + .5 - x1;
    const z0 = az + (cz - az) * t + offset * dz;
    const r0 = ar + cr * t + offset * dr, g0 = ag + cg * t + offset * dg;
    const b0 = ab + blueDiff * t + offset * db;
    let z4 = f32x4.add(f32x4.splat(z0), zLane);
    let r4 = f32x4.add(f32x4.splat(r0), rLane), g4 = f32x4.add(f32x4.splat(g0), gLane);
    let b4 = f32x4.add(f32x4.splat(b0), bLane);
    let at = usize((y * width + first) * 4), x = first;
    for (; x + 4 <= end; x += 4, at += 16) {
      const previous = v128.load(depths + at), mask = f32x4.gt(z4, previous);
      if (v128.any_true(mask)) {
        let value = flat;
        if (smooth) {
          value = v128.or(alpha, v128.or(i32x4.trunc_sat_f32x4_u(r4),
            v128.or(i32x4.shl(i32x4.trunc_sat_f32x4_u(g4), 8),
              i32x4.shl(i32x4.trunc_sat_f32x4_u(b4), 16))));
        }
        v128.store(depths + at, v128.bitselect(z4, previous, mask));
        v128.store(pixels + at, v128.bitselect(value, v128.load(pixels + at), mask));
      }
      z4 = f32x4.add(z4, zStep);
      if (smooth) { r4 = f32x4.add(r4, rStep); g4 = f32x4.add(g4, gStep); b4 = f32x4.add(b4, bStep); }
    }
    for (; x < end; x++, at += 4) {
      const n = f32(x - first), depth = z0 + n * dz;
      if (depth <= load<f32>(depths + at)) continue;
      store<f32>(depths + at, depth);
      store<u32>(pixels + at, smooth ? 0xff000000 | (u32(b0 + db * n) << 16) |
        (u32(g0 + dg * n) << 8) | u32(r0 + dr * n) : colour);
    }
  }
}

// Return near-plane intersections to the shared clipper. All passes share depth.
export function drawBatch(width: i32, height: i32, pixels: usize, depths: usize,
  vertices: usize, indices: usize, colours: usize, intersections: usize, faces: i32,
  side: i32, bias: f32, smooth: bool): i32 {
  let pending = 0;
  for (let i = 0; i < faces; i++) {
    const k = indices + usize(i * 12);
    const a = vertices + 20 * load<u32>(k), b = vertices + 20 * load<u32>(k, 4);
    const c = vertices + 20 * load<u32>(k, 8);
    const maskA = load<u32>(a, 12), maskB = load<u32>(b, 12), maskC = load<u32>(c, 12);
    if ((maskA & maskB & maskC) != 0) continue;
    if (((maskA | maskB | maskC) & 16) != 0) {
      store<u32>(intersections + usize(pending++ * 4), i);
      continue;
    }
    triangle(width, height, pixels, depths, a, b, c,
      smooth ? 0 : load<u32>(colours + usize(i * 4)), side, bias, smooth);
  }
  return pending;
}
