/**
 * Service Worker setup for enhanced caching and performance
 * This provides offline support and intelligent asset caching
 */

export const registerServiceWorker = () => {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', async () => {
      try {
        // Register the service worker
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });

        // Service worker registered successfully

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New content is available, notify user
                if (window.confirm('A new version is available. Refresh to update?')) {
                  window.location.reload();
                }
              }
            });
          }
        });

        // Listen for messages from service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
          // Handle cache update events
          if (event.data.type === 'CACHE_UPDATED') {
            // Cache was updated for the specified URL
          }
        });

      } catch (error) {
        // Service worker registration failed - application will continue without SW
      }
    });
  }
};


// Performance monitoring
export const trackPerformance = () => {
  if ('performance' in window) {
    // Track page load performance
    window.addEventListener('load', () => {
      setTimeout(() => {
        const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        
        const metrics = {
          'Time to First Byte': perfData.responseStart - perfData.requestStart,
          'DOM Content Loaded': perfData.domContentLoadedEventEnd - perfData.fetchStart,
          'Load Complete': perfData.loadEventEnd - perfData.fetchStart,
          'First Contentful Paint': performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0
        };

        if (import.meta.env.DEV) {
          console.table(metrics);
        }
      }, 0);
    });

    // Track resource loading performance - disabled to keep console clean
    // const observer = new PerformanceObserver((list) => {
    //   for (const entry of list.getEntries()) {
    //     if (entry.duration > 1000 && import.meta.env.DEV) {
    //       console.warn(`Slow resource: ${entry.name} took ${entry.duration}ms`);
    //     }
    //   }
    // });

    // observer.observe({ entryTypes: ['resource'] });
  }
};