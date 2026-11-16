import type {
  Bale, GoatObservation, HeistState, MatchSnapshot, ModeArena, ModeInputIntent, PlayerState,
} from './types';
import type { Emit, RuleOutcome } from './internal';
import { direction, distanceSquared, TICKS_PER_SECOND } from './internal';

const KICK_COOLDOWN = 24;
const STAMINA_RECOVERY_PER_SECOND = 7;

export function makeHeistState(players: readonly PlayerState[], arena: ModeArena, hayPerTeam: number): HeistState {
  const teams = [...new Set(players.map(p => p.teamId).filter((id): id is string => id !== null))].sort();
  const bales: Bale[] = [];
  const scores: Record<string, number> = {};
  for (const team of teams) {
    const barn = arena.barns.find(b => b.teamId === team)!;
    scores[team] = 0;
    for (let i = 0; i < hayPerTeam; i++) {
      const angle = Math.PI * 2 * i / hayPerTeam;
      const distance = Math.min(2, barn.radius * 0.3);
      bales.push({
        id: `${team}-hay-${i + 1}`, homeTeam: team,
        position: { x: barn.position.x + Math.cos(angle) * distance,
          y: barn.position.y + 0.7, z: barn.position.z + Math.sin(angle) * distance },
        carrierId: null, lastTouchedTeam: null,
      });
    }
  }
  return {
    bales, scores, previousHeadbutt: Object.fromEntries(players.map(p => [p.id, false])),
    lastKickTick: Object.fromEntries(players.map(p => [p.id, -KICK_COOLDOWN])),
    overtimeScore: false,
  };
}

function setBaleAtBarn(bale: Bale, arena: ModeArena): void {
  const barn = arena.barns.find(b => b.teamId === bale.homeTeam)!;
  bale.position = { x: barn.position.x, y: barn.position.y + 0.7, z: barn.position.z };
  bale.carrierId = null;
  bale.lastTouchedTeam = null;
}

function drop(bale: Bale, player: PlayerState, reason: 'released' | 'exhausted' | 'shoved', emit: Emit): void {
  bale.carrierId = null;
  emit({ type: 'hay.dropped', baleId: bale.id, playerId: player.id, reason });
}

/** All bales are authoritative serializable objects; the host animates them
 * between updates, never moves them ahead of these scoring decisions. */
export function updateHayHeist(
  state: MatchSnapshot,
  arena: ModeArena,
  observations: Map<string, GoatObservation>,
  intents: Readonly<Record<string, ModeInputIntent>>,
  emit: Emit,
): RuleOutcome {
  const heist = state.heist!;
  const players = [...state.players].sort((a, b) => a.id.localeCompare(b.id));

  // Carried bales follow the goat's observed position. Carrying burns stamina
  // and prevents sprinting (getEffects); releasing the tongue drops immediately.
  for (const player of players) {
    const bale = heist.bales.find(b => b.carrierId === player.id);
    const intent = intents[player.id] ?? {};
    if (bale) {
      const pos = observations.get(player.id)!.position;
      bale.position = { x: pos.x, y: pos.y + 0.65, z: pos.z };
      if (!intent.tongue || intent.dropHay) {
        drop(bale, player, 'released', emit);
      } else {
        player.stamina = Math.max(0, player.stamina -
          state.config.hayCarryDrainPerSecond / TICKS_PER_SECOND);
        if (player.stamina <= 0) drop(bale, player, 'exhausted', emit);
      }
    } else {
      player.stamina = Math.min(100, player.stamina + STAMINA_RECOVERY_PER_SECOND / TICKS_PER_SECOND);
    }
  }

  // A headbutt knocks a rival's cargo loose first; otherwise it punts the
  // nearest loose bale. No damage/health, just extremely stealable groceries.
  for (const player of players) {
    const intent = intents[player.id] ?? {};
    const rising = !!intent.chargeHeadbutt && !heist.previousHeadbutt[player.id];
    heist.previousHeadbutt[player.id] = !!intent.chargeHeadbutt;
    if (!rising || state.tick - (heist.lastKickTick[player.id] ?? -KICK_COOLDOWN) < KICK_COOLDOWN) continue;
    const self = observations.get(player.id)!;
    const victim = players.filter(other => other.teamId !== player.teamId &&
      other.id !== player.id && distanceSquared(self.position, observations.get(other.id)!.position) <= 2.6 ** 2)
      .map(other => heist.bales.find(b => b.carrierId === other.id))
      .find((b): b is Bale => b !== undefined);
    if (victim) {
      const other = players.find(p => p.id === victim.carrierId)!;
      drop(victim, other, 'shoved', emit);
      heist.lastKickTick[player.id] = state.tick;
      continue;
    }
    const bale = heist.bales.filter(b => b.carrierId === null &&
      distanceSquared(self.position, b.position) <= state.config.hayPickupRadius ** 2)
      .sort((a, b) => distanceSquared(self.position, a.position) -
        distanceSquared(self.position, b.position) || a.id.localeCompare(b.id))[0];
    if (bale) {
      const facing = direction(self.facing);
      bale.position.x += facing.x * state.config.hayKickDistance;
      bale.position.z += facing.z * state.config.hayKickDistance;
      bale.position.y = arena.elevationAt(bale.position.x, bale.position.z) + 0.7;
      bale.lastTouchedTeam = player.teamId;
      heist.lastKickTick[player.id] = state.tick;
      emit({ type: 'hay.punted', baleId: bale.id, playerId: player.id });
    }
  }

  // Holding tongue near a bale is the pickup gesture. Own hay may be rescued,
  // but only ENEMY hay can score at your team's barn.
  for (const player of players) {
    const intent = intents[player.id] ?? {};
    if (!intent.tongue || intent.dropHay || player.stamina < 5 ||
      heist.bales.some(b => b.carrierId === player.id)) continue;
    const pos = observations.get(player.id)!.position;
    const bale = heist.bales.filter(b => b.carrierId === null &&
      distanceSquared(pos, b.position) <= state.config.hayPickupRadius ** 2)
      .sort((a, b) => distanceSquared(pos, a.position) - distanceSquared(pos, b.position) ||
        a.id.localeCompare(b.id))[0];
    if (!bale) continue;
    bale.carrierId = player.id;
    bale.lastTouchedTeam = player.teamId;
    emit({ type: 'hay.picked', baleId: bale.id, playerId: player.id });
  }

  for (const bale of heist.bales) {
    const barn = arena.barns.find(b => b.teamId === bale.lastTouchedTeam);
    if (!barn || distanceSquared(bale.position, barn.position) > barn.radius ** 2) continue;
    if (bale.homeTeam === barn.teamId) {
      // Recover stolen supplies without granting an enemy point.
      setBaleAtBarn(bale, arena);
      continue;
    }
    const scoringPlayer = bale.carrierId;
    heist.scores[barn.teamId] = (heist.scores[barn.teamId] ?? 0) + 1;
    if (scoringPlayer) state.players.find(p => p.id === scoringPlayer)!.score++;
    emit({ type: 'hay.scored', baleId: bale.id, teamId: barn.teamId, playerId: scoringPlayer,
      score: heist.scores[barn.teamId]! });
    setBaleAtBarn(bale, arena);
    if (state.phase === 'overtime') heist.overtimeScore = true;
  }
  if (heist.overtimeScore || Object.values(heist.scores).some(score => score >= state.config.hayTargetScore)) {
    return 'finish';
  }
  return 'continue';
}
