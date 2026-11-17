import { afterEach, describe, expect, it, vi } from 'vitest';
import { forward, rotate, V, RAPIER } from '../physics';
import type { Game } from './Game';
import { bootGame } from './boot';

/**
 * Vite's real bootGame and the real GameMenu need a small DOM in Node.
 * Only WebGL presentation is replaced: Game, GameInput, title-button routing,
 * the fixed-step clock and all seven Rapier bodies are production code.
 */
class ElementStub {
  readonly style = { cssText: '', display: '' };
  readonly dataset: Record<string, string> = {};
  className = '';
  textContent = '';
  innerHTML = '';
  hidden = false;
  readonly children: ElementStub[] = [];
  private readonly listeners = new Map<string, Array<(event: { target: unknown }) => void>>();

  appendChild(child: ElementStub): ElementStub { this.children.push(child); return child; }
  remove(): void { /* detached test DOM node */ }
  setAttribute(_key: string, _value: string): void {}
  focus(): void {}
  addEventListener(type: string, listener: (event: { target: unknown }) => void): void {
    const entries = this.listeners.get(type) ?? [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }
  removeEventListener(type: string, listener: (event: { target: unknown }) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(fn => fn !== listener));
  }
  querySelector(selector: string): ElementStub | null {
    return selector === 'button' && this.innerHTML.includes('<button') ? new ElementStub() : null;
  }
  requestPointerLock(): Promise<void> { return Promise.resolve(); }
  clickAction(action: string): void {
    // Assert the actual title menu rendered this button before dispatching its
    // same delegated click handler (no direct GameMenu.action() shortcut).
    expect(this.innerHTML).toContain('data-action="' + action + '"');
    const target = { closest: (selector: string) =>
      selector === '[data-action]' ? { dataset: { action } } : null };
    for (const listener of this.listeners.get('click') ?? []) listener({ target });
  }
}

vi.mock('./GameView', async () => {
  const { GameInput } = await import('./GameInput');
  const { SPAWN_CAMERA_YAW_OFFSET } = await import('./GoatCamera');
  return {
    GameView: class {
      readonly renderer = { domElement: document.createElement('canvas') };
      readonly input: InstanceType<typeof GameInput>;
      readonly hud = { setVisible(_visible: boolean): void {} };
      paused = false;
      onFrame: (() => void) | null = null;
      onInteract: (() => boolean) | null = null;
      constructor(_host: HTMLElement, game: Game) {
        this.input = new GameInput(this.renderer.domElement,
          -game.island.spawns[0]!.heading + SPAWN_CAMERA_YAW_OFFSET);
      }
      applySettings(_settings: unknown): void {}
      dispose(): void { this.input.dispose(); }
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

describe('production title-screen PLAY boot', () => {
  it('keeps the real KID ragdoll upright for eight seconds after the PLAY click', async () => {
    // Rapier's compat WASM must boot with Node globals *before* installing
    // the minimal browser-shell test doubles for GameMenu and GameInput.
    await RAPIER.init();
    const head = new ElementStub();
    const documentStub = {
      head, pointerLockElement: null,
      createElement: (_tag: string) => new ElementStub(),
      addEventListener: () => {}, removeEventListener: () => {},
      exitPointerLock: () => {},
    };
    const windowStub = { addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', windowStub);
    vi.stubGlobal('navigator', { getGamepads: () => [] });

    const host = new ElementStub();
    // Rapier's full 193-cell terrain traps on the first headless Node tick.
    // Keep bootGame, the title click and real input/physics, with the proven
    // 97-cell physics fixture until the terrain-WASM issue is solved.
    const app = await bootGame(host as unknown as HTMLElement, { resolution: 97 });
    try {
      const { game, menu, view } = app;
      expect(game.island.seed).toBe('billy-isle');
      expect(game.island.resolution).toBe(97);
      expect(game.physics.stepCount).toBe(0);
      expect(view.paused).toBe(true);
      (menu.root as unknown as ElementStub).clickAction('play');
      expect(view.paused).toBe(false);
      expect(menu.root.hidden).toBe(true);

      // The browser shell is no longer needed once PLAY has selected free roam.
      // Keep the real GameInput's gamepad API, but avoid letting fake DOM globals
      // alter Rapier's WASM runtime during the headless physics simulation.
      vi.unstubAllGlobals();
      vi.stubGlobal('navigator', { getGamepads: () => [] });

      const facing = rotate(game.goat.torso.rotation(), V(0, 0, -1));
      const intended = forward(game.goat.locomotion.heading);
      const headingAlignment = facing.x * intended.x + facing.z * intended.z;
      const observations: Array<{ second: number; up: number; torsoY: number;
        headY: number; legY: number; ragdoll: boolean }> = [];

      // Same production path as GameView.frame(): sample the real GameInput
      // and send its intent to Game.advance on each elapsed render frame.
      for (let frame = 1; frame <= 480; frame++) {
        const dt = 1 / 60;
        try {
          game.advance(dt, view.input.sample(dt, game.buildMode));
        } catch (error) {
          throw new Error('Live PLAY game.advance failed at frame ' + frame +
            ' / step ' + game.physics.stepCount, { cause: error });
        }
        if (frame % 60 === 0) {
          const torso = game.goat.torso;
          const q = torso.rotation();
          observations.push({
            second: frame / 60,
            up: 1 - 2 * (q.x ** 2 + q.z ** 2),
            torsoY: torso.translation().y,
            headY: game.goat.head.translation().y,
            legY: game.goat.legs.reduce((sum, leg) => sum + leg.translation().y, 0) / 4,
            ragdoll: game.goat.isRagdoll,
          });
        }
      }
      expect(game.physics.stepCount).toBe(480);
      // The heading used by the balance/locomotion controller must agree with
      // the actual facing of the assembled rigid body from its first frame.
      expect(headingAlignment, JSON.stringify({ headingAlignment, observations })).toBeGreaterThan(.99);
      for (const state of observations.filter(state => state.second >= 2)) {
        expect(state.up, JSON.stringify({ headingAlignment, observations })).toBeGreaterThan(.75);
        expect(state.ragdoll, JSON.stringify(state)).toBe(false);
        expect(state.headY, JSON.stringify(state)).toBeGreaterThan(state.legY);
      }
    } catch (error) {
      // Restore the actual click-handler's fake browser host for cleanup,
      // preserving the primary reproduction error even if disposal also fails.
      vi.stubGlobal('document', documentStub);
      vi.stubGlobal('window', windowStub);
      try { app.dispose(); } catch (cleanup) { console.error('cleanup after failure:', cleanup); }
      throw error;
    }
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', windowStub);
    app.dispose();
  });
});
