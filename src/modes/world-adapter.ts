import type { IslandData } from '../world/types';
import { heightAt, landAreaAtTideLevel } from '../world/island';
import type { ModeArena } from './types';

/** Read-only bridge to Billy Isle's PUBLIC world functions. This adapter
 * imports neither Three.js nor Rapier and never mutates the source island.
 * Barns 2–4 are pop-up hay arenas near recognisable POIs. */
export function arenaFromBillyIsle(
  island: IslandData,
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
    dryAreaAtTideLevel: level => landAreaAtTideLevel(island, level),
    elevationAt: (x, z) => heightAt(island, x, z),
    barns,
  };
}
