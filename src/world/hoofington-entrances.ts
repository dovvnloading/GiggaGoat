/** Fence rails and their walking or towing entrances in village-local metres. */
export const HOOFINGTON_FIELD_RAILS = [-1, 1].map(side =>
  [5.7, 6.2, 4.7, 5.8, 4.6, 6.2, 9, 9].map((length, index) => ({
    x: side === -1 && index < 2 ? -36.8
      : side === -1 && index === 2 ? -36
      : side === 1 && index === 0 ? 37.5 : side * 34.5,
    z: -36 + index * 10,
    length,
  })),
);

export const HOOFINGTON_YARD_ENTRANCES = [
  { x: -12, z: -20 }, { x: 12, z: -27.7 }, { x: 12, z: 2 },
  { x: -12, z: 23.5 }, { x: 12, z: 24 },
].map(p => ({ ...p, length: 8, width: 2.4 }));

export const HOOFINGTON_WALK_WIDTH = 1.4;

/** Sidewalk entrance, garden bends and doorstep, in village-local metres. */
export const HOOFINGTON_FRONT_WALKS = [
  { side: -1, entryZ: -9, mailbox: [8.2, 1.55], points: [[16.02, -9]] },
  { side: -1, entryZ: 10.7, mailbox: [6.8, -1.45], points: [[16.22, 10.7]] },
  { side: 1, entryZ: -16.85, mailbox: [7.3, 1.55], points: [[13.5, -16.85], [17.04, -19]] },
  { side: 1, entryZ: 1.2, mailbox: [9.5, -1.45], points: [[15.5, 1.2], [23, -3.2], [25.83, -3.2]] },
  { side: 1, entryZ: 12, mailbox: [6.9, 1.55], points: [[18.18, 12]] },
  { side: 1, entryZ: 26.45, mailbox: [9.45, -1.45], points: [[12.8, 26.45], [17.75, 29]] },
] as const;

export const HOOFINGTON_FIELD_ENTRANCES = HOOFINGTON_FIELD_RAILS.flatMap(rails =>
  rails.slice(1).flatMap((after, index) => {
    const before = rails[index]!;
    const start = before.z + before.length / 2, end = after.z - after.length / 2;
    const width = end - start;
    if (width < 3) return [];
    const x = (before.x + after.x) / 2;
    // The western Hay Haul gate approaches from the lower pasture lane.
    const towing = before.x === -36 && after.x === -34.5;
    return [{ x, z: (start + end) / 2, length: towing ? 13 : 9, width, towing }];
  }),
);

export const HOOFINGTON_HAUL_BALE_PREFIX = 'hoofington-haul-bale-';
export const HOOFINGTON_HAUL_PARKING = [-13.2, -9.7, -6.2, -2.7, .8, 4.3, 7.8]
  .map(z => ({ x: -29.25, z }));
// The marked bales sit off the towing lane with room to turn back toward the barn.
export const HOOFINGTON_HAUL_LANE = { x: -28, z: -3.25, length: 4.75, width: 25.5 };
// Protect the turn between the west yard opening and the bale loading lane.
export const HOOFINGTON_HAUL_CONNECTOR = { x: -21.4, z: -18.6, length: 10.4, width: 5.2 };
// A relocated garden prop must also stay outside the barn's delivery apron.
export const HOOFINGTON_HAUL_DROP_APRON = { x: -25.25, z: -20.25, length: 5.2, width: 5.2 };
