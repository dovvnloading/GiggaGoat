import { PartyMatch } from './match';
import { makeMockIsland } from './mock-island';
import type { GoatObservation, MatchOptions, ModeFrame } from './types';

/** Shared fixtures kept OUTSIDE test modules so importing them never registers tests. */
export function goat(id: string, x = 0, z = 0, headY = 99): GoatObservation {
  return { id, position: { x, y: headY - 1, z }, headY, facing: { x: 1, z: 0 } };
}
export function readyMatch(options: MatchOptions, names = ['a', 'b']): PartyMatch {
  const match = new PartyMatch({ ...options, config: { countdownTicks: 0, ...options.config } }, makeMockIsland());
  for (let i = 0; i < names.length; i++) {
    match.join({ id: names[i]!, name: `Goat ${i + 1}`,
      teamId: options.mode === 'hay-heist' ? (i % 2 ? 'blue' : 'red') : null });
    match.setReady(names[i]!, true);
  }
  match.start();
  return match;
}
export function frame(...goats: GoatObservation[]): ModeFrame { return { goats }; }
