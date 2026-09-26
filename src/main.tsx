import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Earlier builds registered a caching service worker that could keep serving an old version
// of the app. Remove any that is still installed.
navigator.serviceWorker?.getRegistrations().then((registrations) => {
  registrations.forEach((registration) => registration.unregister());
});

createRoot(document.getElementById("root")!).render(<App />);
