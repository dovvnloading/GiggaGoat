import { beforeAll, describe, expect, it, vi } from 'vitest';
import { generateIsland, isAmbientSegmentSafe, type IslandData } from '../world';
import { IslandLifeDirector, type IslandLifeContext } from './IslandLifeDirector';

let island: IslandData;
beforeAll(() => { island = generateIsland({ seed: 'billy-isle' }); });
const context = (time: number, overrides: Partial<IslandLifeContext> = {}): IslandLifeContext => ({
  time, phase: .5, rain: 0, tideLevel: 0,
  player: { position: { x: 0, y: 100, z: 0 }, radius: 1 }, enabled: true, ...overrides,
});
function advance(life: IslandLifeDirector, start: number, end: number,
  overrides: Partial<IslandLifeContext> = {}): void {
  for (let tick = Math.round(start * 60); tick < Math.round(end * 60); tick++)
    life.step(1 / 60, context(tick / 60, overrides));
}

describe('IslandLifeDirector', () => {
  it('is deterministic and carries on without the goat while remaining supported and separated', () => {
    const a = new IslandLifeDirector(island), b = new IslandLifeDirector(island);
    const originalPositions = a.residents.map(s => ({ ...s.position }));
    for (let second = 0; second < 90; second++) {
      advance(a, second, second + 1); advance(b, second, second + 1);
      expect(a.residents).toEqual(b.residents);
      for (let i = 0; i < a.residents.length; i++) {
        const actor = a.residents[i]!;
        expect(actor.position.y).toBeCloseTo(a.plan.navigation.surfaceAt(actor.position.x, actor.position.z), 7);
        expect(isAmbientSegmentSafe(a.plan.navigation, actor.position, actor.position)).toBe(true);
        for (let j = i + 1; j < a.residents.length; j++) {
          const other = a.residents[j]!;
          expect(Math.hypot(actor.position.x - other.position.x, actor.position.z - other.position.z))
            .toBeGreaterThanOrEqual(actor.radius + other.radius - .001);
        }
      }
    }
    expect(a.residents.every(s => s.distanceTravelled > 10)).toBe(true);
    expect(a.residents.map(s => s.position)).not.toEqual(originalPositions);
    expect(new Set(a.residents.map(s => s.phase)).size).toBe(a.residents.length);
    a.dispose(); b.dispose();
  });

  it('caps/coalesces accepted events, prioritizes danger and recovers without queued storms', () => {
    const life = new IslandLifeDirector(island), p = { ...life.residents[0]!.position };
    const accepted = life.react('bleat', p, 0);
    expect(accepted).toBeGreaterThan(0); expect(accepted).toBeLessThanOrEqual(6);
    expect(life.residents.filter(s => s.activity === 'wave' || s.activity === 'look')).toHaveLength(accepted);
    for (let i = 0; i < 100; i++) expect(life.react('bleat', p, 0)).toBe(0);
    const alarm = life.react('headbutt', p, .05, .9);
    expect(alarm).toBeGreaterThan(0); expect(alarm).toBeLessThanOrEqual(6);
    expect(life.residents.filter(s => s.activity === 'startle').length).toBe(alarm);
    expect(life.react('chaos', p, .1)).toBe(0);
    advance(life, .05, 7);
    expect(life.residents.some(s => ['wave', 'startle', 'flee'].includes(s.activity))).toBe(false);
    expect(life.stats.queuedEvents).toBe(0);
    expect(life.stats.acceptedEvents).toBe(2);
    expect(life.react('bleat', { ...p, y: p.y + 20 }, 9)).toBe(0);
    life.dispose();
  });

  it('waits instead of following its old itinerary when no safe retreat exists, then recovers', () => {
    const life = new IslandLifeDirector(island);
    try {
      advance(life, 0, 12);
      const actor = life.residents.find(state => state.activity === 'walk' && state.speed > .1);
      expect(actor).toBeDefined();
      const resident = actor!, at = { ...resident.position }, distance = resident.distanceTravelled;
      const nav = life.plan.navigation, walkable = nav.walkableAt;
      // A local pocket preserves planted support and small movement steps but
      // excludes every candidate in the 2–6 metre retreat search.
      const pocket = vi.spyOn(nav, 'walkableAt').mockImplementation((x, z, margin) =>
        Math.hypot(x - at.x, z - at.z) < 1.8 * nav.scale && walkable(x, z, margin));
      try {
        expect(life.react('headbutt', at, 12)).toBeGreaterThan(0);
        expect(resident.activity).toBe('startle');
        advance(life, 12, 16);
        expect(resident.position).toEqual(at);
        expect(resident.distanceTravelled).toBe(distance);
        expect(resident.speed).toBe(0);
        expect(resident.activity).toBe('startle');
      } finally { pocket.mockRestore(); }
      advance(life, 16, 36);
      expect(resident.reactionUntil).toBeLessThan(36);
      expect(resident.distanceTravelled).toBeGreaterThan(distance);
      expect(isAmbientSegmentSafe(nav, resident.position, resident.position)).toBe(true);
    } finally { life.dispose(); }
  });

  it('walks to shelter through rain and night transitions, with no position jumps or clock rewinds', () => {
    const life = new IslandLifeDirector(island), before = life.residents.map(s => ({ ...s.position }));
    life.step(1 / 60, context(0, { rain: 1 }));
    for (const [i, state] of life.residents.entries())
      expect(Math.hypot(state.position.x - before[i]!.x, state.position.z - before[i]!.z)).toBeLessThan(.03);
    advance(life, 1 / 60, 180, { rain: 1 });
    expect(life.residents.filter(s => s.activity === 'shelter').length).toBeGreaterThanOrEqual(12);
    const sheltered = structuredClone(life.residents);
    life.step(1 / 60, context(20));
    expect(life.residents).toEqual(sheltered);
    advance(life, 180, 200, { rain: .3 });
    expect(life.residents.filter(s => s.activity === 'shelter').length).toBeGreaterThanOrEqual(12);
    advance(life, 200, 225, { rain: 0, phase: .5 });
    expect(life.residents.some(s => s.speed > .1)).toBe(true);
    advance(life, 225, 400, { phase: .05 });
    expect(life.residents.filter(s => s.activity === 'shelter').length).toBeGreaterThanOrEqual(12);
    life.dispose();
  });

  it('yields to goat proximity and live obstacles without accepting a reaction or awarding anything', () => {
    const life = new IslandLifeDirector(island), actor = life.residents[0]!, origin = { ...actor.position };
    const player = { position: { ...origin, x: origin.x + .5 }, radius: 1.1 };
    advance(life, 0, 5, { player });
    expect(life.stats.acceptedEvents).toBe(0);
    expect(actor.distanceTravelled).toBeGreaterThan(0);
    expect(Math.hypot(actor.position.x - player.position.x, actor.position.z - player.position.z)).toBeGreaterThan(.5);
    const obstacle = { position: { ...actor.position, x: actor.position.x + .5 }, radius: .7, height: 1.5 };
    advance(life, 5, 10, { obstacles: [obstacle] });
    expect(life.stats.acceptedEvents).toBe(0);
    expect(isAmbientSegmentSafe(life.plan.navigation, actor.position, actor.position)).toBe(true);
    life.dispose();
  });

  it('freezes during gameplay suppression and pause, resumes coherently and disposes idempotently', () => {
    const life = new IslandLifeDirector(island);
    advance(life, 0, 8);
    const positions = life.residents.map(s => ({ ...s.position })), ids = life.residents.map(s => s.id);
    advance(life, 8, 20, { enabled: false });
    expect(life.residents.map(s => s.position)).toEqual(positions);
    expect(life.react('headbutt', positions[0]!, 21)).toBe(0);
    life.step(0, context(100));
    expect(life.residents.map(s => s.position)).toEqual(positions);
    advance(life, 20, 35);
    expect(life.residents.map(s => s.id)).toEqual(ids);
    expect(life.residents.map(s => s.position)).not.toEqual(positions);
    const atDispose = life.residents.map(s => ({ ...s.position }));
    life.dispose(); life.dispose(); advance(life, 35, 40);
    expect(life.residents.map(s => s.position)).toEqual(atDispose);
    expect(life.react('bleat', atDispose[0]!, 40)).toBe(0);
  });

  it('never steps into a newly flooded route or responds to invalid event coordinates', () => {
    const life = new IslandLifeDirector(island);
    const initial = life.residents.map(s => ({ ...s.position }));
    advance(life, 0, 5, { tideLevel: 100 });
    expect(life.residents.map(s => s.position)).toEqual(initial);
    expect(life.react('bleat', { x: NaN, y: 0, z: 0 }, 6)).toBe(0);
    expect(life.react('chaos', initial[0]!, -1)).toBe(0);
    expect(life.react('headbutt', initial[0]!, Infinity)).toBe(0);
    life.dispose();
  });
});
