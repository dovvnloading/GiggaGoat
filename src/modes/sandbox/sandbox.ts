import { compareIds } from '../internal';
import { BotBrain } from '../bots';
import { PartyMatch } from '../match';
import { makeMockIsland, MockIslandRunner } from '../mock-island';
import type { Difficulty, MatchEvent, MatchSnapshot, ModeId, ModeInputIntent } from '../types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing sandbox element: ${id}`);
  return value as T;
};
const select = (id: string) => $<HTMLSelectElement>(id);
const setText = (id: string, value: string) => { $(id).textContent = value; };
const canvas = $<HTMLCanvasElement>('screen');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is required');
const ctx: CanvasRenderingContext2D = context;
const W = canvas.width;
const H = canvas.height;
const SCALE = 1.5;
const TEAM_COLORS: Record<string, string> = {
  red: '#D84F3D', blue: '#21A8C6', gold: '#FFD833', purple: '#7A4CFF',
};
const NAME_POOL = ['Captain Crouton', 'Honk Supreme', 'Noodle Legs', 'Velcro Dave',
  'Biscuit', 'Sir Tripalot', 'Gravel Goblin', 'Baaa-dministrator'];
let match: PartyMatch;
let runner: MockIslandRunner;
let paused = false;
let accumulator = 0;
let lastTime = 0;
let terrainCache: HTMLCanvasElement | null = null;
let cacheLevel = Number.NaN;
let warningUntil = 0;
let lastLog: string[] = [];
const held = new Set<string>();
let headbuttPressed = false;

const toScreen = (x: number, z: number) => ({ x: W / 2 + x * SCALE, y: H / 2 + z * SCALE });
const toWorld = (x: number, y: number) => ({
  x: (x - W / 2) / SCALE, z: (y - H / 2) / SCALE,
});
function seconds(ticks: number): string {
  const t = Math.floor(ticks / 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
function createMatch(): void {
  const mode = select('mode').value as ModeId;
  const seed = Number($<HTMLInputElement>('seed').value);
  const amount = Number(select('count').value);
  const human = $<HTMLInputElement>('human').checked;
  if (!Number.isSafeInteger(seed)) { setText('status', 'Seed must be an integer.'); return; }
  match = new PartyMatch({ mode, seed, config: { countdownTicks: 120 } }, makeMockIsland());
  const chosen: string[] = [];
  for (let i = 0; i < amount; i++) {
    const id = human && i === 0 ? 'you' : `goat-${i + 1}`;
    const teamId = mode === 'hay-heist' ? (i % 2 === 0 ? 'red' : 'blue') : null;
    match.join({ id, name: human && i === 0 ? 'YOU' : NAME_POOL[i]!,
      bot: !(human && i === 0), teamId });
    match.setReady(id, true);
    chosen.push(id);
  }
  match.start();
  runner = new MockIslandRunner(match, select('difficulty').value as Difficulty, seed);
  lastLog = [];
  terrainCache = null; cacheLevel = Number.NaN;
  warningUntil = 0;
  accumulator = 0;
  lastTime = 0;
  paused = false;
  match.onEvent(report);
  for (const event of match.drainEvents()) report(event);
  setText('pause', 'Pause');
  setText('status', `${amount} goats on Billy Isle · ${mode.replaceAll('-', ' ').toUpperCase()}`);
  setText('modeTip', {
    'rising-tide': 'Run uphill when the horn sounds. A head-under-water countdown means splash.',
    'king-of-the-peak': 'One goat on Mt. Gigga scores. Two goats? Nobody scores. Hold your ground.',
    'hay-heist': 'Tongue an enemy bale back to your barn. Carrying is slower and burns stamina.',
  }[mode]);
  void chosen;
  draw();
}
function playerName(id: string): string {
  return match.players.find(p => p.id === id)?.name ?? id;
}
function formatEvent(event: MatchEvent): string | null {
  switch (event.type) {
    case 'player.joined': case 'player.ready': return null;
    case 'phase.changed':
      return `${event.to.toUpperCase()} // ${event.to === 'overtime' ? 'Sudden bleat!' : 'Phase update'}`;
    case 'countdown': return event.seconds <= 3 ? `${event.seconds}… hooves on deck!` : null;
    case 'tide.warning':
      warningUntil = match.tick + event.ticksUntilRise;
      return `SEA WARNING · next rise to ${event.level.toFixed(1)} m (${event.dryArea.toFixed(0)} m² dry)`;
    case 'tide.rose': return `SPLASH ZONE EXPANDED · water ${event.level.toFixed(1)} m`;
    case 'goat.eliminated':
      return `${playerName(event.playerId)} went for an unscheduled swim${event.creditedTo ? ` (last shoved by ${playerName(event.creditedTo)})` : ''}`;
    case 'goat.knockout': return `${playerName(event.attackerId)} earns a shove credit`;
    case 'peak.contested': return `SUMMIT CONTESTED · ${event.players.length} goats, zero points`;
    case 'peak.control': return event.playerId ? `${playerName(event.playerId)} owns the summit` : null;
    case 'peak.scored': return `${playerName(event.playerId)} +${event.points} peak points${event.comeback ? ' (underdog bonus)' : ''}`;
    case 'hay.picked': return `${playerName(event.playerId)} tongue-grabbed ${event.baleId}`;
    case 'hay.punted': return `${playerName(event.playerId)} hoof-punted ${event.baleId}`;
    case 'hay.dropped': return `${playerName(event.playerId)} dropped hay (${event.reason})`;
    case 'hay.scored': return `${event.teamId.toUpperCase()} BARN +1 · ${event.score} total`;
    case 'match.finished': return `RESULTS IN · ${event.placements.filter(p => p.rank === 1).map(p => playerName(p.playerId)).join(' + ')} take first`;
  }
}
function report(event: MatchEvent): void {
  const message = formatEvent(event);
  if (!message) return;
  const category = event.type.startsWith('tide.') || event.type === 'goat.eliminated' ? 'splash'
    : event.type.includes('scored') || event.type === 'match.finished' ? 'score' : '';
  const log = $('log');
  const item = document.createElement('div');
  item.className = `event ${category}`;
  const small = document.createElement('small');
  small.textContent = `[${seconds(event.tick)}]`;
  item.append(small, document.createTextNode(message));
  log.prepend(item);
  lastLog.unshift(`${category}|${event.tick}|${message}`);
  while (lastLog.length > 55) lastLog.pop();
  while (log.children.length > 55) log.lastElementChild?.remove();
}

function coastRadius(level: number): number {
  return 190 * Math.max(0, 1 - Math.sqrt(Math.max(0, (level + 1) / 96)));
}
function renderTerrain(level: number): void {
  if (terrainCache && cacheLevel === level) { ctx.drawImage(terrainCache, 0, 0); return; }
  const buffer = document.createElement('canvas');
  buffer.width = W; buffer.height = H;
  const b = buffer.getContext('2d')!;
  b.fillStyle = '#0F669E'; b.fillRect(0, 0, W, H);
  const arena = match.view().arena;
  for (let y = 0; y < H; y += 10) for (let x = 0; x < W; x += 10) {
    const pos = toWorld(x + 5, y + 5);
    const height = arena.elevationAt(pos.x, pos.z);
    const wave = Math.sin(pos.x * 0.16 + pos.z * 0.1) * 0.1;
    if (height <= level) b.fillStyle = height < -0.8 ? '#0F669E' :
      height > level - 3 ? '#21A8C6' : '#1688B2';
    else if (height < 3) b.fillStyle = '#F7DB99';
    else if (height > 77) b.fillStyle = '#8C919E';
    else if (height > 55) b.fillStyle = '#9EB3A1';
    else if (height > 22) b.fillStyle = '#77B754';
    else b.fillStyle = wave > 0 ? '#92C86A' : '#86C05C';
    b.fillRect(x, y, 10.5, 10.5);
  }
  // Glowing cartoon sea foam on the retreating shoreline.
  const edge = coastRadius(level);
  const shore = toScreen(0, 0);
  b.save(); b.strokeStyle = '#e5fbeb'; b.lineWidth = 3; b.setLineDash([13, 6]);
  b.globalAlpha = 0.65; b.beginPath(); b.arc(shore.x, shore.y, edge * SCALE, 0, Math.PI * 2);
  b.stroke(); b.restore();
  // Chunky terraced contour lines give an immediate height/readability cue.
  for (const mark of [22, 50, 77]) if (mark > level) {
    b.beginPath(); b.arc(shore.x, shore.y, coastRadius(mark) * SCALE, 0, Math.PI * 2);
    b.strokeStyle = '#f6f2db40'; b.lineWidth = 3; b.stroke();
  }
  b.fillStyle = '#383952'; b.beginPath();
  b.arc(W / 2, H / 2, 7, 0, 2 * Math.PI); b.fill();
  b.font = 'bold 12px system-ui'; b.textAlign = 'center';
  b.fillStyle = '#fffbe7'; b.fillText('MT. GIGGA', W / 2, H / 2 - 13);
  terrainCache = buffer; cacheLevel = level; ctx.drawImage(buffer, 0, 0);
}
function renderBarns(): void {
  if (match.mode !== 'hay-heist') return;
  for (const barn of match.view().arena.barns) {
    if (!(barn.teamId in match.view().teamScores)) continue;
    const pt = toScreen(barn.position.x, barn.position.z);
    ctx.beginPath(); ctx.arc(pt.x, pt.y, barn.radius * SCALE, 0, Math.PI * 2);
    ctx.fillStyle = '#ffefb844'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = TEAM_COLORS[barn.teamId] ?? '#fff';
    ctx.stroke();
    ctx.save(); ctx.translate(pt.x, pt.y);
    ctx.fillStyle = '#d84f3d'; ctx.fillRect(-14, -10, 28, 23);
    ctx.fillStyle = '#fff6df'; ctx.beginPath();
    ctx.moveTo(-17, -10); ctx.lineTo(0, -23); ctx.lineTo(17, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#663929'; ctx.fillRect(-5, 1, 10, 12);
    ctx.restore();
    ctx.font = '900 12px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(`${barn.teamId.toUpperCase()} BARN`, pt.x, pt.y + barn.radius * SCALE + 16);
  }
  for (const bale of match.bales) {
    const pt = toScreen(bale.position.x, bale.position.z);
    ctx.fillStyle = '#8f622c'; ctx.fillRect(pt.x - 6, pt.y - 6, 14, 14);
    ctx.fillStyle = '#F2C14F'; ctx.fillRect(pt.x - 6, pt.y - 8, 12, 12);
    ctx.strokeStyle = '#fff5ad'; ctx.lineWidth = 1.5; ctx.strokeRect(pt.x - 6, pt.y - 8, 12, 12);
  }
}
function renderGoats(): void {
  const obs = runner.observe();
  const players = match.players;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i]!;
    const p = players.find(goat => goat.id === o.id)!;
    const pt = toScreen(o.position.x, o.position.z);
    const color = p.teamId ? TEAM_COLORS[p.teamId] ?? '#fff'
      : ['#FFD833', '#7A4CFF', '#F8ECDC', '#FF891E', '#21A8C6', '#D84F3D', '#c5ffa5', '#ed8dc2'][i]!;
    ctx.save(); ctx.translate(pt.x, pt.y);
    ctx.rotate(Math.atan2(o.facing.z, o.facing.x) + Math.PI / 2);
    ctx.globalAlpha = p.eliminatedAt === null ? 1 : 0.35;
    ctx.fillStyle = '#0f193266'; ctx.beginPath(); ctx.ellipse(2, 5, 13, 9, 0, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = color; ctx.strokeStyle = '#29223b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 13, 0, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f9f1e5'; ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(-12, -18);
    ctx.lineTo(-2, -10); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, -8); ctx.lineTo(12, -18); ctx.lineTo(2, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1f2339'; ctx.beginPath(); ctx.arc(-4, -5, 1.7, 0, 7); ctx.arc(4, -5, 1.7, 0, 7); ctx.fill();
    ctx.restore();
    ctx.font = '900 11px system-ui'; ctx.textAlign = 'center';
    ctx.fillStyle = '#14152c'; ctx.fillText(p.name, pt.x + 1, pt.y - 21 + 1);
    ctx.fillStyle = '#fff'; ctx.fillText(p.name, pt.x, pt.y - 21);
    if (match.mode === 'rising-tide' && p.submergedTicks > 0 && p.eliminatedAt === null) {
      ctx.font = 'bold 11px system-ui'; ctx.fillStyle = '#ffdf59';
      ctx.fillText(`${((match.config.submergeTicks - p.submergedTicks) / 60).toFixed(1)}s`, pt.x, pt.y + 28);
    }
  }
}
function renderBoard(): void {
  const scoreboard = $('standings'); scoreboard.replaceChildren();
  const players = match.players;
  const placements = match.placements;
  players.sort((a, b) => {
    const aRank = placements.find(p => p.playerId === a.id)?.rank;
    const bRank = placements.find(p => p.playerId === b.id)?.rank;
    return (aRank ?? 99) - (bRank ?? 99) ||
      (match.mode === 'rising-tide' ? (a.eliminatedAt ?? Infinity) - (b.eliminatedAt ?? Infinity) :
        b.score - a.score) || compareIds(a.id, b.id);
  });
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const row = document.createElement('div'); row.className = `goatrow ${p.eliminatedAt !== null ? 'out' : ''}`;
    const label = document.createElement('div');
    const title = document.createElement('div'); title.className = 'name';
    const dot = document.createElement('span'); dot.className = 'dot';
    dot.style.background = TEAM_COLORS[p.teamId ?? ''] ?? ['#FFD833', '#7A4CFF', '#F8ECDC', '#FF891E'][i % 4]!;
    title.append(dot, document.createTextNode(p.name));
    const detail = document.createElement('small');
    detail.textContent = match.mode === 'rising-tide'
      ? (p.eliminatedAt === null ? `${p.knockouts} shoves · still dry` : 'SPLASHED')
      : match.mode === 'hay-heist'
        ? `${p.teamId} · ${p.score} deliveries · ${p.stamina.toFixed(0)} stamina`
        : `${p.score} capture points`;
    label.append(title, detail);
    const score = document.createElement('strong');
    score.textContent = placements.length ? `#${placements.find(x => x.playerId === p.id)?.rank}`
      : match.mode === 'rising-tide' ? (p.eliminatedAt === null ? 'ALIVE' : 'OUT')
        : `${match.mode === 'hay-heist' ? match.view().teamScores[p.teamId ?? ''] ?? 0 : p.score}`;
    row.append(label, score); scoreboard.append(row);
  }
  const teamScores = match.view().teamScores;
  setText('teams', match.mode === 'hay-heist'
    ? Object.entries(teamScores).map(([id, s]) => `${id.toUpperCase()} ${s}`).join(' · ')
    : 'FREE FOR ALL');
}
function draw(): void {
  if (!match || !runner) return;
  renderTerrain(match.tideLevel);
  renderBarns();
  renderGoats();
  ctx.save(); ctx.textAlign = 'center';
  if (match.phase === 'countdown' || match.phase === 'results' || match.phase === 'overtime') {
    ctx.fillStyle = '#141a37bf'; ctx.fillRect(W / 2 - 190, 18, 380, 65);
    ctx.strokeStyle = '#fcd64c'; ctx.strokeRect(W / 2 - 190, 18, 380, 65);
    ctx.fillStyle = '#fff'; ctx.font = '950 27px system-ui';
    const winner = match.placements.filter(p => p.rank === 1).map(p => playerName(p.playerId)).join(' + ');
    ctx.fillText(match.phase === 'results' ? `WINNER: ${winner}`
      : match.phase === 'overtime' ? 'SUDDEN BLEAT!'
        : `GET READY · ${Math.ceil((match.config.countdownTicks - match.toJSON().phaseTicks) / 60)}`,
      W / 2, 58, 365);
  } else if (match.mode === 'rising-tide' && warningUntil > match.tick) {
    ctx.fillStyle = '#16152fcb'; ctx.fillRect(W / 2 - 155, 18, 310, 49);
    ctx.font = '900 22px system-ui'; ctx.fillStyle = '#FFD833';
    ctx.fillText('⚠ TIDE RISING', W / 2, 49);
  }
  ctx.restore();
  setText('phase', match.phase.toUpperCase());
  setText('clock', seconds(match.toJSON().playTicks));
  setText('tide', `${match.tideLevel.toFixed(0)} m`);
  const dry = match.view().arena.dryAreaAtTideLevel(match.tideLevel);
  const total = match.view().arena.dryAreaAtTideLevel(0);
  setText('land', `${Math.max(0, 100 * dry / total).toFixed(0)}%`);
  renderBoard();
}
function humanIntent(): ModeInputIntent {
  const x = (held.has('d') || held.has('arrowright') ? 1 : 0) -
    (held.has('a') || held.has('arrowleft') ? 1 : 0);
  const z = (held.has('s') || held.has('arrowdown') ? 1 : 0) -
    (held.has('w') || held.has('arrowup') ? 1 : 0);
  return {
    moveX: x, moveZ: z, sprint: held.has('shift'),
    tongue: held.has('t'), chargeHeadbutt: headbuttPressed,
    dropHay: held.has('g'),
  };
}
function oneTick(): void {
  if (!match || match.phase === 'results') return;
  runner.tick(match.players.some(p => p.id === 'you') ? { you: humanIntent() } : {});
  headbuttPressed = false;
  if (match.toJSON().phase === 'results') { paused = true; setText('pause', 'Resume'); }
}
function animate(timestamp: number): void {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min(0.15, (timestamp - lastTime) / 1000);
  lastTime = timestamp;
  if (!paused && match) {
    accumulator += dt * 60 * Number(select('speed').value);
    let steps = 0;
    while (accumulator >= 1 && steps < 64) { oneTick(); accumulator--; steps++; }
    if (steps === 64) accumulator = Math.min(accumulator, 8);
  }
  draw();
  requestAnimationFrame(animate);
}
$('start').addEventListener('click', createMatch);
$('pause').addEventListener('click', () => {
  paused = !paused; setText('pause', paused ? 'Resume' : 'Pause');
});
$('single').addEventListener('click', () => { paused = true; oneTick(); draw(); });
$('save').addEventListener('click', () => {
  const state = {
    version: 1, match: match.toJSON(),
    goats: runner.goats.map(g => ({ ...g, facing: { ...g.facing } })),
    bots: [...runner.bots].map(([id, bot]) => [id, bot.toJSON()]),
  };
  $<HTMLTextAreaElement>('snapshot').value = JSON.stringify(state);
  setText('status', `Saved at tick ${match.tick}. Replay will be bit-for-bit.`);
});
$('load').addEventListener('click', () => {
  try {
    const value = JSON.parse($<HTMLTextAreaElement>('snapshot').value) as {
      version: number; match: MatchSnapshot; goats: MockIslandRunner['goats'];
      bots: Array<[string, ReturnType<BotBrain['toJSON']>]>;
    };
    if (value.version !== 1) throw new Error('Unsupported snapshot');
    match = PartyMatch.fromJSON(value.match, makeMockIsland());
    runner = new MockIslandRunner(match);
    if (value.goats.length !== match.players.length) throw new Error('Wrong goat count');
    runner.goats.splice(0, runner.goats.length, ...value.goats);
    runner.bots.clear();
    for (const [id, snapshot] of value.bots) runner.bots.set(id, BotBrain.fromJSON(snapshot));
    $('log').replaceChildren(); lastLog = [];
    for (const event of match.drainEvents()) report(event);
    match.onEvent(report);
    terrainCache = null; cacheLevel = Number.NaN;
    paused = true; accumulator = 0; lastTime = 0;
    select('mode').value = match.mode;
    setText('pause', 'Resume');
    setText('status', `Restored tick ${match.tick}. Next move is deterministic.`);
    draw();
  } catch (err) {
    setText('status', `Could not restore: ${String(err)}`);
  }
});
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'shift', 't', 'f', 'g',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
  if (key === 'f' && !held.has(key)) headbuttPressed = true;
  held.add(key);
});
window.addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());
createMatch();
requestAnimationFrame(animate);
