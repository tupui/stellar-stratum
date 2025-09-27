/**
 * Enhanced caching system with multiple storage layers
 * Follows the established patterns in the codebase
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  timestamp: number;
}

interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  maxSize: number; // Maximum number of entries
  storage: 'memory' | 'localStorage' | 'both';
}

class EnhancedCache {
  private memoryCache = new Map<string, CacheEntry<any>>();
  private readonly config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      ttl: 5 * 60 * 1000, // 5 minutes default
      maxSize: 1000, // 1000 entries default
      storage: 'both', // Use both memory and localStorage
      ...config,
    };
  }

  /**
   * Set a value in the cache
   */
  set<T>(key: string, value: T, customTtl?: number): void {
    const ttl = customTtl || this.config.ttl;
    const expiresAt = Date.now() + ttl;
    const entry: CacheEntry<T> = {
      value,
      expiresAt,
      timestamp: Date.now(),
    };

    // Set in memory cache
    this.memoryCache.set(key, entry);

    // Set in localStorage if configured
    if (this.config.storage === 'localStorage' || this.config.storage === 'both') {
      try {
        localStorage.setItem(`cache_${key}`, JSON.stringify(entry));
      } catch (error) {
        // Cache operation failed - continue without caching
        if (import.meta.env.DEV) {
          console.warn('Failed to save to localStorage:', error);
        }
      }
    }

    // Cleanup if we exceed max size
    this.cleanup();
  }

  /**
   * Get a value from the cache
   */
  get<T>(key: string): T | null {
    // Try memory cache first
    let entry = this.memoryCache.get(key);
    
    if (!entry && (this.config.storage === 'localStorage' || this.config.storage === 'both')) {
      // Try localStorage
      try {
        const stored = localStorage.getItem(`cache_${key}`);
        if (stored) {
          entry = JSON.parse(stored);
          // Restore to memory cache
          this.memoryCache.set(key, entry);
        }
      } catch (error) {
        // Cache read failed - continue without cached data
        if (import.meta.env.DEV) {
          console.warn('Failed to read from localStorage:', error);
        }
      }
    }

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): void {
    this.memoryCache.delete(key);
    
    if (this.config.storage === 'localStorage' || this.config.storage === 'both') {
      try {
        localStorage.removeItem(`cache_${key}`);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('Failed to delete from localStorage:', error);
        }
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.memoryCache.clear();
    
    if (this.config.storage === 'localStorage' || this.config.storage === 'both') {
      try {
        // Clear all cache entries from localStorage
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith('cache_')) {
            localStorage.removeItem(key);
          }
        });
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('Failed to clear localStorage:', error);
        }
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; memorySize: number; localStorageSize: number } {
    let localStorageSize = 0;
    
    if (this.config.storage === 'localStorage' || this.config.storage === 'both') {
      try {
        const keys = Object.keys(localStorage);
        localStorageSize = keys.filter(key => key.startsWith('cache_')).length;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('Failed to get localStorage stats:', error);
        }
      }
    }

    return {
      size: this.memoryCache.size,
      memorySize: this.memoryCache.size,
      localStorageSize,
    };
  }

  /**
   * Cleanup expired entries and enforce max size
   */
  private cleanup(): void {
    const now = Date.now();
    
    // Remove expired entries
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expiresAt) {
        this.memoryCache.delete(key);
      }
    }

    // Enforce max size (remove oldest entries)
    if (this.memoryCache.size > this.config.maxSize) {
      const entries = Array.from(this.memoryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = entries.slice(0, this.memoryCache.size - this.config.maxSize);
      toRemove.forEach(([key]) => this.memoryCache.delete(key));
    }
  }
}

// Pre-configured cache instances for different use cases
export const caches = {
  // Asset prices cache (5 minutes TTL)
  assetPrices: new EnhancedCache({
    ttl: 5 * 60 * 1000,
    maxSize: 500,
    storage: 'both',
  }),

  // Account data cache (2 minutes TTL)
  accountData: new EnhancedCache({
    ttl: 2 * 60 * 1000,
    maxSize: 100,
    storage: 'both',
  }),

  // Transaction history cache (30 minutes TTL)
  transactionHistory: new EnhancedCache({
    ttl: 30 * 60 * 1000,
    maxSize: 50,
    storage: 'both',
  }),

  // Address book cache (1 hour TTL)
  addressBook: new EnhancedCache({
    ttl: 60 * 60 * 1000,
    maxSize: 200,
    storage: 'both',
  }),

  // Network requests cache (1 minute TTL)
  networkRequests: new EnhancedCache({
    ttl: 60 * 1000,
    maxSize: 1000,
    storage: 'memory',
  }),
};

// Utility functions for common caching patterns
export const cacheUtils = {
  /**
   * Cache a function result with automatic key generation
   */
  memoize<T extends (...args: any[]) => any>(
    fn: T,
    cache: EnhancedCache,
    keyGenerator?: (...args: Parameters<T>) => string
  ): T {
    return ((...args: Parameters<T>) => {
      const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);
      const cached = cache.get<ReturnType<T>>(key);
      
      if (cached !== null) {
        return cached;
      }
      
      const result = fn(...args);
      
      // Handle promises
      if (result instanceof Promise) {
        return result.then(resolved => {
          cache.set(key, resolved);
          return resolved;
        });
      }
      
      cache.set(key, result);
      return result;
    }) as T;
  },

  /**
   * Cache with automatic expiration based on data freshness
   */
  cacheWithFreshness<T>(
    key: string,
    cache: EnhancedCache,
    fetcher: () => Promise<T>,
    freshnessCheck?: (data: T) => boolean
  ): Promise<T> {
    const cached = cache.get<T>(key);
    
    if (cached !== null) {
      // Check freshness if provided
      if (!freshnessCheck || freshnessCheck(cached)) {
        return Promise.resolve(cached);
      }
    }
    
    return fetcher().then(result => {
      cache.set(key, result);
      return result;
    });
  },
};

export { EnhancedCache };
