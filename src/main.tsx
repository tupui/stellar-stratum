import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerServiceWorker, trackPerformance } from './lib/service-worker';

trackPerformance();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
