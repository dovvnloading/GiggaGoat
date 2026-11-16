import { describe, expect, it } from 'vitest';
import { GoatAbilities, EventBus, TUNING } from './index';
import type { GoatIntent, GoatPhysicsFacts } from './index';
const STEP = TUNING.fixedDt;
const ground: GoatPhysicsFacts = { grounded: true, airborneTime: 0, speed: 8, touchingSteepWall: false, size: 'Billy' };
const wall: GoatPhysicsFacts = { ...ground, grounded: false, airborneTime: 1, touchingSteepWall: true };
function run(goat: GoatAbilities, count: number, intent: GoatIntent, facts = ground) {
  let result = goat.update(STEP, intent, facts);
  for (let i = 1; i < count; i++) result = goat.update(STEP, intent, facts);
  return result;
}

describe('GoatAbilities', () => {
  it('drains sprint stamina, delays regeneration, and caps at full', () => {
    const goat = new GoatAbilities(new EventBus());
    run(goat, 120, { sprint: true });
    expect(goat.stamina).toBeCloseTo(76, 3);
    const stalled = goat.stamina;
    run(goat, 30, {});
    expect(goat.stamina).toBeCloseTo(stalled, 3);
    run(goat, 60, {});
    expect(goat.stamina).toBeGreaterThan(stalled);
    run(goat, 300, {});
    expect(goat.stamina).toBe(100);
  });
  it('climb requires contact, air, stamina, and a climb-capable size', () => {
    const goat = new GoatAbilities(new EventBus());
    expect(goat.update(STEP, { climb: true }, ground).setClimb).toBe(false);
    expect(goat.update(STEP, { climb: true }, wall).setClimb).toBe(true);
    expect(goat.update(STEP, { climb: true }, { ...wall, size: 'GIGGA' }).setClimb).toBe(false);
    run(goat, 400, { climb: true }, wall);
    expect(goat.stamina).toBeLessThan(TUNING.stamina.minStart);
    expect(goat.update(STEP, { climb: true }, wall).setClimb).toBe(false);
  });
  it('headbutt charge thresholds produce tap, ram and meteor with size scaling', () => {
    const impulse = (durationTicks: number, size: GoatPhysicsFacts['size']) => {
      const goat = new GoatAbilities(new EventBus()); const f = { ...ground, size };
      run(goat, durationTicks, { chargeHeadbutt: true }, f);
      return goat.update(STEP, {}, f).headbutt;
    };
    const tap = impulse(12, 'Billy'); const ram = impulse(40, 'Billy');
    const meteor = impulse(70, 'Billy'); const gigga = impulse(70, 'GIGGA');
    expect(tap?.level).toBe('tap'); expect(ram?.level).toBe('ram'); expect(meteor?.level).toBe('meteor');
    expect(tap!.impulse).toBeLessThan(ram!.impulse);
    expect(ram!.impulse).toBeLessThan(meteor!.impulse);
    expect(gigga!.impulse).toBeCloseTo(meteor!.impulse * TUNING.size.GIGGA.impulse, 6);
  });

  it('rewards fast headbutts with bounded momentum instead of unbounded speed', () => {
    const fire = (speed: number) => {
      const goat = new GoatAbilities(new EventBus()); const facts = { ...ground, speed };
      run(goat, 30, { chargeHeadbutt: true }, facts);
      return goat.update(STEP, {}, facts).headbutt!.impulse;
    };
    expect(fire(10)).toBeGreaterThan(fire(0));
    expect(fire(1_000)).toBeCloseTo(fire(0) * (1 + TUNING.headbutt.maxSpeedBonus), 6);
  });
  it('cannot headbutt below minimum charge or bypass cooldown', () => {
    const goat = new GoatAbilities(new EventBus());
    run(goat, 2, { chargeHeadbutt: true });
    expect(goat.update(STEP, {}, ground).headbutt).toBeUndefined();
    run(goat, 20, { chargeHeadbutt: true });
    expect(goat.update(STEP, {}, ground).headbutt).toBeDefined();
    expect(goat.update(STEP, { chargeHeadbutt: true }, ground).headbutt).toBeUndefined();
    expect(goat.update(STEP, {}, ground).headbutt).toBeUndefined();
  });
  it('tongue attaches, holds, reels, flings, detaches and respects cooldowns', () => {
    const goat = new GoatAbilities(new EventBus());
    const target = { ...wall, tongueTarget: 'crate-7' };
    expect(goat.update(STEP, { tongue: true }, target).tongue).toEqual({ action: 'attach', targetId: 'crate-7' });
    expect(goat.update(STEP, { tongue: true }, target).tongue).toEqual({ action: 'hold', targetId: 'crate-7' });
    expect(goat.update(STEP, { tongue: true, reelTongue: true }, target).tongue?.action).toBe('reel');
    expect(goat.update(STEP, { tongue: true, flingTongue: true }, target).tongue?.action).toBe('fling');
    expect(goat.tongueTarget).toBeNull();
    expect(goat.update(STEP, { tongue: true }, target).tongue).toBeUndefined();
    run(goat, 65, {}, target);
    expect(goat.update(STEP, { tongue: true }, target).tongue?.action).toBe('attach');
    expect(goat.update(STEP, {}, target).tongue?.action).toBe('detach');
  });
  it('limits bleat to three presses per five seconds despite cooldown clearing', () => {
    const goat = new GoatAbilities(new EventBus()); let bleats = 0;
    for (let n = 0; n < 5; n++) {
      if (goat.update(STEP, { bleat: true }, ground).bleat) bleats++;
      run(goat, 60, {});
    }
    expect(bleats).toBe(3);
    run(goat, 60, {});
    expect(goat.update(STEP, { bleat: true }, ground).bleat).toBeDefined();
  });
  it('knockdown, flop and recovery consume real simulated time', () => {
    const bus = new EventBus(); const goat = new GoatAbilities(bus);
    const causes: string[] = [];
    bus.on('balance:knockdown', e => causes.push(e.reason));
    bus.on('balance:recovered', () => causes.push('recovered'));
    goat.applyImpact(90);
    expect(goat.knockedDown).toBe(true);
    expect(goat.update(STEP, { sprint: true, jump: true }, ground).setSprint).toBe(false);
    run(goat, 65, {});
    expect(goat.knockedDown).toBe(true);
    run(goat, 70, {});
    expect(goat.knockedDown).toBe(false);
    expect(causes).toEqual(['impact', 'recovered']);
    expect(goat.update(STEP, { flop: true }, ground).ragdoll?.cause).toBe('flop');
    expect(goat.update(STEP, { flop: true }, ground).ragdoll).toBeUndefined();
    expect(causes.at(-1)).toBe('flop');
  });
  it('only allows one aerial flip, wall kick and glide after unlock', () => {
    const goat = new GoatAbilities(new EventBus());
    expect(goat.update(STEP, { jump: true }, ground).jump?.kind).toBe('jump');
    goat.update(STEP, {}, wall);
    expect(goat.update(STEP, { jump: true }, { ...wall, touchingSteepWall: false }).jump?.kind).toBe('flip');
    goat.update(STEP, {}, wall);
    expect(goat.update(STEP, { jump: true }, wall).jump).toBeUndefined();
    expect(goat.update(STEP, { glide: true }, wall).setGlide).toBe(false);
    expect(goat.update(STEP, { glide: true }, wall, { glideUnlocked: true }).setGlide).toBe(true);
    goat.update(STEP, {}, ground);
    goat.update(STEP, {}, wall);
    expect(goat.update(STEP, { jump: true, climb: true }, wall).jump?.kind).toBe('wall-kick');
  });

  it('recovers partial balance after a quiet delay without forcing ragdoll', () => {
    const goat = new GoatAbilities(new EventBus());
    goat.applyImpact(30);
    expect(goat.balance).toBe(70);
    expect(goat.knockedDown).toBe(false);
    run(goat, 50, {});
    expect(goat.balance).toBe(70);
    run(goat, 60, {});
    expect(goat.balance).toBeGreaterThan(70);
    run(goat, 300, {});
    expect(goat.balance).toBe(100);
  });
  it('uses a sliding five-second bleat window, not an exploitable calendar boundary', () => {
    const goat = new GoatAbilities(new EventBus());
    const press = () => {
      const response = goat.update(STEP, { bleat: true }, ground);
      goat.update(STEP, {}, ground);
      return Boolean(response.bleat);
    };
    expect(press()).toBe(true); // t = ~0
    run(goat, 60, {}); expect(press()).toBe(true); // t = ~1
    run(goat, 60, {}); expect(press()).toBe(true); // t = ~2
    run(goat, 150, {}); expect(press()).toBe(false); // t = ~4.6
    run(goat, 30, {}); expect(press()).toBe(true); // t >5, oldest exits window
  });
  it('unlocks wall chalk stamina efficiency and aerial horns charge impulse', () => {
    const a = new GoatAbilities(new EventBus());
    const b = new GoatAbilities(new EventBus());
    run(a, 60, { climb: true }, wall);
    for (let i = 0; i < 60; i++) b.update(STEP, { climb: true }, wall, { wallChalkUnlocked: true });
    expect(b.stamina).toBeGreaterThan(a.stamina);
    const plain = new GoatAbilities(new EventBus()); const upgraded = new GoatAbilities(new EventBus());
    run(plain, 45, { chargeHeadbutt: true }, wall);
    for (let i = 0; i < 45; i++) upgraded.update(STEP, { chargeHeadbutt: true }, wall, { aerialHornsUnlocked: true });
    const base = plain.update(STEP, {}, wall).headbutt!.impulse;
    const boosted = upgraded.update(STEP, {}, wall, { aerialHornsUnlocked: true }).headbutt!.impulse;
    expect(boosted).toBeCloseTo(base * TUNING.progression.aerialHornsImpulseFactor, 6);
    expect(upgraded.stamina).toBeLessThan(plain.stamina);
  });
  it('round-trips mid-charge state and rejects NaN snapshots', () => {
    const bus = new EventBus(); const goat = new GoatAbilities(bus);
    run(goat, 32, { chargeHeadbutt: true });
    const restored = GoatAbilities.fromJSON(JSON.parse(JSON.stringify(goat.toJSON())) as unknown, new EventBus());
    expect(restored.toJSON()).toEqual(goat.toJSON());
    expect(restored.update(STEP, {}, ground).headbutt).toEqual(goat.update(STEP, {}, ground).headbutt);
    expect(() => goat.update(NaN, {}, ground)).toThrow();
    expect(() => goat.update(STEP, {}, { ...ground, speed: Infinity })).toThrow();
    expect(() => GoatAbilities.fromJSON({ ...goat.toJSON(), balance: -5 }, bus)).toThrow();
  });
});
