import type { GoatContact, GoatObservation, MatchSnapshot, ModeArena } from './types';
import type { Emit, RuleOutcome } from './internal';

export function updateRisingTide(
  state: MatchSnapshot,
  arena: ModeArena,
  observations: Map<string, GoatObservation>,
  contacts: readonly GoatContact[],
  emit: Emit,
): RuleOutcome {
  const tide = state.tide!;
  tide.modeTicks++;
  // Order-independent collision arbitration: for same-tick touches, the last
  // lexicographic attacker wins rather than depending on Rapier callback order.
  for (const contact of [...contacts].sort((a, b) =>
    a.victimId.localeCompare(b.victimId) || a.attackerId.localeCompare(b.attackerId))) {
    if (contact.attackerId === contact.victimId) continue;
    const a = state.players.find(p => p.id === contact.attackerId);
    const v = state.players.find(p => p.id === contact.victimId);
    if (a?.eliminatedAt === null && v?.eliminatedAt === null) {
      tide.lastContacts[v.id] = { attackerId: a.id, tick: state.tick };
    }
  }

  if (state.phase === 'playing' && tide.levelIndex < arena.tideLevels.length - 1) {
    const next = arena.tideLevels[tide.levelIndex + 1]!;
    if (!tide.warned && tide.modeTicks >= tide.nextRiseTick - state.config.tideWarningTicks &&
        tide.modeTicks < tide.nextRiseTick) {
      emit({ type: 'tide.warning', level: next, dryArea: arena.dryAreaAtTideLevel(next),
        ticksUntilRise: tide.nextRiseTick - tide.modeTicks });
      tide.warned = true;
    }
    if (tide.modeTicks >= tide.nextRiseTick) {
      tide.levelIndex++;
      emit({ type: 'tide.rose', level: next, dryArea: arena.dryAreaAtTideLevel(next) });
      tide.nextRiseTick += state.config.tideRiseEveryTicks;
      tide.warned = false;
    }
  }

  const level = arena.tideLevels[tide.levelIndex]!;
  const eliminated: string[] = [];
  for (const player of state.players) {
    if (player.eliminatedAt !== null) continue;
    const observation = observations.get(player.id)!;
    player.headY = observation.headY;
    player.submergedTicks = observation.headY <= level
      ? player.submergedTicks + 1 : 0;
    if (player.submergedTicks >= state.config.submergeTicks) {
      // The whole batch is eliminated simultaneously before checking winner.
      player.eliminatedAt = state.tick;
      eliminated.push(player.id);
    }
  }
  for (const id of eliminated) {
    const last = tide.lastContacts[id];
    const credit = last && state.tick - last.tick <= state.config.knockoutWindowTicks
      ? last.attackerId : null;
    if (credit) {
      state.players.find(p => p.id === credit)!.knockouts++;
      emit({ type: 'goat.knockout', attackerId: credit, victimId: id });
    }
    emit({ type: 'goat.eliminated', playerId: id, creditedTo: credit });
    delete tide.lastContacts[id];
  }
  if (state.players.filter(p => p.eliminatedAt === null).length <= 1) return 'finish';
  if (state.phase === 'playing' && tide.levelIndex === arena.tideLevels.length - 1) {
    return 'overtime';
  }
  return 'continue';
}
