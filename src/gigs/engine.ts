import type { PoiId } from '../world';
import { BOARD_CYCLE_TICKS, GIG_INFO, GigCatalog, TICKS_PER_SECOND } from './catalog';
import { HAY_HAUL_TAG_RADIUS } from './types';
import type {
  Difficulty, GigAward, GigBest, GigConfig, GigEvent, GigFrame,
  GigId, GigMetrics, GigObjective, GigOffer, GigRun, GigSetup, GigSnapshot,
  Point, PropFact, Rating,
} from './types';

const COPIES_LIMIT = 256;
const RANK: Record<Rating, number> = { bronze: 1, silver: 2, gold: 3 };
const DIFFICULTY_MULT: Record<Difficulty, number> = { easy: 1, medium: 1.35, hard: 1.7 };
const RATING_MULT: Record<Rating, number> = { bronze: 1, silver: 1.45, gold: 2.05 };
const firstGoldCoins = 100;
const clone = <T>(value: T): T => structuredClone(value);
const planar = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finite = (n: number): boolean => Number.isFinite(n);
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function assertPoint(p: Point, name: string): void {
  if (!p || !finite(p.x) || !finite(p.y) || !finite(p.z)) throw new TypeError('Bad ' + name);
}
function objective(run: GigRun): GigObjective {
  const c = run.setup.config;
  switch (c.kind) {
    case 'hay-haul': return { kind: 'deliver', label: 'Bales at the barn drop',
      done: run.finishedIds.length, required: c.required, destination: clone(c.barn) };
    case 'rooftop-express': return { kind: 'checkpoints', label: 'Roofs crossed with parcel',
      reached: run.checkpointIndex, total: c.checkpoints.length,
      ...(c.checkpoints[run.checkpointIndex] ? { next: clone(c.checkpoints[run.checkpointIndex]!) } : {}) };
    case 'demolition-contract': {
      const requiredMass = c.pieces.reduce((total, p) => total + p.mass, 0) * c.requiredFraction;
      return { kind: 'displace', label: 'Tower mass actually moved',
        movedMass: Math.round(run.metrics.displacedMass * 100) / 100,
        requiredMass: Math.round(requiredMass * 100) / 100, headbutts: run.metrics.headbutts };
    }
    case 'mow-down': return { kind: 'coverage', label: 'Lawn grid eaten',
      eaten: run.finishedIds.length, total: c.patches.length, bites: run.metrics.bites };
    case 'escort-the-gnome': return { kind: 'escort', label: 'Unbroken gnome at flags',
      reached: run.checkpointIndex, total: c.route.length, fragile: true };
    case 'stack-up': return { kind: 'stack', label: 'Stable crate layers',
      layers: run.metrics.maxLayers, required: c.requiredLayers,
      stableTicks: run.stableTicks, holdTicks: c.holdTicks };
    case 'summit-sprint': return { kind: 'summit', label: 'Cliff flags reached',
      reached: run.checkpointIndex, total: c.checkpoints.length, climbed: run.metrics.climbed };
    case 'splash-dive': return { kind: 'splash', label: 'Real drop into water',
      drop: run.metrics.splashDrop, requiredDrop: c.minDrop,
      splashed: run.finishedIds.includes('splash') };
  }
}
function freshRun(setup: GigSetup, attemptId: number): GigRun {
  const run: GigRun = {
    attemptId, setup: clone(setup), status: 'running', elapsedTicks: 0,
    objective: { kind: 'coverage', label: '', eaten: 0, total: 0, bites: 0 },
    metrics: { headbutts: 0, bites: 0, multideliveries: 0, impacts: 0, lostTicks: 0,
      displacedMass: 0, maxLayers: 0, climbed: 0, splashDrop: 0, stylePoints: 0 },
    seenIds: [], finishedIds: [], checkpointIndex: 0, stableTicks: 0,
    streetStarted: false, dropTicks: 0, peakY: setup.start.y,
  };
  run.objective = objective(run);
  return run;
}
function judgedSkill(run: GigRun): { silver: boolean; gold: boolean; bonus: number } {
  const c = run.setup.config, m = run.metrics;
  switch (c.kind) {
    case 'hay-haul':
      return { silver: true, gold: m.multideliveries > 0,
        bonus: Math.min(0.3, m.multideliveries * 0.15) };
    case 'rooftop-express':
      return { silver: m.lostTicks <= 45, gold: m.lostTicks === 0,
        bonus: m.lostTicks === 0 ? 0.12 : 0 };
    case 'demolition-contract':
      return { silver: m.headbutts <= 5, gold: m.headbutts <= 2,
        bonus: Math.max(0, 0.18 - 0.025 * m.headbutts) };
    case 'mow-down':
      return { silver: m.bites <= c.patches.length,
        gold: m.bites <= Math.ceil(c.patches.length / 2),
        bonus: m.bites <= Math.ceil(c.patches.length / 2) ? 0.14 : 0 };
    case 'escort-the-gnome':
      return { silver: m.impacts <= 2, gold: m.impacts === 0,
        bonus: m.impacts === 0 ? 0.17 : 0 };
    case 'stack-up':
      return { silver: m.maxLayers >= c.requiredLayers,
        gold: m.maxLayers > c.requiredLayers,
        bonus: Math.min(0.22, (m.maxLayers - c.requiredLayers) * 0.11) };
    case 'summit-sprint':
      return { silver: m.climbed >= c.minimumClimb,
        gold: m.climbed >= c.minimumClimb * 1.5,
        bonus: m.climbed >= c.minimumClimb * 1.5 ? 0.14 : 0 };
    case 'splash-dive':
      return { silver: m.splashDrop >= c.minDrop,
        gold: m.splashDrop >= c.minDrop + 2.5,
        bonus: Math.min(0.2, Math.max(0, m.splashDrop - c.minDrop) * 0.035) };
  }
}
function grade(run: GigRun): Rating {
  const skill = judgedSkill(run);
  if (run.elapsedTicks <= run.setup.goldTicks && skill.gold) return 'gold';
  if (run.elapsedTicks <= run.setup.silverTicks && skill.silver) return 'silver';
  return 'bronze';
}
function validFact(frame: GigFrame): Map<string, PropFact> {
  if (!frame || !frame.goat || !finite(frame.goat.size) || frame.goat.size <= 0) {
    throw new TypeError('Gig frame needs a physical goat with positive size');
  }
  assertPoint(frame.goat.position, 'goat position');
  const byId = new Map<string, PropFact>();
  for (const prop of frame.props ?? []) {
    if (!prop.id || byId.has(prop.id)) throw new TypeError('Duplicate or empty prop ID');
    assertPoint(prop.position, 'prop position');
    if (prop.velocity) assertPoint(prop.velocity, 'prop velocity');
    if (prop.impact !== undefined && (!finite(prop.impact) || prop.impact < 0)) {
      throw new TypeError('Invalid contact impulse');
    }
    if (prop.tilt !== undefined && !finite(prop.tilt)) throw new TypeError('Invalid prop tilt');
    byId.set(prop.id, prop);
  }
  for (const action of frame.abilities ?? []) {
    if (action.metres !== undefined && (!finite(action.metres) || action.metres < 0)) {
      throw new TypeError('Invalid climb distance');
    }
  }
  for (const style of frame.style ?? []) {
    if (!finite(style.points) || style.points < 0) throw new TypeError('Invalid style points');
  }
  return byId;
}

/**
 * Authoritative, deterministic 60Hz mission machine. It NEVER asks physics to move a prop.
 * The caller owns temporary spawns, world objects and actual collision/contact validation.
 */
export class GigDirector {
  readonly catalog: GigCatalog;
  private now = 0;
  private sequence = 0;
  private attemptCounter = 0;
  private current: GigRun | null = null;
  private bests: GigBest[] = [];
  private goldGigs: GigId[] = [];
  private cosmetics: string[] = [];
  private awards: GigAward[] = [];
  private claimedIds: number[] = [];
  private events: GigEvent[] = [];
  private readonly subscribers = new Set<(event: GigEvent) => void>();

  constructor(catalog: GigCatalog) { this.catalog = catalog; }
  get tick(): number { return this.now; }
  get active(): GigRun | null { return this.current ? clone(this.current) : null; }
  get personalBests(): GigBest[] { return clone(this.bests); }
  get ownedCosmetics(): string[] { return [...this.cosmetics]; }
  get pendingAwards(): GigAward[] { return clone(this.awards); }
  board(poiId: PoiId) { return this.catalog.board(poiId, this.now); }
  onEvent(fn: (event: GigEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }
  drainEvents(): GigEvent[] {
    const entries = clone(this.events);
    this.events.length = 0;
    return entries;
  }
  private emit(event: GigEvent): void {
    const entry = clone(event);
    this.events.push(entry);
    if (this.events.length > COPIES_LIMIT) this.events.shift();
    // Give each subscriber its own copy: listeners cannot corrupt our event history.
    for (const subscriber of [...this.subscribers]) subscriber(clone(entry));
  }
  private sequenceId(): number { return ++this.sequence; }
  /** Only current, actually posted board offers are accepted in production. */
  accept(offerId: string): GigSetup {
    if (this.current?.status === 'running') throw new Error('Abandon or finish the current gig first');
    const offer = Object.values(GIG_INFO)
      .map(info => this.board(info.poiId).offers)
      .flat()
      .find(o => o.id === offerId);
    if (!offer) throw new Error('Offer is expired or not posted on a board');
    return this.begin(offer);
  }
  /** Developer console / deterministic scripted tests; not a network-authority endpoint. */
  startPractice(gigId: GigId, difficulty: Difficulty): GigSetup {
    if (this.current?.status === 'running') throw new Error('Already running a gig');
    const cycle = Math.floor(this.now / BOARD_CYCLE_TICKS);
    return this.begin(this.catalog.makeOffer(gigId, difficulty, cycle, 99));
  }
  private begin(offer: GigOffer): GigSetup {
    const setup = this.catalog.build(offer);
    this.current = freshRun(setup, ++this.attemptCounter);
    this.emit({ type: 'gig.accepted', tick: this.now, seq: this.sequenceId(),
      attemptId: this.attemptCounter, gigId: offer.gigId });
    return clone(setup);
  }
  abandon(): boolean {
    if (!this.current || this.current.status !== 'running') return false;
    this.current.status = 'abandoned';
    this.emit({ type: 'gig.abandoned', tick: this.now, seq: this.sequenceId(),
      attemptId: this.current.attemptId });
    return true;
  }
  private fail(reason: string): void {
    const run = this.current!;
    run.status = 'failed';
    run.failReason = reason;
    this.emit({ type: 'gig.failed', tick: this.now, seq: this.sequenceId(),
      attemptId: run.attemptId, reason });
  }
  private complete(): void {
    const run = this.current!;
    run.status = 'completed';
    const rating = grade(run);
    run.rating = rating;
    const firstGoldBonus = rating === 'gold' && !this.goldGigs.includes(run.setup.offer.gigId)
      ? firstGoldCoins : 0;
    const flair = Math.min(0.2, run.metrics.stylePoints / 400);
    const multiplier = Math.round(100 * DIFFICULTY_MULT[run.setup.offer.difficulty] *
      RATING_MULT[rating] * (1 + flair + judgedSkill(run).bonus)) / 100;
    const baseCoins = run.setup.info.baseCoins;
    const coins = Math.round(baseCoins * multiplier) + firstGoldBonus;
    run.payout = coins;
    const award: GigAward = {
      attemptId: run.attemptId, gigId: run.setup.offer.gigId,
      difficulty: run.setup.offer.difficulty, rating,
      coins, baseCoins, multiplier, firstGoldBonus,
    };
    if (run.setup.config.kind === 'summit-sprint') award.challengeMetres = run.metrics.climbed;
    if (firstGoldBonus) {
      this.goldGigs.push(award.gigId);
      const cosmetic = run.setup.info.cosmetic.id;
      if (!this.cosmetics.includes(cosmetic)) {
        this.cosmetics.push(cosmetic);
        award.cosmeticId = cosmetic;
      }
    }
    const score = RANK[rating] * 100000 + (run.setup.maxTicks - run.elapsedTicks);
    const previous = this.bests.find(b => b.gigId === award.gigId && b.difficulty === award.difficulty);
    if (!previous || previous.score < score) {
      const next: GigBest = { gigId: award.gigId, difficulty: award.difficulty,
        rating, ticks: run.elapsedTicks, score };
      this.bests = this.bests.filter(b => b !== previous);
      this.bests.push(next);
    }
    this.awards.push(clone(award));
    this.emit({ type: 'gig.completed', tick: this.now, seq: this.sequenceId(),
      attemptId: run.attemptId, award });
    if (award.cosmeticId) this.emit({ type: 'cosmetic.unlocked', tick: this.now,
      seq: this.sequenceId(), cosmeticId: award.cosmeticId });
  }
  /**
   * Call once AFTER each completed physics fixed tick, passing only that tick's
   * observations. Never pass rendering delta-time or duplicate a completed tick.
   */
  step(frame: GigFrame): GigEvent[] {
    const props = validFact(frame);
    const emittedFrom = this.sequence;
    const oldCycle = Math.floor(this.now / BOARD_CYCLE_TICKS);
    this.now++;
    const nextCycle = Math.floor(this.now / BOARD_CYCLE_TICKS);
    if (oldCycle !== nextCycle) {
      for (const poiId of new Set(Object.values(GIG_INFO).map(info => info.poiId))) {
        this.emit({ type: 'board.rotated', tick: this.now, seq: this.sequenceId(),
          poiId, cycle: nextCycle });
      }
    }
    const run = this.current;
    if (!run || run.status !== 'running') {
      return this.events.filter(e => e.seq > emittedFrom).map(clone);
    }
    run.elapsedTicks++;
    const prior = JSON.stringify(run.objective);
    run.metrics.stylePoints += (frame.style ?? []).reduce((n, s) => n + s.points, 0);
    const actions = frame.abilities ?? [];
    const c = run.setup.config;
    let done = false;
    switch (c.kind) {
      case 'hay-haul': {
        for (const action of actions) {
          if (action.type !== 'tongue') continue;
          for (const id of [action.targetId, ...(action.targetIds ?? [])]) {
            if (!id || run.seenIds.includes(id) || !c.bales.some(b => b.id === id)) continue;
            const p = props.get(id);
            if (p && planar(p.position, frame.goat.position) <= HAY_HAUL_TAG_RADIUS * frame.goat.size) {
              run.seenIds.push(id);
            }
          }
        }
        const delivered: string[] = [];
        for (const bale of c.bales) {
          const p = props.get(bale.id);
          if (!p || p.broken || !run.seenIds.includes(bale.id) ||
            run.finishedIds.includes(bale.id)) continue;
          if (planar(p.position, c.barn) <= c.radius &&
            Math.abs(p.position.y - c.barn.y) <= 2.5 &&
            planar(p.position, bale.start) >= 4) {
            run.finishedIds.push(bale.id);
            delivered.push(bale.id);
          }
        }
        if (delivered.length >= 2 &&
          delivered.every(id => props.get(id)?.heldByTongue === true)) {
          run.metrics.multideliveries++;
        }
        done = run.finishedIds.length >= c.required;
        break;
      }
      case 'rooftop-express': {
        const parcel = props.get(c.parcelId);
        if (parcel?.broken) { this.fail('The parcel got squashed'); break; }
        if (actions.some(a => a.type === 'tongue' && a.targetId === c.parcelId &&
          parcel && dist(parcel.position, frame.goat.position) < 5 * frame.goat.size)) {
          if (!run.seenIds.includes(c.parcelId)) run.seenIds.push(c.parcelId);
        }
        const carrying = !!parcel && run.seenIds.includes(c.parcelId) &&
          (parcel.carried === true || parcel.heldByTongue === true) &&
          dist(parcel.position, frame.goat.position) <= 5 * frame.goat.size;
        if (frame.goat.onStreet === true || frame.goat.position.y < c.streetY + 1.3 ||
          (run.streetStarted && parcel && parcel.position.y < c.streetY + 0.5)) {
          this.fail('Street contact: rooftop-only delivery'); break;
        }
        if (run.streetStarted && !carrying) {
          run.dropTicks++;
          run.metrics.lostTicks++;
          if (run.dropTicks > 60) { this.fail('Parcel lost for over a second'); break; }
        } else run.dropTicks = 0;
        const checkpoint = c.checkpoints[run.checkpointIndex];
        if (checkpoint && carrying && planar(frame.goat.position, checkpoint) <= 3.8 &&
          frame.goat.position.y >= checkpoint.y - 1.2 &&
          Math.abs(parcel!.position.y - checkpoint.y) <= 2.5) {
          run.checkpointIndex++;
          run.streetStarted = true;
        }
        done = run.checkpointIndex === c.checkpoints.length;
        break;
      }
      case 'demolition-contract': {
        run.metrics.headbutts += actions.filter(a => a.type === 'headbutt').length;
        let mass = 0;
        for (const piece of c.pieces) {
          const p = props.get(piece.id);
          if (!p) continue;
          const displacement = dist(p.position, piece.start);
          // Count maximum displaced mass this attempt, not distance travelled each frame.
          mass += piece.mass * Math.min(1, Math.max(0, displacement - 0.7) / 3.3);
        }
        run.metrics.displacedMass = Math.max(run.metrics.displacedMass, mass);
        const total = c.pieces.reduce((sum, p) => sum + p.mass, 0);
        done = run.metrics.headbutts >= 1 && run.metrics.displacedMass >= total * c.requiredFraction;
        break;
      }
      case 'mow-down': {
        for (const action of actions) {
          if (action.type !== 'eat') continue;
          run.metrics.bites++;
          for (let i = 0; i < c.patches.length; i++) {
            const patch = c.patches[i]!;
            const id = String(i);
            if (!run.finishedIds.includes(id) &&
              planar(frame.goat.position, patch) <= c.biteRadius * frame.goat.size) {
              run.finishedIds.push(id);
            }
          }
        }
        done = run.finishedIds.length === c.patches.length;
        break;
      }
      case 'escort-the-gnome': {
        const gnome = props.get(c.gnomeId);
        if (gnome?.broken || (gnome?.impact ?? 0) >= c.breakImpulse) {
          this.fail('Gnome cracked: use gentle nudges'); break;
        }
        if (gnome && gnome.impact && gnome.impact > c.breakImpulse / 3) {
          run.metrics.impacts++;
        }
        const next = c.route[run.checkpointIndex];
        if (next && gnome && planar(gnome.position, next) <= 2.3 &&
          Math.abs(gnome.position.y - next.y) <= 3.5 &&
          dist(frame.goat.position, gnome.position) <= 16) {
          run.checkpointIndex++;
        }
        done = run.checkpointIndex === c.route.length;
        break;
      }
      case 'stack-up': {
        const eligible = c.crateIds.map(id => props.get(id)).filter((p): p is PropFact =>
          !!p && !p.broken && planar(p.position, c.center) <= 1.45 &&
          (p.tilt ?? 0) <= 0.22 &&
          Math.hypot(p.velocity?.x ?? 0, p.velocity?.y ?? 0, p.velocity?.z ?? 0) <= 0.38);
        let layers = 0;
        const used = new Set<string>();
        for (let i = 0; i < c.crateIds.length; i++) {
          const expected = c.groundY + c.crateHeight * (i + 0.5);
          const found = eligible.find(p => !used.has(p.id) && Math.abs(p.position.y - expected) <= 0.33);
          if (!found) break;
          used.add(found.id);
          layers++;
        }
        run.metrics.maxLayers = layers;
        run.stableTicks = layers >= c.requiredLayers ? run.stableTicks + 1 : 0;
        done = run.stableTicks >= c.holdTicks;
        break;
      }
      case 'summit-sprint': {
        for (const action of actions) {
          if (action.type === 'climb' && action.metres) {
            // An observation may cover only one 1/60s tick. Cap implausible input.
            run.metrics.climbed = Math.round((run.metrics.climbed +
              Math.min(0.4, action.metres)) * 1000) / 1000;
          }
        }
        const next = c.checkpoints[run.checkpointIndex];
        if (next && planar(frame.goat.position, next) <= 6 &&
          frame.goat.position.y >= next.y - 0.7) run.checkpointIndex++;
        if (c.requiresBleat && actions.some(a => a.type === 'bleat') &&
          planar(frame.goat.position, c.checkpoints[c.checkpoints.length - 1]!) <= 6 &&
          frame.goat.position.y >= c.checkpoints[c.checkpoints.length - 1]!.y - 0.7 &&
          !run.seenIds.includes('beacon-bleated')) run.seenIds.push('beacon-bleated');
        done = run.checkpointIndex === c.checkpoints.length &&
          run.metrics.climbed >= c.minimumClimb &&
          (!c.requiresBleat || run.seenIds.includes('beacon-bleated'));
        break;
      }
      case 'splash-dive': {
        if (!run.streetStarted &&
          planar(frame.goat.position, c.jumpPoint) <= 3.5 &&
          Math.abs(frame.goat.position.y - c.jumpPoint.y) <= 2.5) run.streetStarted = true;
        if (run.streetStarted) {
          if (c.requiresFlop && actions.some(a => a.type === 'flop') &&
            !run.seenIds.includes('flopped')) run.seenIds.push('flopped');
          run.peakY = Math.max(run.peakY, frame.goat.position.y);
          run.metrics.splashDrop = Math.max(0,
            Math.round((run.peakY - c.waterY) * 100) / 100);
          if (run.metrics.splashDrop >= c.minDrop &&
            Math.abs(frame.goat.position.y - c.waterY) <= 2 &&
            planar(frame.goat.position, c.landing) <= 3.6 &&
            (frame.style ?? []).some(e => e.type === 'big-splash' && e.points > 0) &&
            (!c.requiresFlop || run.seenIds.includes('flopped'))) {
            run.finishedIds.push('splash');
            done = true;
          }
        }
        break;
      }
    }
    if (run.status === 'running') {
      run.objective = objective(run);
      if (prior !== JSON.stringify(run.objective)) {
        this.emit({ type: 'objective.progress', tick: this.now, seq: this.sequenceId(),
          attemptId: run.attemptId, objective: clone(run.objective) });
      }
      if (done) this.complete();
      else if (run.elapsedTicks >= run.setup.maxTicks) this.fail('Time up');
    }
    return this.events.filter(e => e.seq > emittedFrom).map(clone);
  }
  /**
   * ACK a payout only AFTER calling the wallet's public credit method.
   * Save the director and wallet together; their snapshots form one transaction.
   */
  acknowledgeAward(attemptId: number): boolean {
    const index = this.awards.findIndex(a => a.attemptId === attemptId);
    if (index < 0) return false;
    this.awards.splice(index, 1);
    if (!this.claimedIds.includes(attemptId)) this.claimedIds.push(attemptId);
    return true;
  }
  toJSON(): GigSnapshot {
    return clone({
      version: 1, seed: this.catalog.seed, tick: this.now, sequence: this.sequence,
      attemptCounter: this.attemptCounter, run: this.current, bests: this.bests,
      goldGigs: this.goldGigs, cosmetics: this.cosmetics,
      awards: this.awards, claimedIds: this.claimedIds, events: this.events,
    });
  }
  static fromJSON(raw: unknown, catalog: GigCatalog): GigDirector {
    if (!raw || typeof raw !== 'object') throw new TypeError('Invalid gig snapshot');
    const s = raw as Partial<GigSnapshot>;
    if (s.version !== 1 || s.seed !== catalog.seed || !isInt(s.tick) ||
      !isInt(s.sequence) || !isInt(s.attemptCounter) ||
      !Array.isArray(s.bests) || !Array.isArray(s.goldGigs) ||
      !Array.isArray(s.cosmetics) || !Array.isArray(s.awards) ||
      !Array.isArray(s.claimedIds) || !Array.isArray(s.events)) {
      throw new RangeError('Malformed or incompatible gig snapshot');
    }
    let restoredRun: GigRun | null = null;
    if (s.run) {
      const run = s.run;
      const expected = catalog.restoreSetup(run.setup);
      if (!expected ||
        !isInt(run.attemptId) || run.attemptId > s.attemptCounter ||
        !isInt(run.elapsedTicks) || run.elapsedTicks > expected.maxTicks ||
        !['running', 'completed', 'failed', 'abandoned'].includes(run.status) ||
        !Array.isArray(run.seenIds) || !Array.isArray(run.finishedIds) ||
        !isInt(run.checkpointIndex) || !isInt(run.stableTicks) ||
        !finite(run.peakY) || !isInt(run.dropTicks) ||
        !run.metrics || Object.values(run.metrics).some(n => !finite(n) || n < 0)) {
        throw new RangeError('Malformed active gig snapshot');
      }
      const relocatedRooftop = expected !== run.setup && expected.config.kind === 'rooftop-express';
      restoredRun = relocatedRooftop && run.status === 'running'
        ? freshRun(expected, run.attemptId) : clone(run);
      if (expected !== run.setup && !relocatedRooftop) {
        restoredRun.setup = expected;
        restoredRun.objective = objective(restoredRun);
      }
    }
    if (s.events.length > COPIES_LIMIT ||
      s.events.some(e => !isInt(e.seq) || e.seq > s.sequence!)) {
      throw new RangeError('Invalid pending events');
    }
    const result = new GigDirector(catalog);
    result.now = s.tick;
    result.sequence = s.sequence;
    result.attemptCounter = s.attemptCounter;
    result.current = restoredRun;
    result.bests = clone(s.bests);
    result.goldGigs = clone(s.goldGigs);
    result.cosmetics = clone(s.cosmetics);
    result.awards = clone(s.awards);
    result.claimedIds = clone(s.claimedIds);
    result.events = clone(s.events);
    return result;
  }
}
export { TICKS_PER_SECOND };
