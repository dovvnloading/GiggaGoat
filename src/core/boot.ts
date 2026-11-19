import { AudioEngine, localAudioSettings } from '../audio';
import { BILLY_ISLE_RECORDINGS } from '../audio/soundtrack-assets';
import { GameAudio } from './GameAudio';
import { Game } from './Game';
import { GameView } from './GameView';
import { GameMenu } from './GameMenu';
import { loadSave, DEFAULT_SETTINGS } from './Persistence';

/** Browser entry; Game itself remains usable headlessly without this module. */
export async function bootGame(host: HTMLElement): Promise<{
  game: Game; view: GameView; menu: GameMenu; audio: AudioEngine; dispose: () => void;
}> {
  const loading = document.createElement('div');
  loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;' +
    'font:900 clamp(28px,5vw,52px) system-ui;color:#ffd833;' +
    'text-shadow:3px 5px #473585;background:#75b7d4;letter-spacing:2px';
  loading.textContent = 'GIGGA-GOAT · LOADING BILLY ISLE';
  host.appendChild(loading);
  try {
    const save = loadSave();
    const game = await Game.create({ progress: save?.progress });
    // Exactly one lazily-unlocked audio engine for the island's lifetime.
    // The game's versioned save owns the three exposed volume controls; on
    // first boot, initialize those controls from the audio lane's own store.
    const audio = new AudioEngine({
      seed: game.island.seed, storage: localAudioSettings(), recordedAssets: BILLY_ISLE_RECORDINGS,
    });
    const gameAudio = new GameAudio(game, audio);
    const settings = save?.settings ?? {
      ...DEFAULT_SETTINGS,
      volume: audio.settings.master,
      musicVolume: audio.settings.music,
      effectsVolume: audio.settings.sfx,
    };
    const onVisibility = (): void => gameAudio.setHidden(document.hidden);
    const unbindUnlock = audio.unlockOnFirstInput(window, onVisibility);
    loading.remove();
    try {
      const view = new GameView(host, game, gameAudio);
      document.addEventListener('visibilitychange', onVisibility);
      onVisibility();
      try {
        const menu = new GameMenu(host, game, view, settings, gameAudio);
        return {
          game, view, menu, audio,
          dispose: () => {
            menu.dispose();
            document.removeEventListener('visibilitychange', onVisibility);
            unbindUnlock();
            view.dispose();
            gameAudio.dispose();
            audio.dispose();
            game.dispose();
          },
        };
      } catch (error) {
        document.removeEventListener('visibilitychange', onVisibility);
        view.dispose();
        throw error;
      }
    } catch (error) {
      unbindUnlock();
      gameAudio.dispose();
      audio.dispose();
      game.dispose();
      throw error;
    }
  } finally {
    loading.remove();
  }
}
