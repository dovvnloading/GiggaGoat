import type {
  Bale, Barn, GoatObservation, HeistState, MatchSnapshot, ModeArena, ModeInputIntent, PlayerState, Position,
} from './types';
import type { Emit, RuleOutcome } from './internal';
import { direction, distanceSquared, TICKS_PER_SECOND, compareIds } from './internal';

const KICK_COOLDOWN = 24;
const STAMINA_RECOVERY_PER_SECOND = 7;

function baleHomeSlot(barn: Barn, index: number, count: number): Position {
  const angle = Math.PI * 2 * index / count;
  const distance = Math.min(2, barn.radius * 0.3);
  return { x: barn.position.x + Math.cos(angle) * distance,
    y: barn.position.y + 0.7, z: barn.position.z + Math.sin(angle) * distance };
}

export function makeHeistState(players: readonly PlayerState[], arena: ModeArena, hayPerTeam: number): HeistState {
  const teams = [...new Set(players.map(p => p.teamId).filter((id): id is string => id !== null))].sort();
  const bales: Bale[] = [];
  const scores: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const team of teams) {
    const barn = arena.barns.find(b => b.teamId === team)!;
    scores[team] = 0;
    for (let i = 0; i < hayPerTeam; i++) {
      bales.push({
        id: `${team}-hay-${i + 1}`, homeTeam: team,
        position: baleHomeSlot(barn, i, hayPerTeam),
        carrierId: null, lastTouchedTeam: null,
      });
    }
  }
  return {
    bales, scores, previousHeadbutt: Object.fromEntries(players.map(p => [p.id, false])),
    lastKickTick: Object.fromEntries(players.map(p => [p.id, -KICK_COOLDOWN])),
    pickupBlockedUntil: Object.fromEntries(players.map(p => [p.id, 0])),
    overtimeScore: false,
  };
}

function setBaleAtBarn(bale: Bale, arena: ModeArena, bales: readonly Bale[]): void {
  const barn = arena.barns.find(b => b.teamId === bale.homeTeam)!;
  const stock = bales.filter(item => item.homeTeam === bale.homeTeam);
  bale.position = stock.length === 1 ? { ...barn.position, y: barn.position.y + 0.7 }
    : baleHomeSlot(barn, stock.indexOf(bale), stock.length);
  bale.carrierId = null;
  bale.lastTouchedTeam = null;
}

function isBaleInsideBarn(bale: Bale, barn: Barn): boolean {
  return distanceSquared(bale.position, barn.position) <= barn.radius ** 2;
}

function drop(bale: Bale, player: PlayerState, reason: 'released' | 'exhausted' | 'shoved',
  state: MatchSnapshot, emit: Emit): void {
  bale.carrierId = null;
  // A shove grants a real 0.5 s steal window; exhaustion needs a short
  // recovery. Even deliberate release cannot reattach on the same tick.
  state.heist!.pickupBlockedUntil[player.id] = state.tick +
    (reason === 'shoved' ? 30 : reason === 'exhausted' ? 20 : 2);
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
  const players = [...state.players].sort((a, b) => compareIds(a.id, b.id));

  // Carried bales follow the goat's observed position. Carrying burns stamina
  // and prevents sprinting (getEffects); releasing the tongue drops immediately.
  for (const player of players) {
    const bale = heist.bales.find(b => b.carrierId === player.id);
    const intent = intents[player.id] ?? {};
    if (bale) {
      const pos = observations.get(player.id)!.position;
      bale.position = { x: pos.x, y: pos.y + 0.65, z: pos.z };
      if (!intent.tongue || intent.dropHay) {
        drop(bale, player, 'released', state, emit);
      } else {
        player.stamina = Math.max(0, player.stamina -
          state.config.hayCarryDrainPerSecond / TICKS_PER_SECOND);
        if (player.stamina <= 0) drop(bale, player, 'exhausted', state, emit);
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
      drop(victim, other, 'shoved', state, emit);
      heist.lastKickTick[player.id] = state.tick;
      continue;
    }
    const bale = heist.bales.filter(b => b.carrierId === null &&
      distanceSquared(self.position, b.position) <= state.config.hayPickupRadius ** 2)
      .sort((a, b) => distanceSquared(self.position, a.position) -
        distanceSquared(self.position, b.position) || compareIds(a.id, b.id))[0];
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

  // Friendly bales can be rescued anywhere outside their home ring.
  for (const player of players) {
    const intent = intents[player.id] ?? {};
    if (!intent.tongue || intent.dropHay || player.stamina < 5 ||
      state.tick < (heist.pickupBlockedUntil[player.id] ?? 0) ||
      heist.bales.some(b => b.carrierId === player.id)) continue;
    const pos = observations.get(player.id)!.position;
    const home = arena.barns.find(b => b.teamId === player.teamId);
    const bale = heist.bales.filter(b => b.carrierId === null &&
      (!home || b.homeTeam !== home.teamId || !isBaleInsideBarn(b, home)) &&
      distanceSquared(pos, b.position) <= state.config.hayPickupRadius ** 2)
      .sort((a, b) => distanceSquared(pos, a.position) - distanceSquared(pos, b.position) ||
        compareIds(a.id, b.id))[0];
    if (!bale) continue;
    bale.carrierId = player.id;
    bale.lastTouchedTeam = player.teamId;
    emit({ type: 'hay.picked', baleId: bale.id, playerId: player.id });
  }

  for (const bale of heist.bales) {
    const barn = arena.barns.find(b => b.teamId === bale.lastTouchedTeam);
    if (!barn || !isBaleInsideBarn(bale, barn)) continue;
    if (bale.homeTeam === barn.teamId) {
      // Leave rescued hay on the tongue until it is deposited in its home ring.
      if (bale.carrierId === null) setBaleAtBarn(bale, arena, heist.bales);
      continue;
    }
    const scoringPlayer = bale.carrierId;
    heist.scores[barn.teamId] = (heist.scores[barn.teamId] ?? 0) + 1;
    if (scoringPlayer) state.players.find(p => p.id === scoringPlayer)!.score++;
    emit({ type: 'hay.scored', baleId: bale.id, teamId: barn.teamId, playerId: scoringPlayer,
      score: heist.scores[barn.teamId]! });
    setBaleAtBarn(bale, arena, heist.bales);
    if (state.phase === 'overtime') heist.overtimeScore = true;
  }
  if (heist.overtimeScore || Object.values(heist.scores).some(score => score >= state.config.hayTargetScore)) {
    return 'finish';
  }
  return 'continue';
}
