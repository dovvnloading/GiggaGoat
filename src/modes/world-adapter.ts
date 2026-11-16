import type { IslandData } from '../world/types';
import type { ModeArena } from './types';

/** Exact call signature of world/index.ts's public terrain readers. Keeping
 * these injected instead of importing world/island at runtime prevents that
 * module's collider adapter from transitively loading Rapier into the pure
 * party-mode rules engine. */
export interface BillyIsleReaders {
  heightAt(island: IslandData, x: number, z: number): number;
  landAreaAtTideLevel(island: IslandData, level: number): number;
}

/** Read-only bridge to Billy Isle's public tide/terrain APIs.
 * Barns 2–4 are pop-up hay arenas near recognisable POIs. */
export function arenaFromBillyIsle(
  island: IslandData,
  readers: BillyIsleReaders,
  teamIds: readonly string[] = ['red', 'blue'],
): ModeArena {
  if (teamIds.length < 2 || teamIds.length > 4 || new Set(teamIds).size !== teamIds.length ||
      teamIds.some(id => !id)) throw new RangeError('2–4 distinct team IDs required');
  const summit = island.pois.find(p => p.id === 'mt-gigga');
  if (!summit) throw new Error('Billy Isle is missing Mt. Gigga');
  const barnPois = ['hoofington', 'crane-yard', 'downtown-bleatsville', 'whispering-pines'];
  const barns = teamIds.map((teamId, i) => {
    const poi = island.pois.find(p => p.id === barnPois[i]);
    if (!poi) throw new Error('Billy Isle is missing a barn arena POI');
    return { teamId, position: { ...poi.center }, radius: 11 };
  });
  return {
    summit: { ...summit.center },
    tideLevels: [...island.tideLevels],
    dryAreaAtTideLevel: level => readers.landAreaAtTideLevel(island, level),
    elevationAt: (x, z) => readers.heightAt(island, x, z),
    barns,
  };
}
