import { Game } from './Game';
import { GameView } from './GameView';

/** Browser entry; Game itself remains usable headlessly without this module. */
export async function bootGame(host: HTMLElement): Promise<{
  game: Game; view: GameView; dispose: () => void;
}> {
  const loading = document.createElement('div');
  loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;' +
    'font:900 clamp(28px,5vw,52px) system-ui;color:#ffd833;' +
    'text-shadow:3px 5px #473585;background:#75b7d4;letter-spacing:2px';
  loading.textContent = 'GIGGA-GOAT · LOADING BILLY ISLE';
  host.appendChild(loading);
  try {
    const game = await Game.create();
    loading.remove();
    try {
      const view = new GameView(host, game);
      return { game, view, dispose: () => { view.dispose(); game.dispose(); } };
    } catch (error) {
      game.dispose();
      throw error;
    }
  } finally {
    loading.remove();
  }
}
