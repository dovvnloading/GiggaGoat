import type { PropDescriptor, Vec3 } from './types';

export const ROOFTOP_DECK_PREFIX = 'downtown-courier-deck-';
export const ROOFTOP_SPAN_PREFIX = 'downtown-courier-span-';

export function rooftopDecks(props: readonly PropDescriptor[]): PropDescriptor[] {
  return props.filter(prop => prop.id.startsWith(ROOFTOP_DECK_PREFIX))
    .sort((a, b) => a.transform.position.z - b.transform.position.z);
}

/** Lay the courier route on the street-facing edge of the west block.
 * Each span meets both roofs, so a goat can tow the parcel over the gaps. */
export function buildRooftopCourse(center: Vec3, scale: number,
  props: readonly PropDescriptor[]): PropDescriptor[] {
  const shops = props.filter(prop => prop.poiId === 'downtown-bleatsville' &&
    prop.kind === 'shop' && prop.transform.position.x < center.x)
    .sort((a, b) => a.transform.position.z - b.transform.position.z);
  const laneX = center.x - 17.1 * scale;
  const width = 3.8 * scale;
  const thickness = .86 * scale;
  const prop = (id: string, kind: 'deck' | 'ramp', y: number, z: number, size: Vec3,
    rotationY = 0): PropDescriptor => ({
    id, kind, poiId: 'downtown-bleatsville',
    transform: { position: { x: laneX, y, z }, rotationY },
    size, shape: kind === 'ramp' ? 'convex' : 'cuboid',
    body: { type: 'static' }, collidable: true, breakable: false, lickable: false, climbable: true,
  });
  const decks = shops.map((roof, i) => prop(ROOFTOP_DECK_PREFIX + i, 'deck',
    roof.transform.position.y + roof.size.y / 2 + .07 * scale - thickness / 2,
    roof.transform.position.z, { x: width, y: thickness, z: roof.size.x }));
  const top = (deck: PropDescriptor) => deck.transform.position.y + deck.size.y / 2;
  const spans = decks.slice(1).map((b, i) => {
    const a = decks[i]!;
    const [low, high] = top(a) <= top(b) ? [a, b] : [b, a];
    const direction = Math.sign(high.transform.position.z - low.transform.position.z);
    // Overlap the low deck for a gentle entry. Let the ramp crown meet the
    // upper deck at its very edge, without making a lip for the parcel.
    const from = low.transform.position.z + direction * (low.size.z / 2 - 1 * scale);
    const to = high.transform.position.z - direction * (high.size.z / 2 - .035 * scale);
    const rise = top(high) - top(low) + .025 * scale;
    return prop(ROOFTOP_SPAN_PREFIX + i, 'ramp', top(low) + rise / 2, (from + to) / 2,
      { x: width, y: rise, z: Math.abs(to - from) }, direction > 0 ? 0 : Math.PI);
  });
  return [...decks, ...spans];
}
