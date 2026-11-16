import { GameSimulation, TUNING } from '../index';
import type { GoatIntent, PieceType, Material, BuiltinTrick, Cell, QuarterTurn, GameplayEvents, UnlockId } from '../index';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Sandbox DOM element #${id} missing`);
  return element as T;
};
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const text = (id: string, value: string) => { $(id).textContent = value; };
const anyClass = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
let sim = new GameSimulation(1337);
let paused = false;
let heldCharge = false;
let pending: GoatIntent = {};
let selectedCell: Cell = { x: 0, y: 0, z: 0 };
let selectedPieceId: number | undefined;
let airborneTime = 0;
let lastTime = 0;
const logs: string[] = [];

function log(message: string): void {
  logs.unshift(`[${sim.tick.toString().padStart(5, '0')}] ${message}`);
  if (logs.length > 60) logs.pop();
  $('log').textContent = logs.join('\n');
}

function subscribe(): void {
  const types: (keyof GameplayEvents)[] = [
    'style:scored', 'combo:ended', 'size:changed', 'ability:used', 'balance:knockdown',
    'balance:recovered', 'inventory:changed', 'build:placed', 'build:edited',
    'build:removed', 'build:collapsed', 'build:broken', 'challenge:completed', 'unlock:claimed',
  ];
  for (const type of types) sim.events.on(type, (event) => {
    log(`${type}: ${JSON.stringify(event).slice(0, 160)}`);
  });
}

const tricks: BuiltinTrick[] = [
  'flip', 'airtime', 'wall-climb', 'tongue-swing', 'knockback', 'topple',
  'destruction', 'near-miss', 'ragdoll-bounce', 'big-splash',
];
const trickLabels: Record<BuiltinTrick, string> = {
  flip: 'Flip', airtime: 'Big air', 'wall-climb': 'Wall climb',
  'tongue-swing': 'Tongue swing', knockback: 'Knockback', topple: 'Topple',
  destruction: 'Destruction', 'near-miss': 'Near miss',
  'ragdoll-bounce': 'Ragdoll bounce', 'big-splash': 'Big splash',
};
for (const trick of tricks) {
  const button = document.createElement('button');
  button.textContent = trickLabels[trick];
  button.addEventListener('click', () => { sim.awardStyle({ type: trick }); render(); });
  $('tricks').append(button);
}

function cellFromControls(): Cell { return { ...selectedCell, y: Number(input('y').value) }; }
function placement() {
  return { type: select('pieceType').value as PieceType, cell: cellFromControls(),
    rotation: Number(select('rotation').value) as QuarterTurn };
}
function renderGrid(): void {
  const grid = $('grid'); grid.replaceChildren();
  const y = Number(input('y').value);
  for (let z = -4; z <= 4; z++) for (let x = -4; x <= 4; x++) {
    const piece = sim.build.pieces.find(p => p.cell.x === x && p.cell.y === y && p.cell.z === z);
    const button = document.createElement('button');
    const label = piece ? ({ floor: '▤', wall: '▦', ramp: '◢', 'launch-pad': '↑' } as const)[piece.type] : '·';
    button.textContent = label;
    button.className = `cell ${piece ? 'built' : ''} ${selectedCell.x === x && selectedCell.z === z ? 'focus' : ''}`;
    button.title = `${x},${y},${z}${piece ? ` / ${piece.type} #${piece.id}` : ''}`;
    button.addEventListener('click', () => {
      selectedCell = { x, y, z }; selectedPieceId = piece?.id;
      render();
    });
    grid.appendChild(button);
  }
  text('gridInfo', `Cursor (${selectedCell.x}, ${y}, ${selectedCell.z}) / piece ${selectedPieceId ?? 'none'}`);
  const list = $('pieces'); list.replaceChildren();
  for (const piece of sim.build.pieces) {
    const row = document.createElement('div');
    row.className = `piece ${piece.id === selectedPieceId ? 'selected' : ''}`;
    row.textContent = `#${piece.id} ${piece.type} (${piece.cell.x},${piece.cell.y},${piece.cell.z}) / HP ${piece.hp.toFixed(0)}`;
    row.addEventListener('click', () => {
      selectedPieceId = piece.id;
      selectedCell = { ...piece.cell }; input('y').value = String(piece.cell.y);
      select('pieceType').value = piece.type; select('rotation').value = String(piece.rotation); render();
    });
    list.append(row);
  }
}

function render(): void {
  text('tier', sim.style.tier.toUpperCase());
  text('scale', `${sim.style.scale.toFixed(2)}×`);
  text('meterLabel', `${sim.style.meter.toFixed(1)}%`);
  text('staminaLabel', sim.abilities.stamina.toFixed(1));
  text('balanceLabel', sim.abilities.balance.toFixed(1));
  $('meter').style.width = `${sim.style.meter}%`;
  $('stamina').style.width = `${sim.abilities.stamina}%`;
  $('balance').style.width = `${sim.abilities.balance}%`;
  text('combo', `${sim.style.combo.count}×`); text('title', sim.style.combo.title || 'WARM-UP');
  text('score', sim.style.score.toLocaleString()); text('tick', `Tick ${sim.tick}`);
  text('coins', String(sim.wallet.coins));
  $('materials').replaceChildren(...(['hay', 'wood', 'scrap'] as Material[]).map(material => {
    const row = document.createElement('div'); row.className = 'barline';
    row.innerHTML = `<span>${material.toUpperCase()}</span><strong>${sim.inventory.get(material)} / ${TUNING.build.inventoryCaps[material]}</strong>`;
    return row;
  }));
  const unlocks = $('unlocks'); unlocks.replaceChildren();
  for (const def of sim.unlocks.catalog) {
    const row = document.createElement('div'); row.className = 'unlock';
    const span = document.createElement('span');
    span.textContent = `${def.id} · ${def.category}`;
    span.title = `${def.description} · requires ${def.prerequisites.join(', ') || 'none'}`;
    const button = document.createElement('button');
    button.textContent = sim.unlocks.isUnlocked(def.id) ? 'OWNED' : `${def.cost} 🟡`;
    button.disabled = sim.unlocks.isUnlocked(def.id);
    button.addEventListener('click', () => { log(`purchase ${def.id}: ${JSON.stringify(sim.unlocks.purchase(def.id as UnlockId))}`); render(); });
    row.append(span, button); unlocks.append(row);
  }
  const challenges = $('challenges'); challenges.replaceChildren();
  for (const def of sim.challenges.catalog) {
    const state = sim.challenges.getProgress(def.id);
    const row = document.createElement('div'); row.className = `challenge ${state.completed ? 'done' : ''}`;
    row.textContent = `${state.completed ? '✓ ' : ''}${def.title} · ${state.value.toFixed(1)}/${def.goal} ${def.unit} · +${def.reward}`;
    challenges.append(row);
  }
  renderGrid();
}

function step(dt: number): void {
  const air = input('air').checked;
  airborneTime = air ? airborneTime + dt : 0;
  const intent: GoatIntent = {
    sprint: input('sprint').checked, climb: input('climb').checked,
    tongue: input('tongue').checked, reelTongue: input('reel').checked,
    glide: input('glide').checked, chargeHeadbutt: heldCharge,
    ...pending,
  };
  const result = sim.update(dt, intent, {
    grounded: !air, airborneTime, touchingSteepWall: air && input('climb').checked,
    speed: 6, size: sim.style.tier, tongueTarget: 'sandbox-crate',
    climbDistance: air && input('climb').checked ? dt * 4 : 0,
  });
  // Rising edges need at least one off tick before a second pulse.
  pending = {};
  const interesting = result.commands.filter(c => c.headbutt || c.tongue || c.bleat || c.jump || c.ragdoll);
  if (interesting.length) text('commands', JSON.stringify(interesting.at(-1), null, 1));
  render();
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pulse]')) {
  button.addEventListener('click', () => {
    const kind = button.dataset.pulse as keyof GoatIntent;
    pending = { ...pending, [kind]: true };
    step(TUNING.fixedDt);
    step(TUNING.fixedDt);
  });
}
const charge = $('charge');
charge.addEventListener('pointerdown', () => { heldCharge = true; charge.classList.add('active'); });
window.addEventListener('pointerup', () => { heldCharge = false; charge.classList.remove('active'); });
$('impact').addEventListener('click', () => { sim.abilities.applyImpact(90); render(); });
$('chain').addEventListener('click', () => { for (const trick of tricks) sim.awardStyle({ type: trick }); render(); });
$('spam').addEventListener('click', () => { for (let n = 0; n < 40; n++) sim.awardStyle({ type: 'flip' }); render(); });
$('climbMeters').addEventListener('click', () => { sim.recordClimb(10); render(); });
$('place').addEventListener('click', () => {
  const result = sim.build.place(placement());
  log(`place: ${result.validation.valid ? `#${result.piece?.id}` : result.validation.reason}`);
  selectedPieceId = result.piece?.id; render();
});
$('edit').addEventListener('click', () => {
  if (!selectedPieceId || !sim.build.getPiece(selectedPieceId)) return log('Select a live piece first.');
  const result = sim.build.edit(selectedPieceId, placement());
  log(`edit #${selectedPieceId}: ${result.validation.valid ? 'ok' : result.validation.reason}`); render();
});
$('remove').addEventListener('click', () => {
  if (!selectedPieceId) return log('Select a piece first.');
  log(`remove #${selectedPieceId}: ${Boolean(sim.build.remove(selectedPieceId))}`);
  selectedPieceId = undefined; render();
});
$('damage').addEventListener('click', () => {
  if (!selectedPieceId) return log('Select a piece first.');
  log(`headbutt #${selectedPieceId}: ${anyClass(sim.build.damage(selectedPieceId, 40))}`); render();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-harvest]')) {
  button.addEventListener('click', () => { sim.inventory.harvest(button.dataset.harvest as Material, 10); render(); });
}
$('earn').addEventListener('click', () => { sim.wallet.credit(100, 'sandbox'); render(); });
$('save').addEventListener('click', () => { $<HTMLTextAreaElement>('snapshot').value = JSON.stringify(sim.toJSON(), null, 2); log('Snapshot exported.'); });
$('load').addEventListener('click', () => {
  try { sim = GameSimulation.fromJSON(JSON.parse($<HTMLTextAreaElement>('snapshot').value) as unknown); subscribe(); log('Snapshot restored.'); render(); }
  catch (error) { log(`Restore failed: ${String(error)}`); }
});
$('random').addEventListener('click', () => log(`rng.next() = ${sim.rng.next()}`));
$('reset').addEventListener('click', () => {
  const seed = Number(input('seed').value);
  try { sim = new GameSimulation(seed); logs.length = 0; selectedPieceId = undefined; subscribe(); log(`New seeded sim ${seed}`); render(); }
  catch (error) { log(String(error)); }
});
$('pause').addEventListener('click', () => { paused = !paused; text('pause', paused ? 'Resume' : 'Pause'); });
input('y').addEventListener('input', renderGrid);
function animate(time: number): void {
  if (!lastTime) lastTime = time;
  const delta = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  if (!paused) step(delta);
  requestAnimationFrame(animate);
}
subscribe(); render(); requestAnimationFrame(animate);
