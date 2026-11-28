import type { HappeningId, HappeningMessage, HappeningSite } from './IslandHappenings';
import type { Vec3 } from '../world/types';

interface Dispatch {
  id: string;
  title: string;
  from: HappeningId;
  to: HappeningId;
  letter: string;
  reply: string;
}

// Album order matches the eight pictures on the island postcard sheet.
export const DISPATCHES = [
  { id: 'breakfast', title: 'Breakfast by bell', from: 'honey-rolls', to: 'breakfast-bell', letter: 'Collect three hot rolls at EAP’s. Ring the farm bell before the butter melts.', reply: 'The farmhands sent the basket back full of strawberries.' },
  { id: 'parade', title: 'The wind-up waltz', from: 'needle-drop', to: 'wind-up-parade', letter: 'Earn the B-side at Noni’s, then wake the boardwalk pinwheels for the record launch.', reply: 'The souvenir stand sold its last pinwheel during the encore.' },
  { id: 'shift', title: 'The midnight shift', from: 'signal-home', to: 'shift-whistle', letter: 'Signal the keeper for the cargo manifest. Sound the yard whistle to hand it over.', reply: 'The night crew finally knows which crate holds their kettle.' },
  { id: 'busker', title: 'A request from the pines', from: 'lantern-circle', to: 'busker-break', letter: 'Wake the lantern circle for a song request. Carry it to the Downtown busker and join in.', reply: 'The busker played it twice. Even the pigeons stayed.' },
  { id: 'forecast', title: 'Updraft express', from: 'pressure-check', to: 'summit-mail', letter: 'Take a pressure reading at the dam and call it in at the summit weather post.', reply: 'The summit crew wrote GOOD BALLOON WEATHER across the chart.' },
  { id: 'fireflies', title: 'Lights for the camp', from: 'breakfast-bell', to: 'lantern-circle', letter: 'Collect the farm’s lantern wick at the breakfast bell. Wake the lanterns in Whispering Pines.', reply: 'A camper counted seven fireflies on the return envelope.' },
  { id: 'gauge', title: 'Signed and pressure tested', from: 'shift-whistle', to: 'pressure-check', letter: 'Clock out the crane crew and take their signed gauge certificate to the dam.', reply: 'The engineer marked the certificate with a perfect blue thumbprint.' },
  { id: 'keeper', title: 'Last light on the cape', from: 'summit-mail', to: 'signal-home', letter: 'Read the summit weather vane and signal the forecast to the lighthouse keeper.', reply: 'A light flashed back across the water. The mailboat can come home.' },
] as const satisfies readonly Dispatch[];

export interface PostSave { stamped: string[]; route?: string; carrying?: boolean }

export class IslandPost {
  readonly routes: readonly Dispatch[];
  readonly stamped = new Set<string>();
  active?: Dispatch;
  carrying = false;
  private sites: Map<HappeningId, HappeningSite>;
  private receipt?: { title: string; until: number };
  constructor(sites: readonly HappeningSite[], saved?: PostSave) {
    this.sites = new Map(sites.map(site => [site.definition.id, site]));
    this.routes = DISPATCHES.filter(route => this.sites.has(route.from) && this.sites.has(route.to));
    for (const route of this.routes) {
      if (Array.isArray(saved?.stamped) && saved.stamped.includes(route.id)) this.stamped.add(route.id);
    }
    this.active = this.routes.find(route => route.id === saved?.route && !this.stamped.has(route.id));
    this.carrying = !!this.active && saved?.carrying === true;
  }

  start(id: string): boolean {
    const route = this.routes.find(candidate => candidate.id === id);
    if (this.active || !route || this.stamped.has(id)) return false;
    this.active = route;
    this.carrying = false;
    this.receipt = undefined;
    return true;
  }

  cancel(): void { this.active = undefined; this.carrying = false; }

  get target(): HappeningSite | undefined {
    return this.active && this.sites.get(this.carrying ? this.active.to : this.active.from);
  }

  perform(site: HappeningId, time: number): number {
    if (!this.active || this.target?.definition.id !== site) return 0;
    if (!this.carrying) { this.carrying = true; return 0; }
    this.stamped.add(this.active.id);
    this.receipt = { title: this.active.title, until: time + 5 };
    this.cancel();
    return 40;
  }

  message(at: Vec3, time: number): HappeningMessage | undefined {
    if (this.receipt && time < this.receipt.until)
      return { title: this.receipt.title, task: 'Postcard stamped', detail: '+40 CUD COINS · ISLAND POST' };
    const site = this.target;
    if (!site || !this.active) return;
    const x = site.position.x - at.x, z = site.position.z - at.z;
    const meters = Math.round(Math.hypot(x, z));
    const bearing = ['N','NE','E','SE','S','SW','W','NW'][(Math.round(Math.atan2(x,-z)/(Math.PI/4))+8)%8];
    return { title: this.active.title, task: (this.carrying ? 'Deliver to ' : 'Collect at ') + site.definition.title,
      detail: meters > 5 * site.scale ? bearing + ' · ' + meters + ' M' :
        site.definition.id === 'honey-rolls' ? 'COLLECT THREE HONEY ROLLS' :
        site.definition.id === 'needle-drop' ? 'PLAY THE B-SIDE' : 'E / X · BLEAT TO SIGN' };
  }

  snapshot(): PostSave {
    return { stamped: [...this.stamped], ...(this.active ? { route: this.active.id, carrying: this.carrying } : {}) };
  }
}
