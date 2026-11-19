// Distance along the face for one complete reach, in Billy-sized metres.
export const CLIMB_STRIDE = 1.12;
const PLANTED = .56;

/** Two diagonal pairs trade support. A planted hoof slides down in body space
 * by exactly the distance the torso rises, keeping its foothold on the wall. */
export function climbStep(phase: number, opposite: boolean) {
  const cycle = ((phase + (opposite ? .5 : 0)) % 1 + 1) % 1;
  const reach = CLIMB_STRIDE * PLANTED;
  if (cycle < PLANTED) return { down: cycle * CLIMB_STRIDE - reach / 2, lift: 0 };
  const t = (cycle - PLANTED) / (1 - PLANTED);
  return { down: reach * (.5 - t * t * (3 - 2 * t)), lift: .19 * Math.sin(Math.PI * t) ** 2 };
}
