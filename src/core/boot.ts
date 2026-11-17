import { Game, type GameOptions } from './Game';
import { GameView } from './GameView';
import { GameMenu } from './GameMenu';
import { loadSave, DEFAULT_SETTINGS } from './Persistence';

/** Browser entry; Game itself remains usable headlessly without this module. */
export async function bootGame(host: HTMLElement,
  islandOptions: Pick<GameOptions, 'seed' | 'resolution'> = {}): Promise<{
  game: Game; view: GameView; menu: GameMenu; dispose: () => void;
}> {
  const loading = document.createElement('div');
  loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;' +
    'font:900 clamp(28px,5vw,52px) system-ui;color:#ffd833;' +
    'text-shadow:3px 5px #473585;background:#75b7d4;letter-spacing:2px';
  loading.textContent = 'GIGGA-GOAT · LOADING BILLY ISLE';
  host.appendChild(loading);
  try {
    const save = loadSave();
    const game = await Game.create({ ...islandOptions, progress: save?.progress });
    loading.remove();
    try {
      const view = new GameView(host, game);
      try {
        const menu = new GameMenu(host, game, view, save?.settings ?? { ...DEFAULT_SETTINGS });
        return { game, view, menu, dispose: () => { menu.dispose(); view.dispose(); game.dispose(); } };
      } catch (error) {
        view.dispose();
        throw error;
      }
    } catch (error) {
      game.dispose();
      throw error;
    }
  } finally {
    loading.remove();
  }
}
