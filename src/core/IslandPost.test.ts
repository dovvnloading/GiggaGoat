import { describe, expect, it } from 'vitest';
import { IslandPost, DISPATCHES } from './IslandPost';
import { HAPPENING_DEFINITIONS, type HappeningSite } from './IslandHappenings';

const sites: HappeningSite[] = HAPPENING_DEFINITIONS.map((definition, i) => ({
  definition, scale: 1, yaw: 0, position: { x: 20 * i, y: 1, z: 0 },
}));

describe('Island Post', () => {
  it('carries each dispatch between its actual stops and stamps it once', () => {
    let post = new IslandPost(sites);
    for (const route of DISPATCHES) {
      expect(post.start(route.id)).toBe(true);
      expect(post.perform(route.to, 1)).toBe(0);
      expect(post.carrying).toBe(false);
      expect(post.perform(route.from, 2)).toBe(0);
      expect(post.carrying).toBe(true);
      post = new IslandPost(sites, JSON.parse(JSON.stringify(post.snapshot())));
      expect(post.target?.definition.id).toBe(route.to);
      expect(post.perform(route.from, 3)).toBe(0);
      expect(post.perform(route.to, 4)).toBe(40);
      expect(post.perform(route.to, 5)).toBe(0);
      expect(post.start(route.id)).toBe(false);
      expect(post.message(sites[0]!.position, 6)?.task).toBe('Postcard stamped');
    }
    expect(new IslandPost(sites, post.snapshot()).stamped.size).toBe(8);
  });

  it('keeps an accepted letter when another is selected and discards its cargo when returned', () => {
    const post = new IslandPost(sites);
    post.start('parade');
    expect(post.start('shift')).toBe(false);
    expect(post.perform('busker-break', 0)).toBe(0);
    expect(post.target?.definition.id).toBe('needle-drop');
    post.perform('needle-drop', 1);
    post.cancel();
    expect(post.snapshot()).toEqual({ stamped: [] });
    expect(post.start('parade')).toBe(true);
    expect(post.target?.definition.id).toBe('needle-drop');
  });

  it('omits unavailable routes and repairs obsolete or already delivered saved cargo', () => {
    const partial = sites.filter(site => site.definition.id !== 'honey-rolls');
    const post = new IslandPost(partial, {route:'breakfast',carrying:true,stamped:['old','shift','shift']});
    expect(post.start('breakfast')).toBe(false);
    expect(post.snapshot()).toEqual({stamped:['shift']});
    expect(new IslandPost(sites,{route:'shift',carrying:true,stamped:['shift']}).active).toBeUndefined();
  });
});
