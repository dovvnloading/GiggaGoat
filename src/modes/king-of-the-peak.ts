import type { GoatObservation, MatchSnapshot, ModeArena } from './types';
import type { Emit, RuleOutcome } from './internal';
import { distanceSquared, TICKS_PER_SECOND } from './internal';

export function topScoreTied(state: MatchSnapshot): boolean {
  const scores = state.players.map(p => p.score).sort((a, b) => b - a);
  return scores.length > 1 && scores[0] === scores[1];
}

/** One goat on the summit earns points every full second. Two or more freeze
 * capture progress; leaving the zone resets the one-second meter. */
export function updateKingOfThePeak(
  state: MatchSnapshot,
  arena: ModeArena,
  observations: Map<string, GoatObservation>,
  emit: Emit,
): RuleOutcome {
  const peak = state.peak!;
  const occupants = state.players.filter(player => {
    const o = observations.get(player.id)!;
    return o.position.y >= arena.summit.y - 6 &&
      distanceSquared(o.position, arena.summit) <= state.config.peakRadius ** 2;
  }).map(p => p.id).sort();

  const contested = occupants.length > 1;
  if (contested && !peak.contested) emit({ type: 'peak.contested', players: occupants });
  peak.contested = contested;
  const owner = occupants.length === 1 ? occupants[0]! : null;
  if (peak.ownerId !== owner) {
    peak.ownerId = owner;
    peak.captureTicks = 0;
    emit({ type: 'peak.control', playerId: owner });
  }
  if (owner === null) return 'continue';
  peak.captureTicks++;
  if (peak.captureTicks < TICKS_PER_SECOND) return 'continue';
  peak.captureTicks = 0;
  const leaderScore = Math.max(...state.players.map(p => p.score));
  const player = state.players.find(p => p.id === owner)!;
  // Visible catch-up rule: an underdog 20+ points back earns exactly one extra
  // point per uninterrupted capture second. Never subtract earned points.
  const comeback = leaderScore - player.score >= state.config.peakComebackGap;
  const points = state.config.peakPointsPerSecond + (comeback ? 1 : 0);
  player.score += points;
  emit({ type: 'peak.scored', playerId: owner, points, comeback });
  if (player.score >= state.config.peakTargetScore) return 'finish';
  if (state.phase === 'overtime' && !topScoreTied(state)) return 'finish';
  return 'continue';
}
