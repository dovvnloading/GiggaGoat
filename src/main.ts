import { bootGame } from './core/boot';
import { WebGLUnavailableError } from './core/game-renderer';

// Supply a real document icon before Chrome's default /favicon.ico lookup.
// A self-contained SVG also works at the GitHub Pages subpath, without an asset request.
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="14" fill="#7a4cff"/>' +
  '<path d="M17 24L12 7 27 21M37 21 52 7 47 24" stroke="#ffd76d" stroke-width="7" fill="none" stroke-linejoin="round"/>' +
  '<ellipse cx="32" cy="35" rx="18" ry="20" fill="#fff0cc"/>' +
  '<circle cx="25" cy="32" r="3" fill="#473585"/>' +
  '<circle cx="39" cy="32" r="3" fill="#473585"/>' +
  '<ellipse cx="32" cy="43" rx="6" ry="4" fill="#d69a83"/>' +
  '</svg>');
document.head.appendChild(favicon);

const host = document.getElementById('app');
if (!host) throw new Error('Missing #app element');
void bootGame(host).catch(error => {
  console.error('Gigga-Goat failed to start', error);
  const notice = document.createElement('section');
  notice.className = 'game-start-error';
  notice.setAttribute('aria-labelledby', 'game-start-error-title');
  const title = document.createElement('h1');
  title.id = 'game-start-error-title';
  title.textContent = 'Billy Isle couldn’t start';
  const detail = document.createElement('p');
  detail.setAttribute('role', 'alert');
  detail.textContent = error instanceof WebGLUnavailableError
    ? 'This browser could not start WebGL 2, which Gigga-Goat uses to draw the game.'
    : 'The game hit an error during startup.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry loading';
  retry.addEventListener('click', () => window.location.reload());
  notice.append(title, detail, retry);
  host.replaceChildren(notice);
});
