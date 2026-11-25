import { describe, expect, it } from 'vitest';
import type { AmbientResidentState } from '../world';
import { IslandLifeAudio } from './IslandLifeAudio';

function actor(id: string, x = 2): AmbientResidentState {
  return { id, role: 'walker', model: 'male-a', position: { x, y: 0, z: 0 },
    yaw: 0, speed: 1, distanceTravelled: 0, activity: 'walk', phase: 0,
    reactionUntil: -Infinity, height: 1.8, radius: .35 };
}
const listener = { x: 0, y: 0, z: 0 };

describe('living-world spatial Foley (LW-107)', () => {
  it('emits footsteps from travelled distance, never animation/render frame counts or stationary loops', () => {
    const audio = new IslandLifeAudio([]), resident = actor('one');
    expect(audio.sample(0, [resident], listener, true)).toEqual([]);
    resident.distanceTravelled = .4;
    expect(audio.sample(.4, [resident], listener, true)).toEqual([]);
    resident.distanceTravelled = .85;
    const cues = audio.sample(.85, [resident], listener, true);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ sound: 'footstep-resident', position: resident.position });
    expect(cues[0]!.position).not.toBe(resident.position);
    expect(audio.sample(.85, [resident], listener, true)).toEqual([]);
    resident.speed = 0;
    for (const t of [1, 2, 100]) expect(audio.sample(t, [resident], listener, true)).toEqual([]);
    audio.dispose();
  });

  it('consumes inaudible and suppressed strides so returning after culling or pause never replays them', () => {
    const audio = new IslandLifeAudio([]), resident = actor('one', 100);
    audio.sample(0, [resident], listener, true);
    resident.distanceTravelled = 80;
    expect(audio.sample(80, [resident], listener, true)).toEqual([]);
    resident.position.x = 2;
    expect(audio.sample(80.1, [resident], listener, true)).toEqual([]);
    resident.distanceTravelled = 100;
    expect(audio.sample(100, [resident], listener, false)).toEqual([]);
    expect(audio.sample(100.1, [resident], listener, true)).toEqual([]);
    resident.distanceTravelled += 1;
    expect(audio.sample(101, [resident], listener, true)).toHaveLength(1);
    audio.dispose();
  });

  it('plays accepted reaction edges once and caps a busy nearby scene at four cues', () => {
    const audio = new IslandLifeAudio([]);
    const residents = Array.from({ length: 16 }, (_, i) => actor(String(i), 16 - i));
    audio.sample(0, residents, listener, true);
    for (const resident of residents) {
      resident.distanceTravelled = .9;
      resident.activity = 'startle'; resident.reactionUntil = 5;
    }
    const cues = audio.sample(1, residents, listener, true);
    expect(cues).toHaveLength(4);
    expect(cues.filter(cue => cue.sound === 'ambient-resident')).toHaveLength(2);
    expect(cues.every(cue => cue.position!.x <= 2)).toBe(true);
    expect(audio.sample(1.1, residents, listener, true)).toEqual([]);
    // Distant/budget-excluded reactions were observed, not queued for later replay.
    for (const resident of residents) resident.position.x = 1;
    expect(audio.sample(1.2, residents, listener, true)).toEqual([]);
    audio.dispose();
  });

  it('keeps fountain cadence bounded, picks the nearest source, obeys modes and stops after disposal', () => {
    const audio = new IslandLifeAudio([{ x: 20, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]);
    expect(audio.sample(0, [], listener, true)).toEqual([
      { sound: 'ambient-fountain', position: { x: 4, y: 0, z: 0 }, intensity: .3 },
    ]);
    expect(audio.sample(.1, [], listener, true)).toEqual([]);
    expect(audio.sample(.71, [], listener, true)).toEqual([]);
    expect(audio.sample(.72, [], listener, true)).toHaveLength(1);
    expect(audio.sample(100, [], listener, false)).toEqual([]);
    expect(audio.sample(101, [], { x: 100, y: 0, z: 0 }, true)).toEqual([]);
    expect(audio.sample(102, [], listener, true)).toHaveLength(1);
    // Reloading an earlier simulation time begins a fresh ambience cadence.
    expect(audio.sample(0, [], listener, true)).toHaveLength(1);
    audio.dispose(); audio.dispose();
    expect(audio.sample(2, [], listener, true)).toEqual([]);
  });
});
