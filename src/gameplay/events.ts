import type { Material, PieceType, SizeTier } from './config';
import type { StyleEvent } from './style';
import type { BuildPiece } from './build';

export interface GameplayEvents {
  'style:input': StyleEvent;
  'style:scored': { trick: string; points: number; comboPoints: number; comboCount: number;
    distinct: number; multiplier: number; title: string; meter: number };
  'combo:ended': { points: number; tricks: number; title: string };
  'size:changed': { from: SizeTier; to: SizeTier; targetScale: number };
  'ability:used': { name: 'headbutt' | 'tongue-attach' | 'tongue-fling' | 'bleat' | 'flop' | 'flip' | 'wall-kick'; power?: number };
  'balance:knockdown': { reason: 'impact' | 'flop' };
  'balance:recovered': { balance: number };
  'traversal': { kind: 'climb'; metres: number };
  'inventory:changed': { material: Material; before: number; after: number };
  'material:harvested': { material: Material; amount: number };
  'build:placed': { piece: BuildPiece };
  'build:edited': { before: BuildPiece; after: BuildPiece };
  'build:removed': { piece: BuildPiece };
  'build:hit': { piece: BuildPiece; damage: number };
  'build:broken': { piece: BuildPiece };
  'build:collapsed': { cause: 'remove' | 'edit' | 'break'; pieces: BuildPiece[] };
  'coins:changed': { before: number; after: number; reason: string };
  'unlock:claimed': { id: string; category: 'ability' | 'gear' };
  'challenge:completed': { id: string; reward: number };
  'challenge:progress': { id: string; value: number; goal: number };
  'build:requested': { type: PieceType }; // optional UI telemetry; no state mutation
}

/** Synchronous, ordered, strongly typed dispatcher. No global singleton. */
export class EventBus {
  private readonly listeners = new Map<keyof GameplayEvents, Set<(payload: never) => void>>();

  on<K extends keyof GameplayEvents>(type: K, fn: (payload: GameplayEvents[K]) => void): () => void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    const erased = fn as (payload: never) => void;
    listeners.add(erased);
    return () => { listeners.delete(erased); };
  }

  emit<K extends keyof GameplayEvents>(type: K, payload: GameplayEvents[K]): void {
    // Copy prevents unsubscribe/subscribe during dispatch from changing this dispatch.
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(payload as never);
  }

  clear(): void { this.listeners.clear(); }
}
