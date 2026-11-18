import { describe, expect, it } from 'vitest';
import { EventBus, StyleSystem, TUNING } from '../gameplay';
import type { HudInput } from './GameHudState';
import { clampHudPercent, deriveHudState, formatHudObjective, projectHudMap } from './GameHudState';

const input = (): HudInput => ({
  meter: 0, tier: 'Kid', score: 0,
  combo: { count: 0, points: 0, title: '' },
  stamina: 100, headbuttCharge: 0,
  inventory: { hay: 18, wood: 10, scrap: 3 },
  buildMode: false, buildPiece: 'floor',
  location: 'Hoofington', coins: 0, ragdoll: false,
});

describe('in-game HUD state projection', () => {
  it('shows every growth tier and clamps the live meter without changing simulation state', () => {
    const state = input();
    for (const tier of ['Kid', 'Billy', 'Big', 'GIGGA'] as const) {
      state.tier = tier;
      state.meter = tier === 'Kid' ? -10 : tier === 'Billy' ? 16 : tier === 'Big' ? 55 : 500;
      const view = deriveHudState(state);
      expect(view.tier).toBe(tier);
      expect(view.meter).toBe(tier === 'Kid' ? 0 : tier === 'Billy' ? 16 : tier === 'Big' ? 55 : 100);
    }
    expect(clampHudPercent(Number.NaN)).toBe(0);
    expect(clampHudPercent(Infinity)).toBe(0);
    expect(clampHudPercent(-1)).toBe(0);
    expect(clampHudPercent(101)).toBe(100);
  });

  it('preserves the score and wallet between combos and labels active tricks', () => {
    const state = input();
    state.score = 48750;
    state.coins = 1234;
    const idle = deriveHudState(state);
    expect(idle.score).toBe('48,750');
    expect(idle.coins).toBe('1,234');
    expect(idle.comboCount).toBe(0);
    expect(idle.comboTitle).toBe('');
    state.combo = { count: 12, points: 2396, title: 'HOOF HURRICANE' };
    const active = deriveHudState(state);
    expect(active.comboTitle).toBe('HOOF HURRICANE');
    expect(active.comboCount).toBe(12);
    expect(active.comboPoints).toBe('2,396');
    expect(state.combo.points).toBe(2396);
  });

  it('uses live style events and expiry to enter and leave the combo presentation', () => {
    const style = new StyleSystem(new EventBus());
    const score = () => deriveHudState({ ...input(), score: style.score, combo: style.combo });
    expect(score()).toMatchObject({ score: '0', comboTitle: '', comboCount: 0 });
    style.ingest({ type: 'flip' });
    expect(score()).toMatchObject({ comboTitle: 'WARM-UP', comboCount: 1 });
    style.ingest({ type: 'knockback' });
    const combo = score();
    expect(combo).toMatchObject({ comboTitle: 'GOAT-ROCKET', comboCount: 2 });
    style.update(TUNING.style.comboWindow);
    expect(score()).toMatchObject({ score: combo.score, comboTitle: '', comboCount: 0, comboPoints: '0' });
  });

  it('keeps the Hay-Build keys matched to real piece types and computes affordable counts', () => {
    const state = input();
    state.buildMode = true;
    state.buildPiece = 'ramp';
    const view = deriveHudState(state);
    expect(view.slots.map(slot => [slot.key, slot.type])).toEqual([
      ['1', 'floor'], ['2', 'wall'], ['3', 'ramp'], ['4', 'launch-pad'],
    ]);
    // 18 hay, 10 wood, 3 scrap, using actual material costs.
    expect(view.slots.map(slot => slot.available)).toEqual([6, 5, 4, 1]);
    expect(view.slots.map(slot => slot.selected)).toEqual([false, false, true, false]);
    expect(view.materials).toBe('HAY 18 · WOOD 10 · SCRAP 3');
    expect(view.mode).toBe('HAY-BUILD');
    state.inventory = { hay: 2, wood: 1, scrap: 0 };
    expect(deriveHudState(state).slots.map(slot => slot.available)).toEqual([0, 0, 0, 0]);
    state.buildMode = false;
    state.ragdoll = true;
    expect(deriveHudState(state).mode).toBe('FLOP MODE');
  });

  it('tracks stamina and headbutt charge within the visible ring and bar', () => {
    const state = input();
    state.stamina = 72.2;
    state.headbuttCharge = .75;
    const view = deriveHudState(state);
    expect(view.stamina).toBeCloseTo(72.2);
    expect(view.headbutt).toBe(50);
    state.stamina = -20;
    state.headbuttCharge = 7;
    expect(deriveHudState(state).stamina).toBe(0);
    expect(deriveHudState(state).headbutt).toBe(100);
  });

  it('shows the next-gig prompt unless a real contract is active', () => {
    const state = input();
    const inactive = deriveHudState(state);
    expect(inactive.gig.active).toBe(false);
    expect(inactive.gig.task).toBe('Find a gig board');
    state.boardInRange = true;
    expect(deriveHudState(state).gig.task).toBe('Contracts available here');
    state.gig = {
      title: 'Mow-down', status: 'running',
      objective: { kind: 'coverage', label: 'Graze the grass', eaten: 4, total: 9, bites: 4 },
      elapsedTicks: 360, maxTicks: 1200, goldTicks: 400, silverTicks: 700,
    };
    const running = deriveHudState(state);
    expect(running.gig).toEqual({
      title: 'Mow-down', task: 'Graze the grass',
      detail: '4 / 9 PATCHES · 14s LEFT · GOLD PACE*', active: true,
    });
    state.gig.elapsedTicks = 550;
    expect(deriveHudState(state).gig.detail).toContain('SILVER PACE*');
    state.gig.elapsedTicks = 800;
    expect(deriveHudState(state).gig.detail).toContain('BRONZE PACE');
    state.gig.status = 'completed';
    state.gig.rating = 'silver';
    state.gig.payout = 87;
    expect(deriveHudState(state).gig.detail).toBe('SILVER · +87 CUD COINS');
    state.partyTitle = 'Rising Tide';
    expect(deriveHudState(state).gig.title).toBe('Rising Tide');
    expect(deriveHudState(state).mode).toBe('Rising Tide');
  });

  it('formats each discriminated gig objective using verified progress fields', () => {
    expect(formatHudObjective({ kind: 'deliver', label: '', done: 2, required: 3,
      destination: { x: 0, y: 0, z: 0 } })).toBe('2 / 3 BALES');
    expect(formatHudObjective({ kind: 'checkpoints', label: '', reached: 1, total: 5 }))
      .toBe('1 / 5 CHECKPOINTS');
    expect(formatHudObjective({ kind: 'escort', label: '', reached: 3, total: 4, fragile: true }))
      .toBe('3 / 4 CHECKPOINTS');
    expect(formatHudObjective({ kind: 'summit', label: '', reached: 2, total: 4, climbed: 8 }))
      .toBe('2 / 4 CHECKPOINTS');
    expect(formatHudObjective({ kind: 'displace', label: '', movedMass: 7.7,
      requiredMass: 20.3, headbutts: 2 })).toBe('8 / 20 MASS');
    expect(formatHudObjective({ kind: 'stack', label: '', layers: 2, required: 5,
      stableTicks: 1, holdTicks: 12 })).toBe('2 / 5 CRATES');
    expect(formatHudObjective({ kind: 'splash', label: '', drop: 6.25, requiredDrop: 10,
      splashed: false })).toBe('6.3 / 10.0m DROP');
  });

  it('projects the minimap north-up with no fake position or rotation', () => {
    const origin = { x: -147, z: 133 };
    expect(projectHudMap(origin, origin)).toEqual({ x: 140, y: 140 });
    expect(projectHudMap({ x: -137, z: 123 }, origin)).toEqual({ x: 150.5, y: 129.5 });
    expect(projectHudMap({ x: -147, z: 153 }, origin)).toEqual({ x: 140, y: 161 });
  });
});
