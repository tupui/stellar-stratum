import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Earlier builds registered a caching service worker that could keep serving an old version
// of the app. Remove any that is still installed.
navigator.serviceWorker?.getRegistrations().then((registrations) => {
  registrations.forEach((registration) => registration.unregister());
});

/**
 * Another site must not show the app in a frame: an invisible frame over a decoy page could
 * steer clicks onto Sign or Submit. The host cannot send `frame-ancestors`, so the app refuses
 * to start when framed, except in the Lovable editor preview.
 */
const isFramed = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();
const isEditorPreview = /(^|\.)(lovable\.app|lovableproject\.com|lovable\.dev)$/.test(window.location.hostname);

const root = document.getElementById('root')!;
if (isFramed && !isEditorPreview) {
  const message = document.createElement('p');
  message.style.cssText = 'font-family: sans-serif; padding: 2rem; text-align: center;';
  const link = document.createElement('a');
  link.href = window.location.href;
  link.target = '_top';
  link.rel = 'noopener';
  link.textContent = 'Open Stellar Stratum in its own tab';
  message.append('Stellar Stratum cannot run inside another page. ', link);
  root.replaceChildren(message);
  document.body.classList.add('app-loaded');
} else {
  createRoot(root).render(<App />);
}
