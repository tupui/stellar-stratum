import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { registerServiceWorker, preloadCriticalResources, trackPerformance } from './lib/service-worker'

// Initialize performance monitoring
trackPerformance();

// Preload critical resources for better performance
preloadCriticalResources();

// Register service worker for caching and offline support
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
