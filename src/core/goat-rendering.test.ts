import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GoatCharacter, TIERS, TIER_PROFILES, ACTIONS } from '../character';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';

const create = (): Promise<Game> => Game.create({
  seed: 'core-render-characters-test', resolution: 97,
});

function expectApprovedSculpt(character: GoatCharacter): void {
  expect(character).toBeInstanceOf(GoatCharacter);
  expect(character.root.name).toBe('Gigga-Goat | seven-body sculpt');
  expect(character.root.children.map(part => part.name)).toEqual([
    'ragdoll torso', 'ragdoll neck', 'ragdoll head', 'ragdoll front-left',
    'ragdoll front-right', 'ragdoll hind-left', 'ragdoll hind-right',
  ]);
  // These are source-character details, not the old seven ellipsoids/cones.
  for (const feature of [
    'voluminous barrel chest', 'tapered fleece lock', 'heavy tapered spiral horn',
    'horn growth ring', 'gold horizontal-pupil iris', 'GOAT horizontal pupil',
    'dark split hoof', 'wind-swept scarf ribbon', 'yellow scarf fringe',
    'hinged smile and bleating jaw', 'optional hang-glider cosmetic',
  ]) {
    expect(character.root.getObjectByName(feature), feature).toBeDefined();
  }
}

describe('Game scene uses the approved src/character goat, not proxy primitives', () => {
  it('renders the real player sculpt on all four physical tiers, bound to replaced rigid bodies', async () => {
    const game = await create();
    const scene = new THREE.Scene();
    const characters = new GameCharacters(scene, game);
    try {
      expectApprovedSculpt(characters.player);
      const root = characters.player.root;
      expect(scene.children).toEqual([root]);
      // The first game tick can independently spawn dynamic island props.
      // Compare body counts around the render update, not across physics.
      game.step();
      const bodiesAfterPhysics = game.bodyCount;
      characters.update(1 / 60, game.physics.alpha);
      expect(game.bodyCount).toBe(bodiesAfterPhysics);
      const torso = root.getObjectByName('ragdoll torso')!;
      const pose = game.physics.getInterpolatedTransform(game.goat.torso, game.physics.alpha);
      expect(torso.position.y).toBeCloseTo(pose.translation.y, 5);

      for (const tier of TIERS) {
        const size = TIER_PROFILES[tier].physicsScale;
        game.goat.resize(size);
        characters.update(0, game.physics.alpha);
        expect(characters.player.tier).toBe(tier);
        expect(torso.scale.x).toBeCloseTo(size, 6);
        expect(root.getObjectByName('GIGGA violet aura')?.visible).toBe(tier === 'GIGGA');
        expect(scene.children).toEqual([root]); // no proxy added on resize
      }
      // All approved poses can be expressed by the same in-game sculpt; the
      // authoritative rigid-body transforms are never replaced by art poses.
      for (const action of ACTIONS) {
        characters.player.play(action, .2);
        characters.update(.016, game.physics.alpha);
        expect(characters.player.action).toBe(action);
        expect(scene.children).toEqual([root]);
      }
    } finally {
      characters.dispose();
      expect(scene.children).toHaveLength(0);
      game.dispose();
    }
  });

  it('renders every physical party opponent with the same sculpt and frees it on exit', async () => {
    const game = await create();
    const scene = new THREE.Scene();
    const characters = new GameCharacters(scene, game);
    try {
      game.party.start('king-of-the-peak', 3, 'easy', {
        countdownTicks: 0, durationTicks: 90, overtimeTicks: 15,
      });
      characters.update(1 / 60, game.physics.alpha);
      expect(characters.bots.size).toBe(3);
      expect(scene.children).toHaveLength(4);
      for (const [id, bot] of game.party.bots) {
        const art = characters.bots.get(id)!;
        expectApprovedSculpt(art);
        expect(art.physics).toBe(bot.goat);
        expect(art.tier).toBe('KID');
        expect(art.root.parent).toBe(scene);
      }
      game.step();
      characters.update(1 / 60, game.physics.alpha);
      for (const [id, bot] of game.party.bots) {
        const torso = characters.bots.get(id)!.root.getObjectByName('ragdoll torso')!;
        const pose = game.physics.getInterpolatedTransform(bot.goat.torso, game.physics.alpha);
        expect(torso.position.x).toBeCloseTo(pose.translation.x, 5);
      }
      const oldBot = characters.bots.get('bot-1')!;
      game.party.returnToFreeRoam();
      characters.update(1 / 60, game.physics.alpha);
      expect(characters.bots.size).toBe(0);
      expect(oldBot.root.parent).toBeNull();
      expect(oldBot.physics).toBeNull();
      expect(scene.children).toEqual([characters.player.root]);
    } finally {
      characters.dispose();
      game.dispose();
    }
  });

  it('turns accepted bleats and headbutts into sculpted gameplay expressions', async () => {
    const game = await create();
    const characters = new GameCharacters(new THREE.Scene(), game);
    const seen: string[] = [];
    const off = game.onVisualCue(cue => seen.push(cue.goatId + ':' + cue.action));
    try {
      game.step({ bleat: true });
      characters.update(1 / 60, game.physics.alpha);
      expect(seen).toContain('player:bleat');
      expect(characters.player.action).toBe('bleat');
      for (let i = 0; i < 35; i++) game.step({ chargeHeadbutt: true });
      game.step({ chargeHeadbutt: false });
      characters.update(1 / 60, game.physics.alpha);
      expect(seen).toContain('player:headbutt');
      expect(characters.player.action).toBe('headbutt');
    } finally {
      off();
      characters.dispose();
      game.dispose();
    }
  });
});
