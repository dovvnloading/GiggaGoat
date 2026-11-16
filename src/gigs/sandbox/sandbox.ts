import { generateIsland, POI_IDS } from '../../world';
import type { PoiId } from '../../world';
import { ChallengeTracker, CudWallet, EventBus } from '../../gameplay';
import {
  DIFFICULTIES, GIG_IDS, GIG_INFO, GigCatalog, GigDirector, GigGameplayBridge,
  TICKS_PER_SECOND,
} from '../index';
import type {
  AbilityFact, Difficulty, GigFrame, GigId, GigMarker, GigObjective,
  GigPropSpawn, GigSetup, Point, PropFact, StyleFact,
} from '../index';

function node<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing dev console element ' + id);
  return found as T;
}
const canvas = node<HTMLCanvasElement>('field');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D is required for the gig console');
const gigPicker = node<HTMLSelectElement>('gig');
const tierPicker = node<HTMLSelectElement>('tier');
const seedInput = node<HTMLInputElement>('seed');
const boardPicker = node<HTMLSelectElement>('board');
const playButton = node<HTMLButtonElement>('play');
const heightInput = node<HTMLInputElement>('height');
const propHeightInput = node<HTMLInputElement>('prop-height');
const label = (id: string, s: string): void => { node<HTMLElement>(id).textContent = s; };
const island = generateIsland({ seed: 'gigs-dev-console', resolution: 65 });
const poiNames = new Map(island.pois.map(p => [p.id, p.name]));
for (const gigId of GIG_IDS) gigPicker.add(new Option(GIG_INFO[gigId].title, gigId));
for (const poiId of POI_IDS) boardPicker.add(new Option(poiNames.get(poiId) ?? poiId, poiId));
boardPicker.value = 'hoofington';

interface DebugProp extends PropFact {
  role: GigPropSpawn['role'] | 'hay';
  halfHeight: number;
  baseY: number;
  color: string;
}
let catalog = new GigCatalog(island, Number(seedInput.value));
let director = new GigDirector(catalog);
let walletBus = new EventBus();
let wallet = new CudWallet(walletBus);
let challenges = new ChallengeTracker(wallet, walletBus);
let bridge = new GigGameplayBridge(director, wallet, challenges, walletBus);
let setup: GigSetup | null = null;
let goat: Point = { x: 0, y: 0, z: 0 };
let facing = { x: 0, z: -1 };
let props = new Map<string, DebugProp>();
let tethered = new Set<string>();
let selected: DebugProp | null = null;
let drag = false;
let playing = true;
let gravityVelocity = 0;
let jumping = false;
let tickCounter = 0;
let queuedAbilities: AbilityFact[] = [];
let queuedStyle: StyleFact[] = [];
let lastBoardKey = '';
const pressed = new Set<string>();
const copy = (p: Point): Point => ({ ...p });
const planar = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);
const position = (p: Point, x = 0, y = 0, z = 0): Point =>
  ({ x: p.x + x, y: p.y + y, z: p.z + z });
const time = (ticks: number): string => {
  const seconds = Math.max(0, ticks) / TICKS_PER_SECOND;
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
};
function log(type: string, detail: string): void {
  const li = document.createElement('li');
  li.textContent = '[' + time(director.tick) + '] ' + type + '  ' + detail;
  if (type.includes('completed') || type.includes('unlocked')) li.className = 'win';
  if (type.includes('failed')) li.className = 'fail';
  node<HTMLUListElement>('events').prepend(li);
  const list = node<HTMLUListElement>('events');
  while (list.children.length > 34) list.lastElementChild?.remove();
}
function bindDirector(): void {
  director.onEvent(e => {
    if (e.type === 'objective.progress') return;
    if (e.type === 'gig.completed') log(e.type, e.award.rating.toUpperCase() + ' · ' + e.award.coins + ' coins');
    else if (e.type === 'gig.accepted') log(e.type, e.gigId);
    else if (e.type === 'gig.failed') log(e.type, e.reason);
    else if (e.type === 'cosmetic.unlocked') log(e.type, e.cosmeticId);
    else log(e.type, '');
  });
}
bindDirector();
function ensureSeed(): void {
  const seed = Number(seedInput.value);
  if (catalog.seed === new GigCatalog(island, seed).seed) return;
  catalog = new GigCatalog(island, seed);
  director = new GigDirector(catalog);
  walletBus = new EventBus();
  wallet = new CudWallet(walletBus);
  challenges = new ChallengeTracker(wallet, walletBus);
  bridge = new GigGameplayBridge(director, wallet, challenges, walletBus);
  bindDirector();
  node<HTMLUListElement>('events').replaceChildren();
  lastBoardKey = '';
}
function addSpawn(spawn: GigPropSpawn): void {
  props.set(spawn.id, { id: spawn.id, position: copy(spawn.position),
    role: spawn.role, halfHeight: spawn.size.y / 2,
    baseY: spawn.position.y, color: spawn.color,
    velocity: { x: 0, y: 0, z: 0 }, tilt: 0, broken: false });
}
function activate(s: GigSetup): void {
  setup = s;
  goat = copy(s.start);
  gravityVelocity = 0;
  jumping = false;
  tickCounter = 0;
  selected = null;
  drag = false;
  props = new Map();
  tethered = new Set();
  queuedAbilities = [];
  queuedStyle = [];
  s.spawns.forEach(addSpawn);
  if (s.config.kind === 'hay-haul') {
    for (const bale of s.config.bales) {
      props.set(bale.id, { id: bale.id, role: 'hay', position: copy(bale.start),
        halfHeight: 0.75, baseY: bale.start.y, color: '#F2C14F',
        velocity: { x: 0, y: 0, z: 0 }, tilt: 0 });
    }
  }
  heightInput.value = String(goat.y);
  label('height-value', goat.y.toFixed(1) + ' m');
  propHeightInput.value = '0';
  label('prop-name', 'none');
  label('reward', '');
  playing = true;
  playButton.textContent = 'Pause';
  refreshBoard();
  renderHUD();
}
function startPractice(): void {
  ensureSeed();
  if (director.active?.status === 'running') director.abandon();
  const gigId = gigPicker.value as GigId;
  const tier = tierPicker.value as Difficulty;
  activate(director.startPractice(gigId, tier));
}
function startPosted(offerId: string): void {
  if (director.active?.status === 'running') director.abandon();
  activate(director.accept(offerId));
  gigPicker.value = setup!.offer.gigId;
  tierPicker.value = setup!.offer.difficulty;
}
function refreshBoard(): void {
  const board = director.board(boardPicker.value as PoiId);
  const boardKey = board.poiId + ':' + board.cycle;
  label('refresh', 'Rotation #' + board.cycle + ' · new offers in ' + time(board.refreshInTicks));
  if (boardKey === lastBoardKey) return;
  lastBoardKey = boardKey;
  const parent = node<HTMLDivElement>('board-offers');
  parent.replaceChildren();
  if (!board.offers.length) {
    const p = document.createElement('p');
    p.className = 'controls';
    p.textContent = 'No local contracts posted here. Try the farm, town, pier, forest, peak or yard.';
    parent.append(p);
  }
  for (const offer of board.offers) {
    const button = document.createElement('button');
    const title = document.createElement('span');
    title.textContent = GIG_INFO[offer.gigId].title;
    const difficulty = document.createElement('span');
    difficulty.className = 'muted';
    difficulty.textContent = offer.difficulty.toUpperCase();
    button.append(title, difficulty);
    button.addEventListener('click', () => startPosted(offer.id));
    parent.append(button);
  }
}
function describe(o: GigObjective): { text: string; progress: number } {
  switch (o.kind) {
    case 'deliver': return { text: o.label + ': ' + o.done + '/' + o.required +
      ' · chain-tow into the red barn circle', progress: o.done / o.required };
    case 'checkpoints': return { text: o.label + ': ' + o.reached + '/' + o.total +
      ' · one street touch ends the run', progress: o.reached / o.total };
    case 'displace': return { text: o.label + ': ' + o.movedMass.toFixed(0) + '/' +
      o.requiredMass.toFixed(0) + ' kg · ' + o.headbutts + ' headbutts',
      progress: o.movedMass / o.requiredMass };
    case 'coverage': return { text: o.label + ': ' + o.eaten + '/' + o.total +
      ' squares · ' + o.bites + ' bites', progress: o.eaten / o.total };
    case 'escort': return { text: o.label + ': ' + o.reached + '/' + o.total +
      ' · careful with headbutt impulses', progress: o.reached / o.total };
    case 'stack': return { text: o.label + ': ' + o.layers + '/' + o.required +
      ' layers · held ' + (o.stableTicks / 60).toFixed(1) + '/5 s',
      progress: Math.min(1, o.layers / o.required) *
        Math.min(1, o.stableTicks / o.holdTicks) };
    case 'summit': return { text: o.label + ': ' + o.reached + '/' + o.total +
      ' · measured climb ' + o.climbed.toFixed(1) + ' m',
      progress: (o.reached / o.total + Math.min(1, o.climbed / 10)) / 2 };
    case 'splash': return { text: o.label + ': ' + o.drop.toFixed(1) + '/' +
      o.requiredDrop.toFixed(1) + ' m · splash event ' + (o.splashed ? '✓' : 'needed'),
      progress: o.splashed ? 1 : Math.min(.9, o.drop / o.requiredDrop * .7) };
  }
}
function renderHUD(): void {
  if (!setup) return;
  const run = director.active;
  if (!run) return;
  label('gig-title', setup.info.title);
  label('gig-pitch', setup.info.pitch);
  label('instructions', setup.info.instruction);
  label('clock', time(setup.maxTicks - run.elapsedTicks));
  const pace = run.elapsedTicks <= setup.goldTicks ? 'GOLD PACE' :
    run.elapsedTicks <= setup.silverTicks ? 'SILVER PACE' : 'BRONZE PACE';
  label('rating', run.rating?.toUpperCase() ?? (run.status === 'running' ? pace : run.status.toUpperCase()));
  label('coins', String(wallet.coins));
  const best = director.personalBests.find(b => b.gigId === setup?.offer.gigId &&
    b.difficulty === setup?.offer.difficulty);
  label('best', best ? best.rating.toUpperCase() : '–');
  const progress = describe(run.objective);
  label('objective', progress.text);
  node<HTMLElement>('progress').style.width = (Math.min(100, progress.progress * 100)) + '%';
  if (run.status === 'completed') {
    label('reward', '+' + run.payout + ' Cud Coins · ' +
      (director.ownedCosmetics.includes(setup.info.cosmetic.id)
        ? 'Cosmetic: ' + setup.info.cosmetic.name : 'Beat your time for gold!'));
  } else if (run.status === 'failed') label('reward', run.failReason ?? 'Time up');
  else if (run.status === 'abandoned') label('reward', 'Gig abandoned — no payout');
  else label('reward', 'Gold: before ' + time(setup.goldTicks) + ' · Silver: ' + time(setup.silverTicks));
  refreshBoard();
}
function nearestProp(radius: number): DebugProp | null {
  return [...props.values()].filter(p => planar(p.position, goat) < radius)
    .sort((a, b) => planar(a.position, goat) - planar(b.position, goat))[0] ?? null;
}
function action(key: string, chain: boolean): void {
  if (!setup || director.active?.status !== 'running') return;
  if (key === 't') {
    const p = nearestProp(7);
    if (!p) return;
    if (!chain) tethered.clear();
    tethered.add(p.id);
    const targets = chain ? [...props.values()].filter(x =>
      planar(x.position, p.position) < 4.4 && planar(x.position, goat) < 9)
      .slice(0, 3).map(x => x.id) : [p.id];
    targets.forEach(id => tethered.add(id));
    queuedAbilities.push({ type: 'tongue', targetId: p.id, targetIds: targets });
  } else if (key === 'x') {
    tethered.clear();
    queuedAbilities.push({ type: 'tongue-release' });
  } else if (key === 'h' || key === 'e') {
    const radius = key === 'h' ? 6 : 9;
    queuedAbilities.push({ type: key === 'h' ? 'headbutt' : 'bleat', targetId: nearestProp(radius)?.id });
    for (const p of props.values()) {
      const distance = planar(p.position, goat);
      if (distance >= radius) continue;
      const direction = { x: (p.position.x - goat.x) / (distance || 1),
        z: (p.position.z - goat.z) / (distance || 1) };
      const shove = key === 'h' ? 4.8 : 2.3;
      p.position.x += direction.x * shove;
      p.position.z += direction.z * shove;
      p.impact = key === 'h' ? 28 : 8;
    }
  } else if (key === 'q') {
    queuedAbilities.push({ type: 'flop' });
    gravityVelocity = -1;
    jumping = true;
  } else if (key === 'f') queuedAbilities.push({ type: 'eat' });
  else if (key === ' ') {
    if (!jumping) {
      jumping = true;
      gravityVelocity = 9;
    }
  }
}
function simulateTick(): void {
  if (!setup) return;
  tickCounter++;
  if (director.active?.status === 'running') {
    let dx = 0, dz = 0;
    if (pressed.has('a') || pressed.has('arrowleft')) dx--;
    if (pressed.has('d') || pressed.has('arrowright')) dx++;
    if (pressed.has('w') || pressed.has('arrowup')) dz--;
    if (pressed.has('s') || pressed.has('arrowdown')) dz++;
    const length = Math.hypot(dx, dz) || 1;
    const speed = pressed.has('shift') ? 8 : 5;
    goat.x += dx / length * speed / 60;
    goat.z += dz / length * speed / 60;
    if (dx || dz) facing = { x: dx / length, z: dz / length };
    if (pressed.has('c')) {
      goat.y += 0.17;
      queuedAbilities.push({ type: 'climb', metres: 0.17 });
    }
    if (pressed.has('f') && tickCounter % 10 === 0) queuedAbilities.push({ type: 'eat' });
    if (jumping) {
      goat.y += gravityVelocity / 60;
      gravityVelocity -= 9.81 / 60;
      const floor = setup.config.kind === 'splash-dive' ? setup.config.waterY : setup.start.y;
      if (goat.y <= floor) {
        goat.y = floor;
        jumping = false;
        if (setup.config.kind === 'splash-dive' && gravityVelocity < -4) {
          queuedStyle.push({ type: 'big-splash', points: 25 });
        }
        gravityVelocity = 0;
      }
    }
    for (const p of props.values()) {
      p.impact = p.impact ?? 0;
      p.velocity = { x: 0, y: 0, z: 0 };
      p.heldByTongue = tethered.has(p.id);
      p.carried = p.role === 'parcel' && tethered.has(p.id);
      if (tethered.has(p.id) && !drag) {
        p.position.x += (goat.x - p.position.x) * .08;
        p.position.z += (goat.z - p.position.z) * .08;
        if (p.carried) p.position.y += (goat.y - p.position.y) * .25;
      }
    }
  }
  const physicsFacts: GigFrame = {
    goat: { position: copy(goat), size: 1,
      onStreet: setup.config.kind === 'rooftop-express' &&
        goat.y <= setup.config.streetY + 1 },
    props: [...props.values()].map(p => ({
      id: p.id, position: copy(p.position), velocity: p.velocity ? copy(p.velocity) : undefined,
      tilt: p.tilt, broken: p.broken, impact: p.impact,
      heldByTongue: p.heldByTongue, carried: p.carried,
    })),
    abilities: queuedAbilities, style: queuedStyle,
  };
  director.step(physicsFacts);
  bridge.settle();
  queuedAbilities = [];
  queuedStyle = [];
  for (const p of props.values()) p.impact = 0;
  heightInput.value = String(Math.max(-5, Math.min(130, goat.y)));
  label('height-value', goat.y.toFixed(1) + ' m');
  renderHUD();
}
const view = { cx: 0, cz: 0, pixelsPerMetre: 4, width: 0, height: 0 };
function layoutView(): void {
  if (!setup) return;
  const points: Point[] = [setup.start, ...setup.markers.map(m => m.position),
    ...[...props.values()].map(p => p.position)];
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  view.cx = (minX + maxX) / 2;
  view.cz = (minZ + maxZ) / 2;
  view.pixelsPerMetre = Math.min((view.width - 72) / Math.max(28, maxX - minX + 20),
    (view.height - 72) / Math.max(28, maxZ - minZ + 20));
}
function toScreen(p: Point): { x: number; y: number } {
  return { x: (p.x - view.cx) * view.pixelsPerMetre + view.width / 2,
    y: (p.z - view.cz) * view.pixelsPerMetre + view.height / 2 };
}
function toWorld(x: number, y: number): Point {
  return { x: view.cx + (x - view.width / 2) / view.pixelsPerMetre,
    y: 0, z: view.cz + (y - view.height / 2) / view.pixelsPerMetre };
}
function circle(x: number, y: number, radius: number, color: string): void {
  ctx!.beginPath(); ctx!.arc(x, y, radius, 0, Math.PI * 2);
  ctx!.fillStyle = color; ctx!.fill();
}
function ring(x: number, y: number, radius: number, color: string, width = 2): void {
  ctx!.beginPath(); ctx!.arc(x, y, radius, 0, Math.PI * 2);
  ctx!.lineWidth = width; ctx!.strokeStyle = color; ctx!.stroke();
}
function markerDone(m: GigMarker, index: number, objective: GigObjective): boolean {
  if (objective.kind === 'coverage') return director.active?.finishedIds.includes(String(index)) ?? false;
  if (objective.kind === 'checkpoints' || objective.kind === 'summit' ||
    objective.kind === 'escort') return index < objective.reached;
  if (objective.kind === 'deliver') return false;
  return false;
}
function draw(): void {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
  }
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.width = rect.width;
  view.height = rect.height;
  layoutView();
  ctx!.fillStyle = '#183d3c';
  ctx!.fillRect(0, 0, view.width, view.height);
  for (let x = -400; x <= 400; x += 10) {
    const screen = toScreen({ x, y: 0, z: view.cz });
    ctx!.strokeStyle = '#41776138'; ctx!.lineWidth = 1;
    ctx!.beginPath(); ctx!.moveTo(screen.x, 0); ctx!.lineTo(screen.x, view.height); ctx!.stroke();
  }
  for (let z = -400; z <= 400; z += 10) {
    const screen = toScreen({ x: view.cx, y: 0, z });
    ctx!.strokeStyle = '#41776138'; ctx!.lineWidth = 1;
    ctx!.beginPath(); ctx!.moveTo(0, screen.y); ctx!.lineTo(view.width, screen.y); ctx!.stroke();
  }
  if (!setup) return;
  const run = director.active;
  const c = setup.config;
  // Route before markers, so individual checkpoints stay readable.
  const route = c.kind === 'rooftop-express' || c.kind === 'summit-sprint' ? c.checkpoints :
    c.kind === 'escort-the-gnome' ? c.route : [];
  if (route.length) {
    ctx!.strokeStyle = '#ffffff88'; ctx!.lineWidth = 2; ctx!.setLineDash([8, 6]);
    ctx!.beginPath();
    route.forEach((p, i) => { const s = toScreen(p); if (!i) ctx!.moveTo(s.x, s.y); else ctx!.lineTo(s.x, s.y); });
    ctx!.stroke(); ctx!.setLineDash([]);
  }
  for (const [index, m] of setup.markers.entries()) {
    const p = toScreen(m.position);
    const radius = Math.max(7, m.radius * view.pixelsPerMetre);
    const done = run ? markerDone(m, index, run.objective) : false;
    ring(p.x, p.y, radius, done ? '#77B754' :
      m.type === 'destination' ? '#FF891E' : '#FFD833', done ? 2 : 3);
    circle(p.x, p.y, 3, done ? '#77B754' : '#FFD833');
    ctx!.font = '700 11px system-ui'; ctx!.textAlign = 'center';
    ctx!.fillStyle = '#fff'; ctx!.fillText(m.label, p.x, p.y - radius - 6);
  }
  for (const p of props.values()) {
    const s = toScreen(p.position);
    if (tethered.has(p.id)) {
      const start = toScreen(goat);
      ctx!.strokeStyle = '#F2C14F'; ctx!.lineWidth = 2; ctx!.setLineDash([4, 4]);
      ctx!.beginPath(); ctx!.moveTo(start.x, start.y); ctx!.lineTo(s.x, s.y); ctx!.stroke(); ctx!.setLineDash([]);
    }
    const size = p.role === 'tower' || p.role === 'stack-crate' ? 13 : 10;
    if (p.role === 'gnome') {
      circle(s.x, s.y, 9, p.color);
      circle(s.x, s.y - 9, 5, '#ffebd4');
    } else if (p.role === 'hay') {
      circle(s.x, s.y, 10, p.color); ring(s.x, s.y, 10, '#a8792f');
    } else {
      ctx!.fillStyle = p.color;
      ctx!.fillRect(s.x - size / 2, s.y - size / 2, size, size);
      ctx!.strokeStyle = '#17243b'; ctx!.strokeRect(s.x - size / 2, s.y - size / 2, size, size);
    }
    if (selected === p) ring(s.x, s.y, 17, '#fff', 3);
    ctx!.fillStyle = '#fff'; ctx!.font = '11px ui-monospace,monospace';
    ctx!.textAlign = 'center'; ctx!.fillText(p.position.y.toFixed(1) + 'm', s.x, s.y + 21);
  }
  const g = toScreen(goat);
  circle(g.x, g.y, 13, '#7A4CFF'); ring(g.x, g.y, 14, '#d4c5ff', 2);
  ctx!.fillStyle = '#fff';
  circle(g.x + facing.x * 11 - facing.z * 4, g.y + facing.z * 11 + facing.x * 4, 3, '#fff');
  circle(g.x + facing.x * 11 + facing.z * 4, g.y + facing.z * 11 - facing.x * 4, 3, '#fff');
  ctx!.font = '800 11px system-ui'; ctx!.textAlign = 'center';
  ctx!.fillText('GOAT', g.x, g.y - 22);
  ctx!.fillStyle = '#d8e5e8'; ctx!.font = '12px system-ui'; ctx!.textAlign = 'left';
  ctx!.fillText((poiNames.get(setup.offer.poiId) ?? setup.offer.poiId) + ' · ' + setup.offer.difficulty.toUpperCase(), 15, 24);
  if (run?.status !== 'running') {
    ctx!.fillStyle = '#0e1830c9'; ctx!.fillRect(0, view.height / 2 - 42, view.width, 86);
    ctx!.fillStyle = run?.status === 'completed' ? '#FFD833' : '#ffacac';
    ctx!.font = '900 24px system-ui'; ctx!.textAlign = 'center';
    ctx!.fillText(run?.status === 'completed' ? 'CONTRACT CRUSHED!' :
      run?.status?.toUpperCase() ?? '', view.width / 2, view.height / 2 + 8);
  }
}
function pointer(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
canvas.addEventListener('pointerdown', event => {
  if (!setup) return;
  const m = pointer(event);
  const best = [...props.values()].map(p => ({ p, distance: Math.hypot(
    toScreen(p.position).x - m.x, toScreen(p.position).y - m.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  selected = best && best.distance < 21 ? best.p : null;
  drag = !!selected;
  if (drag) canvas.setPointerCapture(event.pointerId);
  label('prop-name', selected ? selected.role + ' · ' + selected.id.slice(-12) : 'none');
  propHeightInput.value = String(selected ? selected.position.y - selected.baseY : 0);
});
canvas.addEventListener('pointermove', event => {
  if (!drag || !selected) return;
  const m = pointer(event), w = toWorld(m.x, m.y);
  selected.position.x = w.x;
  selected.position.z = w.z;
});
canvas.addEventListener('pointerup', () => { drag = false; });
canvas.addEventListener('pointercancel', () => { drag = false; });
propHeightInput.addEventListener('input', () => {
  if (selected) selected.position.y = selected.baseY + Number(propHeightInput.value);
});
heightInput.addEventListener('input', () => {
  goat.y = Number(heightInput.value);
  label('height-value', goat.y.toFixed(1) + ' m');
  jumping = false;
});
document.addEventListener('keydown', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
  pressed.add(key);
  if (!event.repeat) action(key, event.shiftKey);
});
document.addEventListener('keyup', event => { pressed.delete(event.key.toLowerCase()); });
node<HTMLButtonElement>('start').addEventListener('click', startPractice);
node<HTMLButtonElement>('step').addEventListener('click', () => { simulateTick(); draw(); });
playButton.addEventListener('click', () => {
  playing = !playing;
  playButton.textContent = playing ? 'Pause' : 'Play';
});
boardPicker.addEventListener('change', () => { lastBoardKey = ''; refreshBoard(); });
let last = 0, accumulator = 0;
function animate(now: number): void {
  const dt = Math.min(0.2, (now - last) / 1000 || 0);
  last = now;
  if (playing) {
    accumulator += dt * Number(node<HTMLSelectElement>('speed').value);
    let steps = 0;
    while (accumulator >= 1 / 60 && steps < 64) {
      simulateTick();
      accumulator -= 1 / 60;
      steps++;
    }
    if (steps === 64) accumulator = 0;
  }
  draw();
  requestAnimationFrame(animate);
}
startPractice();
requestAnimationFrame(animate);
