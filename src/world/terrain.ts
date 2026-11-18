import type { Biome, IslandData, PlotDescriptor, ReservoirDescriptor, RiverPoint, RoadDescriptor, Vec2 } from './types';
import { BIOMES } from './types';
import { clamp, GradientNoise, hashString, lerp, smoothstep } from './random';

export function gridIndex(resolution: number, ix: number, iz: number): number {
  return iz * resolution + ix;
}
export function gridCoordinate(size: number, resolution: number, i: number): number {
  return (i / (resolution - 1) - 0.5) * size;
}
export function gridSample(island: Pick<IslandData, 'heights' | 'resolution' | 'size'>, x: number, z: number): number {
  const { resolution: n, size, heights } = island;
  const gx = clamp((x / size + 0.5) * (n - 1), 0, n - 1);
  const gz = clamp((z / size + 0.5) * (n - 1), 0, n - 1);
  const ix = Math.min(Math.floor(gx), n - 2), iz = Math.min(Math.floor(gz), n - 2);
  const u = gx - ix, v = gz - iz;
  const a = heights[gridIndex(n, ix, iz)]!;
  const b = heights[gridIndex(n, ix + 1, iz)]!;
  const c = heights[gridIndex(n, ix, iz + 1)]!;
  const d = heights[gridIndex(n, ix + 1, iz + 1)]!;
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function makeTerrain(seed: string | number, size: number, resolution: number): Float32Array {
  const noise = new GradientNoise(hashString(String(seed)));
  const heights = new Float32Array(resolution * resolution);
  const scale = size / 600;
  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const x = gridCoordinate(size, resolution, ix), z = gridCoordinate(size, resolution, iz);
      const u = x / scale, v = z / scale;
      const radius = Math.hypot(u, v);
      const angle = Math.atan2(v, u);
      // A west-coast embayment separates the lighthouse rock from the mainland.
      const westChannel = smoothstep(176, 236, -u) *
        (1 - smoothstep(55, 135, Math.abs(v + 18)));
      const coast = 272 + 11 * Math.sin(angle * 3 + 0.4)
        + 6 * Math.cos(angle * 5 - 0.6)
        + 10 * noise.fractal(u / 90, v / 90, 3) - radius - 78 * westChannel;
      const sandShelf = Math.max(0, coast);
      let h = coast < 0 ? -1.6 + coast * 0.17
        : 0.3 + Math.min(sandShelf, 33) * 0.14 +
          Math.min(Math.max(sandShelf - 33, 0), 130) * 0.027;
      if (coast > 0) {
        h += smoothstep(7, 38, coast) * noise.fractal(u / 34, v / 34, 4) * 1.65;
        // Rounded grassy benches between deliberately steep, climbable stone bands.
        // No height quantisation: both the rendered surface and Rapier are smooth.
        const mountain = 94
          - 18 * smoothstep(19, 26, radius)
          - 19 * smoothstep(38, 45, radius)
          - 18 * smoothstep(56, 63, radius)
          - 18 * smoothstep(74, 81, radius)
          - 21 * smoothstep(91, 104, radius);
        const ridge = 1 + 0.013 * noise.fractal(u / 37, v / 37, 3);
        h += mountain * ridge;
      }
      // A high, grass-capped headland with steep grey shoulders. The rock
      // drops below sea level before reaching the mainland: the bridge remains
      // the only dry crossing. Noise breaks the silhouette without touching
      // the broad, traversable summit.
      const isletRadius = Math.hypot(u + 259, v + 18);
      if (isletRadius < 37) {
        const cliff = 18.5 * (1 - smoothstep(16, 27, isletRadius))
          - 7.0 * smoothstep(25, 32, isletRadius);
        const roughness = noise.fractal(u / 9, v / 9, 3) *
          (0.48 + 0.95 * smoothstep(16, 28, isletRadius));
        h = Math.max(h, cliff + roughness);
        // The underlying broad west-coast shelf can otherwise remain +5 m
        // high exactly where the cape bridge crosses. Force a submerged
        // annulus with feathered inner/outer edges, not an exposed sand spit.
        const channel = smoothstep(25.5, 28.5, isletRadius) *
          (1 - smoothstep(36, 40, isletRadius));
        h = h + (Math.min(h, -3.2) - h) * channel;
      }

      heights[gridIndex(resolution, ix, iz)] = h * scale;
    }
  }
  return heights;
}

function visitDisc(
  island: Pick<IslandData, 'heights' | 'resolution' | 'size'>,
  x: number, z: number, range: number,
  change: (oldHeight: number, px: number, pz: number) => number,
): void {
  const { size, resolution: n, heights } = island;
  const cell = size / (n - 1);
  const left = clamp(Math.floor((x - range + size / 2) / cell), 0, n - 1);
  const right = clamp(Math.ceil((x + range + size / 2) / cell), 0, n - 1);
  const top = clamp(Math.floor((z - range + size / 2) / cell), 0, n - 1);
  const bottom = clamp(Math.ceil((z + range + size / 2) / cell), 0, n - 1);
  for (let iz = top; iz <= bottom; iz++) {
    for (let ix = left; ix <= right; ix++) {
      const px = gridCoordinate(size, n, ix), pz = gridCoordinate(size, n, iz);
      const index = gridIndex(n, ix, iz);
      heights[index] = change(heights[index]!, px, pz);
    }
  }
}

/**
 * A shallow entrance cut into the western cape, leading beneath a rock arch.
 * Heightfields cannot overhang, so the visual adapter adds a solid arch/roof
 * above this depressed, physically traversable floor. The real entrance is
 * centred on the seed-jittered cave descriptor, not the unmoved map anchor.
 */
export function sculptLighthouseSeaCave(
  island: Pick<IslandData, 'heights' | 'resolution' | 'size'>,
  center: Vec2,
): void {
  const scale = island.size / 600;
  visitDisc(island, center.x, center.z, 9 * scale, (height, x, z) => {
    const dx = (x - center.x) / scale;
    const dz = (z - center.z) / scale;
    const distance = Math.hypot(dx / 5.8, dz / 6.8);
    const weight = 1 - smoothstep(0.72, 1.12, distance);
    const floor = (1.25 + 0.12 * (dx / 5.8) ** 2) * scale;
    return lerp(height, Math.min(height, floor), weight);
  });
}

/**
 * Building footprint feathering reaches the ring of water on the cape's
 * east flank. Reopen this narrow sea channel *after* all pad grading while
 * leaving the lighthouse and keeper house foundations solid.
 */
export function preserveLighthouseChannel(
  island: Pick<IslandData, 'heights' | 'resolution' | 'size'>,
  center: Vec2,
): void {
  const scale = island.size / 600;
  visitDisc(island, center.x, center.z, 41 * scale, (h, x, z) => {
    const radius = Math.hypot(x - center.x, z - center.z) / scale;
    const channel = smoothstep(23.7, 26.3, radius) *
      (1 - smoothstep(36.0, 39.5, radius));
    return lerp(h, Math.min(h, -2.6 * scale), channel);
  });
}

/** Gentle cut-and-fill pad for buildings; final flatness independent of grid resolution. */
export function stampPlot(
  island: Pick<IslandData, 'heights' | 'resolution' | 'size'>,
  plot: PlotDescriptor,
): void {
  if (!plot.flat) return;
  const feather = 10;
  visitDisc(island, plot.center.x, plot.center.z, plot.radius + feather,
    (h, x, z) => {
      const d = Math.hypot(x - plot.center.x, z - plot.center.z);
      const weight = 1 - smoothstep(plot.radius - 3, plot.radius + feather, d);
      return lerp(h, plot.elevation, weight);
    });
}

export function segmentProjection(p: Vec2, a: Vec2, b: Vec2): { t: number; distance: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 1e-10 ? 0 :
    clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared, 0, 1);
  return { t, distance: Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz) };
}

export function riverAt(p: Vec2, river: readonly RiverPoint[]): { distance: number; level: number; width: number } {
  let best = { distance: Infinity, level: 0, width: 0 };
  for (let i = 0; i < river.length - 1; i++) {
    const a = river[i]!, b = river[i + 1]!;
    const { t, distance } = segmentProjection(p, a, b);
    if (distance < best.distance) {
      best = { distance, level: lerp(a.level, b.level, t), width: lerp(a.width, b.width, t) };
    }
  }
  return best;
}

/** Carve a continuous riverbed and broad, shallow reservoir before site grading. */
export function carveWater(
  island: Pick<IslandData, 'heights' | 'resolution' | 'size'>,
  river: RiverPoint[],
  reservoir: ReservoirDescriptor,
): void {
  for (let i = 0; i < river.length - 1; i++) {
    const a = river[i]!, b = river[i + 1]!;
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const range = Math.hypot(a.x - b.x, a.z - b.z) / 2 + Math.max(a.width, b.width) + 12;
    visitDisc(island, cx, cz, range, (h, x, z) => {
      const { t, distance } = segmentProjection({ x, z }, a, b);
      const width = lerp(a.width, b.width, t) / 2;
      if (distance > width + 8) return h;
      const level = lerp(a.level, b.level, t);
      const bed = level - 1.5 + Math.max(0, distance - width * 0.65) * 0.75;
      return lerp(h, Math.min(h, bed), 1 - smoothstep(width + 2, width + 8, distance));
    });
  }
  const { center, radiusX, radiusZ, level } = reservoir;
  visitDisc(island, center.x, center.z, Math.max(radiusX, radiusZ) + 12, (h, x, z) => {
    const d = Math.hypot((x - center.x) / radiusX, (z - center.z) / radiusZ);
    if (d >= 1.38) return h;
    return lerp(h, Math.min(h, level - 3.2 + 5 * Math.max(0, d - 0.85)),
      1 - smoothstep(0.93, 1.38, d));
  });
}

/** Stamp each sampled road segment, preserving the channel beneath a bridge. */
export function stampRoad(
  island: Pick<IslandData, 'heights' | 'resolution' | 'size'>,
  a: Vec2 & { y: number }, b: Vec2 & { y: number },
  width: number, river: readonly RiverPoint[],
): void {
  const cx = (a.x + b.x) * 0.5, cz = (a.z + b.z) * 0.5;
  const range = Math.hypot(a.x - b.x, a.z - b.z) * 0.5 + width + 6;
  visitDisc(island, cx, cz, range, (h, x, z) => {
    const { t, distance } = segmentProjection({ x, z }, a, b);
    if (distance > width / 2 + 6) return h;
    const channel = riverAt({ x, z }, river);
    if (channel.distance < channel.width / 2 + 2 && channel.level <= lerp(a.y, b.y, t) + 2) {
      return h;
    }
    const influence = 1 - smoothstep(width / 2 - 0.4, width / 2 + 6, distance);
    return lerp(h, lerp(a.y, b.y, t), influence);
  });
}

/**
 * Keep the shared render/collision terrain below the deck across its full width.
 * The extra cell diagonal covers the heightfield vertices that can reach under
 * its edge, and the surrounding feather blends the cut back into the cliff.
 */
export function clearTerrainUnderBridge(
  island: Pick<IslandData, 'heights' | 'resolution' | 'size'>,
  road: RoadDescriptor,
  deckWidth: number,
): void {
  const spans = road.points.slice(1).flatMap((b, i) => {
    const a = road.points[i]!;
    return a.bridge || b.bridge ? [{ a, b }] : [];
  });
  if (spans.length === 0) return;

  const cell = island.size / (island.resolution - 1);
  const clearance = Math.max(0.35 * island.size / 600, cell * 0.16);
  const cutWidth = deckWidth / 2 + cell * Math.SQRT2;
  const featherWidth = cutWidth + cell;
  const first = spans[0]!, last = spans[spans.length - 1]!;
  const start = first.a, finish = last.b;
  const landings = [
    { edge: start, deck: first.b, land: road.points[road.points.indexOf(start) - 1] },
    { edge: finish, deck: last.a, land: road.points[road.points.indexOf(finish) + 1] },
  ];
  const cx = (start.x + finish.x) / 2, cz = (start.z + finish.z) / 2;
  const range = Math.max(...spans.map(({ a, b }) => Math.max(
    Math.hypot(a.x - cx, a.z - cz), Math.hypot(b.x - cx, b.z - cz),
  ))) + featherWidth;

  visitDisc(island, cx, cz, range, (height, x, z) => {
    let nearest = Infinity, grade = 0;
    const point = { x, z };
    for (const { a, b } of spans) {
      const { t, distance } = segmentProjection(point, a, b);
      if (distance < nearest) {
        nearest = distance;
        grade = lerp(a.y, b.y, t);
      }
    }
    const weight = 1 - smoothstep(cutWidth, featherWidth, nearest);
    let carved = lerp(height, Math.min(height, grade - clearance), weight);
    // Ease the graded trail up to the end planks. The strip of fill under
    // each landing stays just below the deck, so the handoff works both ways.
    for (const { edge, deck, land } of landings) {
      if (!land) continue;
      const towardsLand = segmentProjection(point, edge, land);
      const towardsDeck = segmentProjection(point, edge, deck);
      const onDeck = towardsDeck.distance < towardsLand.distance;
      const projection = onDeck ? towardsDeck : towardsLand;
      const along = projection.t * Math.hypot(deck.x - edge.x, deck.z - edge.z);
      const overlap = onDeck ? 1 - smoothstep(cell * 0.75, cell * 1.75, along) : 1;
      const across = 1 - smoothstep(deckWidth / 2 + cell * 0.35, deckWidth / 2 + cell, projection.distance);
      const landingGrade = lerp(edge.y, onDeck ? deck.y : land.y, projection.t);
      carved = lerp(carved, landingGrade, overlap * across);
    }
    return carved;
  });
}

export function assignBiomes(island: IslandData): void {
  const { size, resolution: n, biomeMap, zoneMap, pois, heights } = island;
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const index = gridIndex(n, ix, iz);
    const x = gridCoordinate(size, n, ix), z = gridCoordinate(size, n, iz);
    const h = heights[index]!;
    const river = riverAt({ x, z }, island.river);
    const dx = (x - island.reservoir.center.x) / island.reservoir.radiusX;
    const dz = (z - island.reservoir.center.z) / island.reservoir.radiusZ;
    const inLake = dx * dx + dz * dz < 1 && h < island.reservoir.level;
    let biome: Biome;
    if (h < island.seaLevel - 0.5) biome = 'ocean';
    else if (inLake || (river.distance < river.width / 2 && h < river.level)) biome = 'freshwater';
    else if (h < 4) biome = 'beach';
    else if (h > 76) biome = 'cliff';
    else if (h > 30) biome = 'highlands';
    else if (Math.hypot(x + 147 * island.size / 600, z + 143 * island.size / 600) < 93 * island.size / 600) biome = 'pine-forest';
    else biome = 'meadow';
    let zone = 0;
    let nearest = Infinity;
    for (let j = 0; j < pois.length; j++) {
      const poi = pois[j]!;
      const d = Math.hypot(x - poi.center.x, z - poi.center.z);
      if (d < poi.radius * 1.4 && d < nearest) {
        zone = j + 1;
        nearest = d;
        if (biome !== 'ocean' && biome !== 'freshwater') {
          biome = poi.biome === 'town' || poi.biome === 'industrial' || poi.biome === 'farmland'
            ? poi.biome : biome;
        }
      }
    }
    const x1 = heights[gridIndex(n, Math.min(n - 1, ix + 1), iz)]!;
    const x0 = heights[gridIndex(n, Math.max(0, ix - 1), iz)]!;
    const z1 = heights[gridIndex(n, ix, Math.min(n - 1, iz + 1))]!;
    const z0 = heights[gridIndex(n, ix, Math.max(0, iz - 1))]!;
    const slope = Math.hypot(x1 - x0, z1 - z0) / (2 * size / (n - 1));
    if (slope > 1.05 && h > 12 && biome !== 'freshwater') biome = 'cliff';
    biomeMap[index] = BIOMES.indexOf(biome);
    zoneMap[index] = zone;
  }
}
