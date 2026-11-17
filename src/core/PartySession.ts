import { GameSimulation } from '../gameplay';
import { GoatRagdoll, V, forward, type PhysicsContact, type Vec3 } from '../physics';
import { heightAt, landAreaAtTideLevel } from '../world';
import {
  PartyMatch, BotBrain, arenaFromBillyIsle,
  type Difficulty, type GoatContact, type GoatObservation, type MatchEvent,
  type ModeId, type ModeInputIntent, type RulesConfig,
} from '../modes';
import type { Game, PlayerIntent } from './Game';

export interface PartyBot {
  goat: GoatRagdoll;
  brain: BotBrain;
  rules: GameSimulation;
  name: string;
}
const NAMES = ['Noodle', 'Sprocket', 'Nova', 'Pickles', 'Orbit', 'Bandit', 'Waffle'];
const TITLES: Record<ModeId, string> = {
  'rising-tide': 'RISING TIDE', 'king-of-the-peak': 'KING OF THE PEAK', 'hay-heist': 'HAY HEIST',
};

/** Match brain + fixed-tick host for actual physical, jointed opponent goats. */
export class PartySession {
  match: PartyMatch | null = null;
  readonly bots = new Map<string, PartyBot>();
  latestEvents: MatchEvent[] = [];
  private readonly game: Game;
  private readonly contacts: GoatContact[] = [];
  private readonly intents: Record<string, ModeInputIntent> = {};
  private readonly chargeTicks = new Map<string, number>();
  private readonly onContactOff: () => void;
  private returnPosition: Vec3 | null = null;
  private finished = false;

  constructor(game: Game) {
    this.game = game;
    this.onContactOff = game.physics.onContact(contact => this.onContact(contact));
  }
  get title(): string { return this.match ? TITLES[this.match.mode] : 'FREE ROAM'; }
  get isFinished(): boolean { return this.finished; }

  start(mode: ModeId, count: number, difficulty: Difficulty,
    config?: Partial<RulesConfig>): PartyMatch {
    if (this.match) throw new Error('Return to free roam before starting another round');
    if (!Number.isInteger(count) || count < 3 || count > 7) throw new RangeError('Choose 3–7 bots');
    if (!['easy', 'normal', 'hard'].includes(difficulty)) throw new RangeError('Invalid bot difficulty');
    this.game.gigs.abandon();
    const before = this.game.goat.torso.translation();
    // Game.teleport accepts foot-ground coordinates, not the torso centre.
    this.returnPosition = { x: before.x,
      y: before.y - .92 * this.game.goat.size, z: before.z };
    const arena = arenaFromBillyIsle(this.game.island, { heightAt, landAreaAtTideLevel });
    const match = new PartyMatch({ mode, seed: 217, config }, arena);
    match.join({ id: 'player', name: 'YOU', teamId: mode === 'hay-heist' ? 'red' : undefined });
    const center = mode === 'king-of-the-peak' ? arena.summit :
      mode === 'hay-heist' ? arena.barns[0]!.position :
        this.game.island.pois.find(p => p.id === 'hoofington')!.center;
    const land = (x: number, z: number): Vec3 => ({
      x, y: heightAt(this.game.island, x, z) + 1.25, z,
    });
    this.game.teleport(land(center.x - 4, center.z + 4));
    for (let i = 0; i < count; i++) {
      const id = 'bot-' + (i + 1);
      const teamId = mode === 'hay-heist' ? (i % 2 === 0 ? 'blue' : 'red') : undefined;
      const base = mode === 'hay-heist' ?
        arena.barns.find(b => b.teamId === teamId)!.position : center;
      const angle = i * 2.39996;
      const position = land(base.x + Math.cos(angle) * (6 + i % 3 * 2),
        base.z + Math.sin(angle) * (6 + i % 3 * 2));
      const goat = new GoatRagdoll(this.game.physics, {
        id, position, yaw: angle, size: .6,
      });
      this.game.water.track(goat.torso, { buoyancyScale: .7, paddleSpeed: 2.6 });
      this.bots.set(id, { goat, brain: new BotBrain(id, difficulty, 217 + i),
        rules: new GameSimulation(530 + i), name: NAMES[i]! });
      match.join({ id, name: NAMES[i]!, teamId, bot: true });
    }
    for (const player of match.players) match.setReady(player.id, true);
    match.start();
    this.match = match;
    this.game.water.setSeaLevel(match.tideLevel);
    this.latestEvents = [];
    this.contacts.length = 0;
    this.finished = false;
    return match;
  }

  private observe(): GoatObservation[] {
    if (!this.match) return [];
    const all = [this.game.goat, ...[...this.bots.values()].map(bot => bot.goat)];
    return all.map(goat => {
      const p = goat.torso.translation();
      const f = forward(goat.locomotion.heading);
      return { id: goat.id, position: { ...p }, headY: goat.head.translation().y,
        facing: { x: f.x, z: f.z } };
    });
  }

  /** Brain world-X/Z intents take exactly the same gameplay/locomotion route as human inputs. */
  beforeTick(human: PlayerIntent): void {
    const match = this.match;
    if (!match || match.phase === 'results') return;
    const view = match.view();
    const observations = this.observe();
    this.intents.player = { ...human };
    for (const [id, bot] of this.bots) {
      const raw = bot.brain.decide(view, observations);
      this.intents[id] = raw;
      const effects = match.getEffects(id);
      const prior = this.chargeTicks.get(id) ?? 0;
      const charging = raw.chargeHeadbutt ? 14 : Math.max(0, prior - 1);
      this.chargeTicks.set(id, charging);
      // Brain outputs Cartesian world axes. A yaw-zero human intent converts
      // world z to negative camera-forward z, preserving one movement path.
      const playerIntent: PlayerIntent = {
        moveX: (raw.moveX ?? 0) * effects.speedMultiplier,
        moveZ: -(raw.moveZ ?? 0) * effects.speedMultiplier,
        cameraYaw: 0, sprint: !!raw.sprint && effects.canSprint,
        jump: raw.jump, tongue: raw.tongue,
        chargeHeadbutt: charging > 0,
        bleat: raw.bleat, flop: raw.flop,
      };
      this.game.driveGoat(bot.goat, playerIntent, bot.rules, false);
    }
  }

  /** Every mode tick consumes the actual post-Rapier ragdoll/head poses. */
  afterTick(): void {
    const match = this.match;
    if (!match || match.phase === 'results') return;
    this.latestEvents = match.step({
      goats: this.observe(), intents: { ...this.intents }, contacts: this.contacts,
    });
    this.contacts.length = 0;
    if (match.toJSON().phase === 'results') this.finished = true;
  }

  private onContact(event: PhysicsContact): void {
    if (!this.match || event.type !== 'impact' || event.impulse < 2) return;
    // PhysicsWorld already indexes each goat body by owner; avoid scanning
    // 8 ragdolls × 7 body parts for every contact-force callback.
    const aId = event.bodyA === null ? undefined : this.game.physics.bodyData(event.bodyA)?.owner;
    const bId = event.bodyB === null ? undefined : this.game.physics.bodyData(event.bodyB)?.owner;
    if (!aId || !bId || aId === bId) return;
    const a = aId === 'player' ? this.game.goat : this.bots.get(aId)?.goat;
    const b = bId === 'player' ? this.game.goat : this.bots.get(bId)?.goat;
    if (!a || !b) return;
    const aVel = a.torso.linvel(), bVel = b.torso.linvel();
    const av = Math.hypot(aVel.x, aVel.z), bv = Math.hypot(bVel.x, bVel.z);
    const attacker = av >= bv ? a : b, victim = attacker === a ? b : a;
    if (!this.contacts.some(c => c.attackerId === attacker.id && c.victimId === victim.id)) {
      this.contacts.push({ attackerId: attacker.id, victimId: victim.id });
    }
  }

  returnToFreeRoam(): void {
    if (!this.match) return;
    // Release any player tether aimed at a soon-to-disappear bot. Ragdoll
    // dispose owns its joints, colliders and body removal on the safe host path.
    this.game.goat.interactions.detachTongue('replaced');
    for (const bot of this.bots.values()) {
      this.game.water.untrack(bot.goat.torso);
      bot.goat.dispose();
    }
    this.bots.clear();
    this.chargeTicks.clear();
    this.contacts.length = 0;
    this.latestEvents = [];
    this.match = null;
    this.finished = false;
    this.game.water.setSeaLevel(this.game.island.seaLevel);
    if (this.returnPosition) this.game.teleport(this.returnPosition);
    this.returnPosition = null;
  }

  dispose(): void { this.returnToFreeRoam(); this.onContactOff(); }
}
