import { describe, expect, it } from 'vitest';
import { EventBus, HayBuild, Inventory, TUNING } from './index';
import type { Placement } from './index';
const at = (x: number, y: number, z: number, type: Placement['type'] = 'floor'): Placement =>
  ({ type, cell: { x, y, z }, rotation: 0 });
function setup(hay = 100, wood = 65, scrap = 40) {
  const events = new EventBus();
  const inventory = new Inventory(events, { hay, wood, scrap });
  return { events, inventory, build: new HayBuild(inventory, events) };
}
function place(build: HayBuild, placement: Placement): number {
  const result = build.place(placement);
  expect(result.validation).toMatchObject({ valid: true });
  expect(result.piece).toBeDefined();
  return result.piece!.id;
}

describe('Inventory', () => {
  it('caps harvests, emits accepted amounts, and spends atomically', () => {
    const { events, inventory } = setup(98, 1, 1);
    const received: number[] = [];
    events.on('material:harvested', e => received.push(e.amount));
    expect(inventory.harvest('hay', 20)).toBe(2);
    expect(inventory.harvest('hay', 2)).toBe(0);
    expect(received).toEqual([2]);
    expect(inventory.spend({ hay: 2, wood: 2, scrap: 0 })).toBe(false);
    expect(inventory.all).toEqual({ hay: 100, wood: 1, scrap: 1 });
    expect(inventory.spend({ hay: 3, wood: 1, scrap: 0 })).toBe(true);
    expect(inventory.all).toEqual({ hay: 97, wood: 0, scrap: 1 });
    expect(() => inventory.harvest('hay', -3)).toThrow();
    expect(() => inventory.harvest('fake' as 'hay', 1)).toThrow();
    expect(() => inventory.canAfford({ hay: -1, wood: 0, scrap: 0 })).toThrow();
    expect(() => inventory.spend({ hay: NaN, wood: 0, scrap: 0 })).toThrow();
  });
  it('round-trips and validates caps', () => {
    const { inventory } = setup(40, 22, 11);
    expect(Inventory.fromJSON(inventory.toJSON(), new EventBus()).toJSON()).toEqual(inventory.toJSON());
    expect(() => Inventory.fromJSON({ hay: 101, wood: 1, scrap: 1 }, new EventBus())).toThrow();
  });
});

describe('HayBuild', () => {
  it('snaps all axes, normalizes rotation and rejects unsupported/overlapping/costly pieces', () => {
    const { build } = setup(3, 0, 0);
    expect(build.snap({ x: 3.8, y: 4.2, z: -1.9 }, -90)).toEqual({ cell: { x: 2, y: 2, z: -1 }, rotation: 3 });
    expect(build.validatePlacement(at(0, 3, 0))).toMatchObject({ valid: false, reason: 'no-support' });
    expect(build.validatePlacement(at(0, 0, 0, 'wall'))).toMatchObject({ valid: false, reason: 'cost' });
    const floor = build.place(at(0, 0, 0)); expect(floor.piece).toBeDefined();
    expect(build.validatePlacement(at(0, 0, 0))).toMatchObject({ valid: false, reason: 'overlap' });
    expect(build.validatePlacement(at(1, 0, 0))).toMatchObject({ valid: false, reason: 'cost' });
    expect(build.validatePlacement({ ...at(1, 0, 0), rotation: 7 as 0 })).toMatchObject({ valid: false, reason: 'invalid-rotation' });
    expect(build.validatePlacement(at(1, -1, 0))).toMatchObject({ valid: false, reason: 'out-of-bounds' });
    expect(build.validatePlacement({ type: 'floor' } as Placement)).toMatchObject({ valid: false, reason: 'out-of-bounds' });
    expect(build.validatePlacement(at(1, TUNING.build.maxHeight + 1, 0))).toMatchObject({ valid: false, reason: 'out-of-bounds' });
  });
  it('collapses EXACTLY the disconnected branch, preserving a separate ground anchor', () => {
    const { events, build } = setup();
    const root = place(build, at(0, 0, 0));
    const stem = place(build, at(0, 1, 0, 'wall'));
    const leaf = place(build, at(0, 2, 0, 'ramp'));
    const wing = place(build, at(1, 2, 0));
    const otherRoot = place(build, at(5, 0, 0));
    const otherLeaf = place(build, at(5, 1, 0));
    const fallen: number[][] = [];
    events.on('build:collapsed', e => fallen.push(e.pieces.map(p => p.id)));
    build.remove(root);
    expect(fallen).toEqual([[stem, leaf, wing]]);
    expect(build.pieces.map(p => p.id)).toEqual([otherRoot, otherLeaf]);
    expect(build.getPiece(stem)).toBeUndefined();
  });
  it('uses BFS from ALL ground roots, avoiding false collapse for multiply supported spans', () => {
    const { build } = setup();
    const a = place(build, at(0, 0, 0));
    place(build, at(0, 1, 0));
    place(build, at(1, 1, 0));
    place(build, at(2, 0, 0));
    place(build, at(2, 1, 0));
    build.remove(a);
    expect(build.pieces).toHaveLength(4);
  });
  it('edit moves, rotates, exchanges costs without cap loss and collapses lost support', () => {
    const { build, inventory, events } = setup();
    const root = place(build, at(0, 0, 0));
    const branch = place(build, at(0, 1, 0));
    const tip = place(build, at(0, 2, 0));
    const before = inventory.all;
    const changed = build.edit(root, { type: 'launch-pad', rotation: 2 });
    expect(changed.validation.valid).toBe(true);
    expect(changed.piece?.rotation).toBe(2);
    expect(inventory.get('scrap')).toBe(before.scrap - 3);
    const rejected = build.edit(root, { cell: { x: 4, y: 10, z: 0 } });
    expect(rejected.validation).toMatchObject({ valid: false, reason: 'no-support' });
    expect(build.getPiece(root)?.cell).toEqual({ x: 0, y: 0, z: 0 });
    const collapse: number[][] = [];
    events.on('build:collapsed', e => collapse.push(e.pieces.map(p => p.id)));
    expect(build.edit(root, { cell: { x: 3, y: 0, z: 0 } }).validation.valid).toBe(true);
    expect(collapse).toEqual([[branch, tip]]);
  });
  it('breaking a support damages HP then collapses dependents, without refund for damage', () => {
    const { build, inventory, events } = setup();
    const root = place(build, at(0, 0, 0, 'wall'));
    const tower = place(build, at(0, 1, 0));
    const counts = inventory.all;
    const falls: number[][] = []; const hits: number[] = [];
    events.on('build:collapsed', e => falls.push(e.pieces.map(p => p.id)));
    events.on('build:hit', e => hits.push(e.damage));
    expect(build.damage(root, 25)).toEqual({ broken: false, remainingHp: TUNING.build.hp.wall - 25 });
    expect(build.getPiece(root)?.hp).toBe(55);
    expect(build.damage(root, 1_000)).toEqual({ broken: true, remainingHp: 0 });
    expect(build.pieces).toHaveLength(0);
    expect(falls).toEqual([[tower]]);
    expect(hits).toEqual([25, 55]);
    expect(inventory.all).toEqual(counts);
    expect(() => build.damage(root, -1)).toThrow();
  });

  it('preserves percentage damage when changing piece type, blocking free edit-heals', () => {
    const { build } = setup();
    const id = place(build, at(0, 0, 0, 'wall'));
    build.damage(id, 40);
    expect(build.getPiece(id)?.hp).toBe(40);
    const ramp = build.edit(id, { type: 'ramp' }).piece!;
    expect(ramp.hp).toBe(35);
    const wall = build.edit(id, { type: 'wall' }).piece!;
    expect(wall.hp).toBe(40);
  });
  it('manual removal refunds material; cosmetic rotation edit preserves damaged HP', () => {
    const { build, inventory } = setup(10, 5, 5);
    const root = place(build, at(0, 0, 0, 'wall'));
    expect(inventory.all).toEqual({ hay: 8, wood: 3, scrap: 5 });
    build.damage(root, 17);
    const edit = build.edit(root, { rotation: 3 });
    expect(edit.piece?.hp).toBe(TUNING.build.hp.wall - 17);
    build.remove(root);
    expect(inventory.all).toEqual({ hay: 10, wood: 5, scrap: 5 });
  });
  it('build snapshots round-trip including IDs/HP, and defend against malformed graphs', () => {
    const { build, inventory } = setup();
    place(build, at(0, 0, 0)); const roof = place(build, at(0, 1, 0));
    build.damage(roof, 22);
    const snapshot = build.toJSON();
    const restored = HayBuild.fromJSON(JSON.parse(JSON.stringify(snapshot)) as unknown, inventory, new EventBus());
    expect(restored.toJSON()).toEqual(snapshot);
    expect(restored.place(at(1, 0, 0)).piece?.id).toBe(snapshot.nextId);
    const corrupt = structuredClone(snapshot);
    corrupt.pieces[0]!.cell.y = 4;
    expect(() => HayBuild.fromJSON(corrupt, inventory, new EventBus())).toThrow();
    const overlap = structuredClone(snapshot);
    overlap.pieces[1]!.cell.y = 0;
    expect(() => HayBuild.fromJSON(overlap, inventory, new EventBus())).toThrow();
  });
});
