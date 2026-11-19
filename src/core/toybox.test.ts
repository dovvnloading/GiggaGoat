import { afterAll, beforeAll, expect, it } from 'vitest';
import { Game, type PlayerIntent } from './Game';
import { TOYS, type ToyCue } from './Toybox';
import { V } from '../physics';

let game: Game;
const ticks = (n: number, input: PlayerIntent = {}) => {
  for (let i = 0; i < n; i++) game.step(input);
};
const select = (id: typeof TOYS[number]['id']) => {
  game.toys.index = TOYS.findIndex(t => t.id === id);
};
const stand = () => {
  game.respawn();
  ticks(45);
};
beforeAll(async () => { game = await Game.create({seed:'toybox-test', resolution:97}); });
afterAll(() => game.dispose());

it('spends pressure once, boosts the linked goat, and earns pressure by moving', () => {
  stand();
  const start = game.goat.torso.translation().y;
  game.step({useToy:true});
  expect(game.toys.gas).toBe(0);
  ticks(10);
  expect(game.goat.torso.translation().y).toBeGreaterThan(start+.3);
  ticks(150,{moveZ:1});
  expect(game.toys.gas).toBeGreaterThan(0);
});
it('sweeps a glob into a loose target, holds the splat briefly, then physically punts it', () => {
  stand();select('glob');
  const p = game.goat.head.translation();
  const box = game.physics.createBox(V(p.x,p.y,p.z-3),V(.65,.65,.65),100);
  game.step({useToy:true,cameraYaw:0});ticks(10);
  expect(game.toys.glob?.target).toBe(box.handle);
  ticks(35);
  expect(game.toys.glob).toBeNull();
  expect(box.linvel().z).toBeLessThan(-2);
  game.physics.removeBody(box);
});
it('gives the brew directional turbo flight, controlled descent, expiry and a refill delay', () => {
  stand();select('brew');
  const y=game.goat.torso.translation().y;
  game.step({useToy:true});
  ticks(56,{jump:true,moveZ:1,cameraYaw:0});
  expect(game.goat.torso.translation().y).toBeGreaterThan(y+3);
  expect(game.goat.torso.linvel().z).toBeLessThan(-11);
  ticks(45);
  expect(game.goat.torso.linvel().y).toBeLessThan(0);
  ticks(330);game.step({useToy:true});
  expect(game.toys.brew).toBe(0);
});
it('pulls real movable cargo toward the goat and leaves the magnet on cooldown', () => {
  stand();select('sock');
  const p=game.goat.torso.translation();
  const id='baa-ardwalk-art-crate-87', b=game.colliders.bodies.get(id)!;
  b.setTranslation(V(p.x+5,p.y+.5,p.z),true);b.setLinvel(V(),true);
  game.step({useToy:true});ticks(22);
  expect(b.translation().x).toBeLessThan(p.x+4.8);
  expect(game.toys.status()).toContain('PULL');
});
it('fires exactly three pogo hops and plants and recalls the duck', () => {
  stand();select('pogo');
  const cues:ToyCue[]=[];const collect=(e:ToyCue)=>cues.push(e);
  game.toys.listeners.add(collect);
  game.step({useToy:true});ticks(425);
  expect(cues.filter(e=>e.toy==='pogo')).toHaveLength(3);
  game.toys.listeners.delete(collect);
  stand();select('duck');game.step({useToy:true});
  const anchor=game.toys.duck!.position;
  game.teleport(V(anchor.x+7,anchor.y+1,anchor.z),0);
  ticks(35);
  expect(Math.abs(game.goat.torso.translation().x-anchor.x)).toBeGreaterThan(1);
  game.step({useToy:true});
  expect(game.toys.duck).toBeNull();
  expect(game.goat.torso.translation().x).toBeCloseTo(anchor.x,0);
});
