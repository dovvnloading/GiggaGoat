import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus, StyleSystem, TUNING } from '../gameplay';
import type { HudInput } from './GameHudState';
import { clampHudPercent, deriveHudState, formatHudObjective, projectHudMap } from './GameHudState';
import { renderHudMinimap } from './HudArtwork';
import { biomeAt, createWorldScene, generateIsland } from '../world';

const input = (): HudInput => ({
  meter: 0, tier: 'Kid', score: 0,
  combo: { count: 0, points: 0, title: '' },
  stamina: 100, headbuttCharge: 0,
  inventory: { hay: 18, wood: 10, scrap: 3 },
  buildMode: false, buildPiece: 'floor',
  location: 'Hoofington', coins: 0, ragdoll: false,
});

describe('in-game HUD state projection', () => {
  it('traces the actual Hoofington shoreline without painting inland sand tiles', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const origin = island.pois.find(poi => poi.id === 'hoofington')!.center;
    const map = renderHudMinimap(island, origin);
    const readPolygons = (feature: string): Array<Array<{ x: number; y: number }>> => {
      const path = map.match(new RegExp('data-map-' + feature + ' d="([^"]*)"'))?.[1];
      expect(path).toBeTruthy();
      return (path ?? '').split('Z').filter(Boolean).map(polygon =>
        [...polygon.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) =>
          ({ x: Number(x), y: Number(y) })));
    };
    const includes = (x: number, y: number, polygons: ReturnType<typeof readPolygons>): boolean =>
      polygons.some(polygon => {
        let inside = false;
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
          if ((a.y > y) !== (b.y > y) && x < a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)) {
            inside = !inside;
          }
        }
        return inside;
      });
    const ocean = readPolygons('ocean'), beach = readPolygons('beach');
    expect(ocean.flat().some(point => point.x % 17.5 > .05 && point.y % 17.5 > .05)).toBe(true);
    expect(ocean.length + beach.length).toBeLessThan(1_000);

    const real = (x: number, y: number) => ({
      x: origin.x + (x - 140) / 1.05, z: origin.z + (y - 140) / 1.05,
    });
    const world = createWorldScene(island, { chunkSegments: 32 });
    world.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
    let seaSamples = 0, shoreSamples = 0, removedBeige = 0;
    try {
      for (let y = 12.8; y < 268; y += 5) for (let x = 12.8; x < 268; x += 5) {
        if (Math.hypot(x - 140, y - 140) > 127) continue;
        const p = real(x, y);
        ray.set(new THREE.Vector3(p.x, 300, p.z), down);
        const elevation = ray.intersectObjects(world.chunks, false)[0]!.point.y;
        if (elevation < -.5) {
          expect(includes(x, y, ocean)).toBe(true);
          seaSamples++;
        } else if (elevation > .6 && elevation < 1.9) {
          expect(includes(x, y, ocean)).toBe(false);
          expect(includes(x, y, beach)).toBe(true);
          shoreSamples++;
        } else if (elevation > 3.35) {
          const tile = real((Math.floor(x / 17.5) + .5) * 17.5, (Math.floor(y / 17.5) + .5) * 17.5);
          const biome = biomeAt(island, tile.x, tile.z);
          if (biome === 'beach' || biome === 'ocean') {
            expect(includes(x, y, beach)).toBe(false);
            removedBeige++;
          }
        }
      }
    } finally {
      world.dispose();
    }
    expect(seaSamples).toBeGreaterThan(100);
    expect(shoreSamples).toBeGreaterThan(25);
    expect(removedBeige).toBeGreaterThan(2);
  });

  it('masks nearby scenery while preserving distinct full-contrast map layers', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const map = renderHudMinimap(island, island.pois.find(poi => poi.id === 'hoofington')!.center);
    const scenery = map.match(/<g data-map-scenery[^>]*>([^]*?)<\/g>/)?.[0];
    expect(map).toContain('<circle data-map-player-clearance r="43"');
    expect(map).toContain('stop-color="#373737"');
    expect(scenery).toContain('mask="url(#gg-hud-map-scenery)"');
    expect(scenery).toMatch(/data-sprite="icons\/marker_/);
    const icons = Array.from(scenery!.matchAll(/<image [^>]*?x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g),
      ([, x, y, w, h]) => ({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) }));
    expect(icons.length).toBeGreaterThan(1);
    for (const [i, a] of icons.entries()) for (const b of icons.slice(i + 1)) {
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    expect(scenery).not.toContain('data-player>');
    expect(scenery).not.toContain('data-map-objectives>');
    expect(map).toMatch(/<\/g><g data-map-objectives><path data-map-climb-target[^>]*\/><\/g><g data-player>/);
  });

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

  it('shows low stamina only below the ability start threshold', () => {
    const state = input();
    state.stamina = TUNING.stamina.minStart;
    expect(deriveHudState(state).staminaLow).toBe(false);
    state.stamina = TUNING.stamina.minStart - .01;
    expect(deriveHudState(state).staminaLow).toBe(true);
    state.stamina = 0;
    expect(deriveHudState(state).staminaLow).toBe(true);
    state.stamina = TUNING.stamina.max;
    expect(deriveHudState(state).staminaLow).toBe(false);
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

  it('shows the next action and physical progress for dives, stacks and flag routes', () => {
    const state = input();
    state.gig = {
      title: 'Splash Dive', status: 'running',
      objective: { kind: 'splash', label: '', drop: 6.4, requiredDrop: 2.5, splashed: false },
      elapsedTicks: 0, maxTicks: 600, goldTicks: 400, silverTicks: 500,
    };
    expect(deriveHudState(state).gig).toMatchObject({
      task: 'Reach the launch marker', detail: '2.5m DROP NEEDED · 10s LEFT',
    });
    state.gig.objective = { kind: 'splash', label: '', drop: 6.4, requiredDrop: 2.5, splashed: false,
      launchReached: true, requiresFlop: true };
    expect(deriveHudState(state).gig.task).toBe('Flop into marked water');

    state.gig.objective = { kind: 'stack', label: '', layers: 2, required: 2, stableTicks: 125, holdTicks: 300 };
    expect(deriveHudState(state).gig).toMatchObject({
      task: 'Keep the stack still', detail: 'HOLD 3s MORE · 10s LEFT',
    });

    state.gig.objective = { kind: 'summit', label: '', climbed: 2.4, minimumClimb: 4, reached: 1, total: 3 };
    expect(deriveHudState(state).gig).toMatchObject({
      task: 'Reach flag 2', detail: '1/3 FLAGS · 2/4m CLIMB · 10s LEFT',
    });
    state.gig.objective = { ...state.gig.objective, reached: 3, minimumClimb: 0, requiresBleat: true };
    expect(deriveHudState(state).gig).toMatchObject({
      task: 'Bleat at the beacon', detail: '3/3 FLAGS · 10s LEFT',
    });
  });

  it('keeps the board-side demolition cue alongside mass and time after the first hit', () => {
    const state = input();
    state.gig = {
      title: 'Demolition Contract', status: 'running',
      objective: { kind: 'displace', label: '', movedMass: 0, requiredMass: 39.6, headbutts: 0 },
      elapsedTicks: 0, maxTicks: 3600, goldTicks: 1800, silverTicks: 2400,
    };
    expect(deriveHudState(state).gig).toMatchObject({
      task: 'Headbutt from board side', detail: '0/40 kg MOVED · 60s LEFT',
    });
    state.gig.objective = { kind: 'displace', label: '', movedMass: 14.5, requiredMass: 39.6, headbutts: 4 };
    expect(deriveHudState(state).gig).toMatchObject({
      task: 'Headbutt from board side', detail: '15/40 kg MOVED · 60s LEFT',
    });
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
