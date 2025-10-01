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

// Preload critical resources
export const preloadCriticalResources = () => {
  // Preload critical chunks
  const criticalChunks = [
    '/assets/vendor.js',
    '/assets/stellar.js',
    '/assets/ui.js'
  ];

  criticalChunks.forEach(chunk => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = chunk;
    document.head.appendChild(link);
  });

  // Preconnect to external domains
  const domains = [
    'https://horizon.stellar.org',
    'https://horizon-testnet.stellar.org'
  ];

  domains.forEach(domain => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = domain;
    document.head.appendChild(link);
  });
};

// Cache management utilities
export const clearAppCaches = async () => {
  try {
    // Clear all caches
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => caches.delete(cacheName))
    );

    // Clear localStorage caches
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('stellar-cache-') || key.startsWith('enhanced-cache-')) {
        localStorage.removeItem(key);
      }
    });

    // All application caches have been cleared
  } catch (error) {
    console.error('Failed to clear caches:', error);
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