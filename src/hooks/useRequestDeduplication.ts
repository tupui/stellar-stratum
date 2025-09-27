import { useCallback, useRef } from 'react';

/**
 * Hook to prevent duplicate API requests
 * Deduplicates requests based on cache key and maintains pending promises
 */

interface RequestCache {
  [key: string]: Promise<any>;
}

export const useRequestDeduplication = () => {
  const pendingRequests = useRef<RequestCache>({});

  const dedupe = useCallback(<T>(
    key: string,
    requestFn: () => Promise<T>,
    ttl: number = 5000 // Default 5 second deduplication window
  ): Promise<T> => {
    // If request is already pending, return existing promise
    if (pendingRequests.current[key]) {
      return pendingRequests.current[key];
    }

    // Create new request and cache the promise
    const promise = requestFn()
      .finally(() => {
        // Clean up after request completes or TTL expires
        setTimeout(() => {
          delete pendingRequests.current[key];
        }, ttl);
      });

    pendingRequests.current[key] = promise;
    return promise;
  }, []);

  const clearCache = useCallback((key?: string) => {
    if (key) {
      delete pendingRequests.current[key];
    } else {
      pendingRequests.current = {};
    }
  }, []);

  return { dedupe, clearCache };
};