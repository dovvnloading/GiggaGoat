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
  partyTitle?: string;
  gig?: {
    title: string;
    status: GigStatus;
    objective: GigObjective;
    elapsedTicks: number;
    maxTicks: number;
    goldTicks: number;
    silverTicks: number;
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

export function formatHudObjective(objective: GigObjective): string {
  switch (objective.kind) {
    case 'deliver': return objective.done + ' / ' + objective.required + ' BALES';
    case 'coverage': return objective.eaten + ' / ' + objective.total + ' PATCHES';
    case 'checkpoints':
    case 'escort':
    case 'summit': return objective.reached + ' / ' + objective.total + ' CHECKPOINTS';
    case 'displace': return Math.round(objective.movedMass) + ' / ' +
      Math.round(objective.requiredMass) + ' MASS';
    case 'stack': return objective.layers + ' / ' + objective.required + ' CRATES';
    case 'splash': return objective.drop.toFixed(1) + ' / ' +
      objective.requiredDrop.toFixed(1) + 'm DROP';
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
      const seconds = Math.max(0, Math.ceil((run.maxTicks - run.elapsedTicks) / 60));
      const pace = run.elapsedTicks <= run.goldTicks ? 'GOLD PACE*' :
        run.elapsedTicks <= run.silverTicks ? 'SILVER PACE*' : 'BRONZE PACE';
      gig = { title: run.title, task: run.objective.label,
        detail: formatHudObjective(run.objective) + ' · ' + seconds + 's LEFT · ' + pace,
        active: true };
    } else if (run.status === 'completed') {
      gig = { title: run.title, task: 'GIG COMPLETE!',
        detail: (run.rating ?? 'bronze').toUpperCase() + ' · +' + num(run.payout ?? 0) + ' CUD COINS',
        active: false };
    }
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
