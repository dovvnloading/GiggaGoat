import { TUNING, type PieceType, type SizeTier } from '../gameplay';
import type { GigObjective, GigStatus, Rating } from '../gigs';

/** The HUD is a projection of the simulation, never a second source of game state. */
export interface HudInput {
  meter: number;
  tier: SizeTier;
  score: number;
  combo: { count: number; points: number; title: string };
  stamina: number;
  headbuttCharge: number;
  inventory: { hay: number; wood: number; scrap: number };
  buildMode: boolean;
  buildPiece: PieceType;
  location: string;
  coins: number;
  ragdoll: boolean;
  boardInRange?: boolean;
  happening?: import('./IslandHappenings').HappeningMessage;
  partyTitle?: string;
  gig?: {
    title: string;
    status: GigStatus;
    objective: GigObjective;
    elapsedTicks: number;
    maxTicks: number;
    goldTicks: number;
    silverTicks: number;
    stackLiftPrompt?: string;
    rating?: Rating;
    payout?: number;
  } | null;
}

export const HUD_PIECES = [
  { type: 'floor', key: '1', label: 'HAY FLOOR' },
  { type: 'wall', key: '2', label: 'FENCE WALL' },
  { type: 'ramp', key: '3', label: 'HAY RAMP' },
  { type: 'launch-pad', key: '4', label: 'LAUNCH PAD' },
] as const satisfies readonly { type: PieceType; key: string; label: string }[];

export interface HudState {
  meter: number;
  tier: SizeTier;
  score: string;
  comboTitle: string;
  comboCount: number;
  comboPoints: string;
  stamina: number;
  staminaLow: boolean;
  headbutt: number;
  mode: string;
  buildMode: boolean;
  slots: Array<{ type: PieceType; key: string; label: string; available: number; selected: boolean }>;
  materials: string;
  location: string;
  coins: string;
  gig: { title: string; task: string; detail: string; active: boolean };
}

export function clampHudPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function hudObjectiveParts(objective: GigObjective): { measure: string; unit: string } {
  switch (objective.kind) {
    case 'deliver': return { measure: objective.done + ' / ' + objective.required, unit: 'BALES' };
    case 'coverage': return { measure: objective.eaten + ' / ' + objective.total, unit: 'PATCHES' };
    case 'checkpoints':
    case 'escort':
    case 'summit': return {
      measure: objective.reached + ' / ' + objective.total, unit: 'CHECKPOINTS',
    };
    case 'displace': return { measure: Math.round(objective.movedMass) + ' / ' +
      Math.round(objective.requiredMass), unit: 'MASS' };
    case 'stack': return { measure: objective.layers + ' / ' + objective.required, unit: 'CRATES' };
    case 'splash': return { measure: objective.drop.toFixed(1) + ' / ' +
      objective.requiredDrop.toFixed(1) + 'm', unit: 'DROP' };
  }
}

export function formatHudObjective(objective: GigObjective): string {
  const { measure, unit } = hudObjectiveParts(objective);
  return measure + ' ' + unit;
}

function runningGigText(run: NonNullable<HudInput['gig']>): Pick<HudState['gig'], 'task' | 'detail'> {
  const { objective } = run;
  const remaining = Math.max(0, Math.ceil((run.maxTicks - run.elapsedTicks) / 60)) + 's LEFT';
  switch (objective.kind) {
    case 'splash':
      return {
        task: objective.launchReached
          ? (objective.requiresFlop ? 'Flop into marked water' : 'Land in marked water')
          : 'Reach the launch marker',
        detail: objective.requiredDrop.toFixed(1) + 'm DROP NEEDED · ' + remaining,
      };
    case 'stack':
      return {
        task: run.stackLiftPrompt ??
          (objective.layers >= objective.required ? 'Keep the stack still' : 'Tow a crate to the pad'),
        detail: objective.layers >= objective.required
          ? 'HOLD ' + Math.ceil((objective.holdTicks - objective.stableTicks) / 60) + 's MORE · ' + remaining
          : formatHudObjective(objective) + ' · ' + remaining,
      };
    case 'summit': {
      const needsFlags = objective.reached < objective.total;
      const minimumClimb = objective.minimumClimb ?? 0;
      const needsClimb = objective.climbed < minimumClimb;
      return {
        task: needsFlags ? 'Reach flag ' + (objective.reached + 1) :
          (needsClimb ? 'Keep climbing' : objective.requiresBleat ? 'Bleat at the beacon' : 'Reach the summit'),
        detail: objective.reached + '/' + objective.total + ' FLAGS · ' +
          (minimumClimb > 0 ? Math.floor(objective.climbed) + '/' + minimumClimb + 'm CLIMB · ' : '') + remaining,
      };
    }
    case 'displace':
      return {
        task: 'Headbutt from board side',
        detail: Math.round(objective.movedMass) + '/' + Math.round(objective.requiredMass) +
          ' kg MOVED · ' + remaining,
      };
    default: {
      const pace = run.elapsedTicks <= run.goldTicks ? 'GOLD PACE*' :
        run.elapsedTicks <= run.silverTicks ? 'SILVER PACE*' : 'BRONZE PACE';
      return { task: objective.label, detail: formatHudObjective(objective) + ' · ' + remaining + ' · ' + pace };
    }
  }
}

const num = (value: number): string => Math.max(0, Math.floor(value)).toLocaleString('en-US');

/** Pixels in a north-up, 280px circular map; world -Z is north. */
export function projectHudMap(point: { x: number; z: number },
  origin: { x: number; z: number }, pixelsPerMetre = 1.05): { x: number; y: number } {
  return { x: 140 + (point.x - origin.x) * pixelsPerMetre,
    y: 140 + (point.z - origin.z) * pixelsPerMetre };
}

export function deriveHudState(input: HudInput): HudState {
  const inventory = input.inventory;
  const slots = HUD_PIECES.map(piece => {
    const cost = TUNING.build.cost[piece.type];
    const affordable = (['hay', 'wood', 'scrap'] as const).filter(m => cost[m] > 0)
      .map(m => Math.floor(Math.max(0, inventory[m]) / cost[m]));
    return {
      ...piece,
      available: Math.max(0, Math.min(...affordable)),
      selected: input.buildPiece === piece.type,
    };
  });
  let gig: HudState['gig'] = {
    title: 'YOUR NEXT GIG',
    task: input.boardInRange ? 'Contracts available here' : 'Find a gig board',
    detail: input.boardInRange ? 'CHOOSE A CHALLENGE' : 'GIGS EARN CUD COINS',
    active: false,
  };
  if (input.partyTitle) {
    gig = { title: input.partyTitle, task: 'Compete for the win!',
      detail: 'PARTY ROUND IN PROGRESS', active: true };
  } else if (input.gig) {
    const run = input.gig;
    if (run.status === 'running') {
      gig = { title: run.title, ...runningGigText(run), active: true };
    } else if (run.status === 'completed') {
      gig = { title: run.title, task: 'GIG COMPLETE!',
        detail: (run.rating ?? 'bronze').toUpperCase() + ' · +' + num(run.payout ?? 0) + ' CUD COINS',
        active: false };
    }
  } else if (!input.boardInRange && !input.buildMode && input.happening) {
    gig = { ...input.happening, active: false };
  }
  const stamina = clampHudPercent(input.stamina);
  return {
    meter: clampHudPercent(input.meter),
    tier: input.tier,
    score: num(input.score),
    comboTitle: input.combo.count > 0 ? (input.combo.title || 'TRICK CHAIN') : '',
    comboCount: Math.max(0, input.combo.count),
    comboPoints: num(input.combo.points),
    stamina,
    staminaLow: stamina < TUNING.stamina.minStart,
    headbutt: clampHudPercent(input.headbuttCharge / TUNING.headbutt.maxCharge * 100),
    mode: input.partyTitle ?? (input.buildMode ? 'HAY-BUILD' : input.ragdoll ? 'FLOP MODE' : 'FREE ROAM'),
    buildMode: input.buildMode,
    slots,
    materials: 'HAY ' + num(inventory.hay) + ' · WOOD ' + num(inventory.wood) +
      ' · SCRAP ' + num(inventory.scrap),
    location: input.location.toUpperCase(),
    coins: num(input.coins),
    gig,
  };
}
