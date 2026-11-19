import { expect, it } from 'vitest';
import { Game, type PlayerIntent } from './Game';
import { heightAt } from '../world';

type Point = { x: number; z: number };
const ticks = (g: Game, n: number, i: PlayerIntent = {}) => { for (let t = 0; t < n; t++) g.step(i); };
const steer = (g: Game, to: Point, speed = 1, intent: PlayerIntent = {}) => {
  const p = g.goat.torso.translation(), x = to.x - p.x, z = to.z - p.z;
  g.step({ moveZ: Math.min(speed, Math.hypot(x, z) * 1.5), cameraYaw: Math.atan2(x, -z), ...intent });
};
const go = (g: Game, to: Point, threshold = .25) => {
  for (let t = 0; t < 680; t++) {
    const p = g.goat.torso.translation();
    if (Math.hypot(to.x - p.x, to.z - p.z) < threshold) return;
    steer(g, to);
  }
  throw Error('Could not move to ' + JSON.stringify({ to, p: g.goat.torso.translation() }));
};

it.each(['easy', 'medium', 'hard'] as const)('uses the native lift for a stable %s stack', async tier => {
  const g = await Game.create({ seed: 'billy-isle', resolution: 193 });
  try {
    const b = g.gigs.boards.find(entry => entry.poiId === 'crane-yard')!.position;
    const x = b.x + 7.6, z = b.z + 2;
    g.teleport({ x, y: heightAt(g.island, x, z), z }, 0);
    ticks(g, 45);
    let offer = g.gigs.board('crane-yard').find(o => o.gigId === 'stack-up' && o.difficulty === tier);
    while (!offer) {
      const last = g.gigs.director.tick + g.gigs.director.board('crane-yard').refreshInTicks;
      const frame = { goat: { position: g.goat.torso.translation(), size: g.goat.size } };
      while (g.gigs.director.tick < last) g.gigs.director.step(frame);
      offer = g.gigs.board('crane-yard').find(o => o.gigId === 'stack-up' && o.difficulty === tier);
    }
    g.gigs.accept(offer.id);
    const config = g.gigs.active!.setup.config;
    if (config.kind !== 'stack-up') throw Error('wrong gig');
    const pad = config.center;
    go(g, { x: pad.x + 1.5, z: pad.z + 4.8 });
    for (const [layer, index] of [0, 2, 4, 1].slice(0, config.requiredLayers).entries()) {
      const crate = g.gigs.props.get(config.crateIds[index]!)!.body;
      const row = crate.translation().z;
      const lane = pad.x + (index === 1 ? 5.3 : 2.1);
      go(g, { x: lane, z: row + .65 });
      go(g, { x: lane, z: row });
      go(g, crate.translation(), 2.05);
      for (let t = 0; t < 35 && !g.goat.interactions.isTongueAttached; t++) g.step({ tongue: true });
      expect(g.goat.interactions.tongueBody?.handle, JSON.stringify({ tier, layer,
        p: g.goat.torso.translation(), c: crate.translation(), heading: g.goat.locomotion.heading })).toBe(crate.handle);
      for (let t = 0; t < 380 && g.gigs.stackLiftCue !== 'ready'; t++) {
        steer(g, { x: pad.x + 1.05, z: pad.z + .5 }, .62, { tongue: true });
      }
      expect(g.gigs.stackLiftCue, JSON.stringify({ layer, p: g.goat.torso.translation(),
        c: crate.translation(), held: g.goat.interactions.tongueBody?.handle })).toBe('ready');
      g.step({ tongue: true, reelTongue: true });
      expect(g.gigs.stackLiftCue).toBe('moving');
      expect(crate.isKinematic()).toBe(true);
      for (let t = 0; t < 250 && crate.isKinematic(); t++) {
        if (g.gigs.stackLiftCue === 'clear') steer(g, { x: pad.x + 1.75, z: pad.z + .4 });
        else g.step();
      }
      expect(crate.isDynamic()).toBe(true);
      expect(g.goat.interactions.tongueBody).toBeNull();
      ticks(g, 75);
      expect(g.gigs.active!.objective, JSON.stringify({ layer, c: crate.translation() })).toMatchObject({
        kind: 'stack', layers: layer + 1,
      });
    }
    expect(g.gigs.active?.status).toBe('running');
    const early = g.gigs.active!.stableTicks;
    ticks(g, config.holdTicks - early - 1);
    expect(g.gigs.active?.status).toBe('running');
    expect(g.gigs.active?.stableTicks).toBe(config.holdTicks - 1);
    g.step();
    const result = g.gigs.active!;
    expect(result.status).toBe('completed');
    expect(result.metrics.maxLayers).toBe(config.requiredLayers);
    expect(result.stableTicks).toBe(config.holdTicks);
    expect(result.payout).toBeGreaterThan(0);
  } finally { g.dispose(); }
}, 60_000);
