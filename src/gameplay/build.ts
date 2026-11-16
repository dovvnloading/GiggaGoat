import { TUNING } from './config';
import type { Material, PieceType } from './config';
import { EventBus } from './events';
import { clamp, copyJSON, integer, isRecord, nonNegative, requireNumber, requireRecord, requireString } from './math';

export type MaterialCounts = Record<Material, number>;
export type Cell = { x: number; y: number; z: number };
export type QuarterTurn = 0 | 1 | 2 | 3;
export interface Placement { type: PieceType; cell: Cell; rotation: QuarterTurn }
export interface BuildPiece extends Placement { id: number; hp: number }
export interface BuildSnapshot { nextId: number; pieces: BuildPiece[] }
export type PlacementFailure = 'out-of-bounds' | 'invalid-rotation' | 'overlap' | 'no-support' | 'cost';
export type Validation = { valid: true; snapped: Placement } | { valid: false; reason: PlacementFailure };

const materials: Material[] = ['hay', 'wood', 'scrap'];
function assertMaterial(material: Material): void {
  if (!materials.includes(material)) throw new RangeError(`invalid material: ${String(material)}`);
}
const zero = (): MaterialCounts => ({ hay: 0, wood: 0, scrap: 0 });
const cost = (type: PieceType): MaterialCounts => ({ ...TUNING.build.cost[type] });
function validType(type: unknown): type is PieceType {
  return typeof type === 'string' && type in TUNING.build.hp;
}
function validCell(cell: Cell): boolean {
  return Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y) && Number.isSafeInteger(cell.z) &&
    Math.abs(cell.x) <= TUNING.build.maxHorizontalCell && cell.y >= 0 && cell.y <= TUNING.build.maxHeight && Math.abs(cell.z) <= TUNING.build.maxHorizontalCell;
}
const cellKey = (p: Cell) => `${p.x},${p.y},${p.z}`;
const neighbours = (p: Cell): Cell[] => [
  { x: p.x - 1, y: p.y, z: p.z }, { x: p.x + 1, y: p.y, z: p.z },
  { x: p.x, y: p.y - 1, z: p.z }, { x: p.x, y: p.y + 1, z: p.z },
  { x: p.x, y: p.y, z: p.z - 1 }, { x: p.x, y: p.y, z: p.z + 1 },
];

/** Atomic capped material ledger, with capacity-safe, lossless edit exchanges. */
export class Inventory {
  private counts: MaterialCounts;
  constructor(private readonly bus: EventBus, initial: Partial<MaterialCounts> = { hay: 18, wood: 10, scrap: 3 }) {
    this.counts = zero();
    for (const material of materials) {
      const n = initial[material] ?? 0;
      integer(n, material);
      if (n > TUNING.build.inventoryCaps[material]) throw new RangeError(`exceeds ${material} cap`);
      this.counts[material] = n;
    }
  }
  get(material: Material): number { assertMaterial(material); return this.counts[material]; }
  get all(): MaterialCounts { return { ...this.counts }; }
  private set(material: Material, next: number): void {
    const before = this.counts[material];
    if (before === next) return;
    this.counts[material] = next;
    this.bus.emit('inventory:changed', { material, before, after: next });
  }
  harvest(material: Material, quantity: number): number {
    assertMaterial(material);
    integer(quantity, 'harvest quantity');
    const accepted = Math.min(quantity, TUNING.build.inventoryCaps[material] - this.get(material));
    this.set(material, this.get(material) + accepted);
    if (accepted) this.bus.emit('material:harvested', { material, amount: accepted });
    return accepted;
  }
  canAfford(counts: MaterialCounts): boolean {
    for (const m of materials) integer(counts[m], `${m} cost`);
    return materials.every(m => this.get(m) >= counts[m]);
  }
  /** Either all materials leave or none do. */
  spend(counts: MaterialCounts): boolean {
    for (const m of materials) integer(counts[m], `${m} cost`);
    if (!this.canAfford(counts)) return false;
    for (const m of materials) this.set(m, this.get(m) - counts[m]);
    return true;
  }
  refund(counts: MaterialCounts, fraction = 1): void {
    nonNegative(fraction, 'refund fraction');
    if (fraction > 1) throw new RangeError('refund fraction must be <= 1');
    for (const m of materials) integer(counts[m], `${m} refund`);
    for (const m of materials) {
      this.set(m, Math.min(TUNING.build.inventoryCaps[m], this.get(m) + Math.floor(counts[m] * fraction)));
    }
  }
  canExchange(oldCost: MaterialCounts, newCost: MaterialCounts): boolean {
    for (const m of materials) {
      integer(oldCost[m], `${m} former cost`); integer(newCost[m], `${m} new cost`);
    }
    return materials.every(m => this.get(m) + oldCost[m] >= newCost[m]);
  }
  /** Charge just the difference: never accidentally discard an old cost at a cap. */
  exchange(oldCost: MaterialCounts, newCost: MaterialCounts): boolean {
    if (!this.canExchange(oldCost, newCost)) return false;
    for (const m of materials) {
      const next = this.get(m) + oldCost[m] - newCost[m];
      this.set(m, clamp(next, 0, TUNING.build.inventoryCaps[m]));
    }
    return true;
  }
  toJSON(): MaterialCounts { return this.all; }
  static fromJSON(raw: unknown, bus: EventBus): Inventory {
    const obj = requireRecord(raw, 'inventory');
    const counts = zero();
    for (const material of materials) counts[material] = requireNumber(obj[material], `inventory.${material}`);
    return new Inventory(bus, counts);
  }
}

/** Face-connected voxel support. Every piece must connect to y=0 through pieces.
 * Rotations affect the physics mesh, not the occupancy/support cell. */
export class HayBuild {
  private readonly map = new Map<number, BuildPiece>();
  private nextId = 1;
  constructor(private readonly inventory: Inventory, private readonly bus: EventBus) {}

  get pieces(): BuildPiece[] { return [...this.map.values()].sort((a, b) => a.id - b.id).map(p => copyJSON(p)); }
  getPiece(id: number): BuildPiece | undefined { const p = this.map.get(id); return p ? copyJSON(p) : undefined; }

  snap(world: { x: number; y: number; z: number }, degrees = 0): { cell: Cell; rotation: QuarterTurn } {
    for (const axis of ['x', 'y', 'z'] as const) nonNegative(Math.abs(world[axis]), `world.${axis}`);
    nonNegative(Math.abs(degrees), 'degrees');
    const grid = TUNING.build.gridSize;
    return {
      cell: { x: Math.round(world.x / grid), y: Math.round(world.y / grid), z: Math.round(world.z / grid) },
      rotation: (((Math.round(degrees / 90) % 4) + 4) % 4) as QuarterTurn,
    };
  }

  private anchored(exclude?: number): Set<number> {
    const byCell = new Map<string, BuildPiece>();
    for (const p of this.map.values()) if (p.id !== exclude) byCell.set(cellKey(p.cell), p);
    const queue: BuildPiece[] = [...byCell.values()].filter(p => p.cell.y === 0).sort((a, b) => a.id - b.id);
    const seen = new Set(queue.map(p => p.id));
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (!node) continue;
      for (const adjacent of neighbours(node.cell)) {
        const p = byCell.get(cellKey(adjacent));
        if (p && !seen.has(p.id)) { seen.add(p.id); queue.push(p); }
      }
    }
    return seen;
  }

  private isSupported(cell: Cell, exclude?: number): boolean {
    if (cell.y === 0) return true;
    const anchors = this.anchored(exclude);
    const cells = new Set([...this.map.values()].filter(p => anchors.has(p.id)).map(p => cellKey(p.cell)));
    return neighbours(cell).some(n => cells.has(cellKey(n)));
  }

  validatePlacement(placement: Placement, replacing?: number): Validation {
    if (!isRecord(placement) || !validType(placement.type) ||
      !isRecord(placement.cell) || !validCell(placement.cell as Cell)) {
      return { valid: false, reason: 'out-of-bounds' };
    }
    if (![0, 1, 2, 3].includes(placement.rotation)) return { valid: false, reason: 'invalid-rotation' };
    if ([...this.map.values()].some(p => p.id !== replacing && cellKey(p.cell) === cellKey(placement.cell))) {
      return { valid: false, reason: 'overlap' };
    }
    if (!this.isSupported(placement.cell, replacing)) return { valid: false, reason: 'no-support' };
    const former = replacing == null ? undefined : this.map.get(replacing);
    if (!this.inventory.canExchange(former ? cost(former.type) : zero(), cost(placement.type))) {
      return { valid: false, reason: 'cost' };
    }
    return { valid: true, snapped: copyJSON(placement) };
  }

  place(placement: Placement): { piece?: BuildPiece; validation: Validation } {
    const validation = this.validatePlacement(placement);
    if (!validation.valid) return { validation };
    if (this.nextId === Number.MAX_SAFE_INTEGER) throw new RangeError('build piece ID exhausted');
    if (!this.inventory.spend(cost(placement.type))) return { validation: { valid: false, reason: 'cost' } };
    const piece: BuildPiece = { ...copyJSON(placement), id: this.nextId++, hp: TUNING.build.hp[placement.type] };
    this.map.set(piece.id, piece);
    this.bus.emit('build:placed', { piece: copyJSON(piece) });
    return { piece: copyJSON(piece), validation };
  }

  edit(id: number, changes: Partial<Placement>): { piece?: BuildPiece; validation: Validation } {
    const current = this.map.get(id);
    if (!current) throw new RangeError(`missing build piece ${id}`);
    const placement: Placement = {
      type: changes.type ?? current.type,
      cell: changes.cell ?? current.cell,
      rotation: changes.rotation ?? current.rotation,
    };
    const validation = this.validatePlacement(placement, id);
    if (!validation.valid) return { validation };
    // validatePlacement guarantees this is affordable; transfer is atomic.
    if (!this.inventory.exchange(cost(current.type), cost(placement.type))) return { validation: { valid: false, reason: 'cost' } };
    const next: BuildPiece = { ...copyJSON(placement), id,
      // Re-skinning a damaged wall into a ramp must not give a free full heal.
      hp: placement.type === current.type ? current.hp :
        Math.max(1, Math.round(current.hp / TUNING.build.hp[current.type] * TUNING.build.hp[placement.type])) };
    this.map.set(id, next);
    this.bus.emit('build:edited', { before: copyJSON(current), after: copyJSON(next) });
    this.collapse('edit');
    return { piece: copyJSON(next), validation };
  }

  remove(id: number): BuildPiece | undefined {
    const piece = this.map.get(id);
    if (!piece) return undefined;
    this.map.delete(id);
    this.inventory.refund(cost(piece.type), TUNING.build.refundFraction);
    this.bus.emit('build:removed', { piece: copyJSON(piece) });
    this.collapse('remove');
    return copyJSON(piece);
  }

  damage(id: number, power: number): { broken: boolean; remainingHp: number } | undefined {
    nonNegative(power, 'headbutt power');
    const piece = this.map.get(id);
    if (!piece) return undefined;
    if (power === 0) return { broken: false, remainingHp: piece.hp };
    const applied = Math.min(piece.hp, power);
    piece.hp = Math.max(0, piece.hp - applied);
    this.bus.emit('build:hit', { piece: copyJSON(piece), damage: applied });
    if (piece.hp > 0) return { broken: false, remainingHp: piece.hp };
    this.map.delete(id);
    this.bus.emit('build:broken', { piece: copyJSON(piece) });
    this.collapse('break');
    return { broken: true, remainingHp: 0 };
  }

  private collapse(cause: 'remove' | 'edit' | 'break'): BuildPiece[] {
    const grounded = this.anchored();
    const falling = this.pieces.filter(p => !grounded.has(p.id));
    for (const piece of falling) this.map.delete(piece.id);
    if (falling.length) this.bus.emit('build:collapsed', { cause, pieces: copyJSON(falling) });
    return falling;
  }

  toJSON(): BuildSnapshot { return { nextId: this.nextId, pieces: this.pieces }; }
  static fromJSON(raw: unknown, inventory: Inventory, bus: EventBus): HayBuild {
    const obj = requireRecord(raw, 'build');
    const nextId = requireNumber(obj.nextId, 'build.nextId');
    integer(nextId, 'build.nextId');
    if (!Array.isArray(obj.pieces)) throw new TypeError('build.pieces must be an array');
    const b = new HayBuild(inventory, bus);
    const occupied = new Set<string>();
    for (const entry of obj.pieces) {
      const item = requireRecord(entry, 'build piece');
      const id = requireNumber(item.id, 'piece.id'); integer(id, 'piece.id');
      const type = requireString(item.type, 'piece.type');
      const cellObj = requireRecord(item.cell, 'piece.cell');
      const cell: Cell = {
        x: requireNumber(cellObj.x, 'x'), y: requireNumber(cellObj.y, 'y'), z: requireNumber(cellObj.z, 'z'),
      };
      const rotation = requireNumber(item.rotation, 'rotation');
      const hp = requireNumber(item.hp, 'hp');
      if (!id || !validType(type) || !validCell(cell) || ![0, 1, 2, 3].includes(rotation) ||
        hp <= 0 || hp > TUNING.build.hp[type] || occupied.has(cellKey(cell)) || b.map.has(id)) {
        throw new RangeError('invalid/overlapping build piece');
      }
      const piece: BuildPiece = { id, type, cell, rotation: rotation as QuarterTurn, hp };
      b.map.set(id, piece); occupied.add(cellKey(cell));
    }
    let maxId = 0;
    for (const id of b.map.keys()) maxId = Math.max(maxId, id);
    if (nextId < 1 || nextId <= maxId) throw new RangeError('invalid nextId');
    b.nextId = nextId;
    if (b.anchored().size !== b.map.size) throw new RangeError('snapshot contains unsupported pieces');
    return b;
  }
}
