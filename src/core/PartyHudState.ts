import { TICKS_PER_SECOND, type MatchSnapshot, type PartyMatch } from '../modes';

interface PartyMetric {
  label: string;
  value: string;
  ownTeam?: boolean;
}

interface PartyHudState {
  clock: string;
  clockLabel: string;
  goal: string;
  metrics: PartyMetric[];
  status: string;
  urgent: boolean;
}

/** Hay Heist tracks cargo exhaustion independently of ability stamina. */
export function carryStaminaForHud(match: Pick<PartyMatch, 'mode' | 'players'> | null,
  playerId: string): number | undefined {
  return match?.mode === 'hay-heist'
    ? match.players.find(player => player.id === playerId)?.stamina
    : undefined;
}

function secondsLeft(ticks: number): number {
  return Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
}

export function derivePartyHudState(
  snapshot: MatchSnapshot, tideLevels: readonly number[], playerId: string,
): PartyHudState {
  const { config, phase, phaseTicks, players, tide, peak, heist } = snapshot;
  const clockLabel = phase === 'countdown' ? 'START' : phase === 'overtime' ? 'OT' : 'ROUND';
  const ticks = phase === 'countdown' ? config.countdownTicks :
    phase === 'overtime' ? config.overtimeTicks : phase === 'playing' ? config.durationTicks : 0;
  const seconds = secondsLeft(ticks - phaseTicks);
  const clock = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  const you = players.find(player => player.id === playerId);
  let goal = '';
  let status = '';
  let urgent = false;
  let metrics: PartyMetric[] = [];

  if (tide) {
    const alive = players.filter(player => player.eliminatedAt === null).length;
    metrics = [
      { label: 'GOATS LEFT', value: String(alive) },
      { label: 'SEA LEVEL', value: tideLevels[tide.levelIndex]!.toFixed(1) + ' m' },
    ];
    goal = phase === 'overtime' ? 'Highest perch at time' : 'Last goat standing';
    const ticksUntilRise = tide.nextRiseTick - tide.modeTicks;
    if (phase === 'playing' && tide.warned) {
      status = 'TIDE RISES IN ' + secondsLeft(ticksUntilRise) + 's';
      urgent = true;
    } else if (tide.levelIndex > 0 &&
      ticksUntilRise > config.tideRiseEveryTicks - 2 * TICKS_PER_SECOND) {
      status = 'TIDE ROSE · CLIMB!';
      urgent = true;
    } else if (phase === 'playing') {
      status = 'NEXT RISE ' + secondsLeft(ticksUntilRise) + 's';
    }
  } else if (peak) {
    metrics = [
      { label: 'YOUR POINTS', value: String(you?.score ?? 0) },
      { label: 'WIN TARGET', value: String(config.peakTargetScore) },
    ];
    goal = phase === 'overtime' ? 'Break the lead tie' :
      config.peakLeadDistance ? 'Hold the center to score' : 'Hold the summit to score';
    const owner = players.find(player => player.id === peak.ownerId);
    status = peak.contested ? 'SUMMIT CONTESTED' : peak.ownerId === playerId ? 'YOU HOLD THE SUMMIT' :
      owner ? owner.name.toUpperCase() + ' HOLDS SUMMIT' : 'SUMMIT OPEN';
  } else if (heist) {
    const ownTeam = you?.teamId;
    metrics = Object.entries(heist.scores)
      .sort(([a], [b]) => Number(b === ownTeam) - Number(a === ownTeam) || a.localeCompare(b))
      .map(([team, score]) => ({
        label: team.toUpperCase() + (team === ownTeam ? ' · YOU' : ''),
        value: String(score),
        ownTeam: team === ownTeam,
      }));
    goal = phase === 'overtime' ? 'Next delivery wins' : 'First to ' + config.hayTargetScore + ' deliveries';
    const cargo = heist.bales.find(bale => bale.carrierId === playerId);
    status = cargo ? cargo.homeTeam === ownTeam ? 'RETURN TO YOUR BARN' : 'DELIVER TO YOUR BARN' :
      'HOLD LICK BY ENEMY HAY';
  }

  if (phase === 'countdown') status = '';
  return { clock, clockLabel, goal, metrics, status, urgent };
}
