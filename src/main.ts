import { bootGame } from './core/boot';

const host = document.getElementById('app');
if (!host) throw new Error('Missing #app element');
void bootGame(host).catch(error => {
  console.error('Gigga-Goat failed to start', error);
  const notice = document.createElement('div');
  notice.style.cssText = 'padding:32px;color:#fff;background:#35305b;font:700 18px system-ui';
  notice.textContent = 'Billy Isle could not load. Check the developer console and reload to try again.';
  host.replaceChildren(notice);
});
