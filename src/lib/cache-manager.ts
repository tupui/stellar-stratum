// Centralized cache management for pricing data
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export class CacheManager<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private defaultTTL: number;

  constructor(defaultTTL: number = 5 * 60 * 1000) { // 5 minutes default
    this.defaultTTL = defaultTTL;
  }

  set(key: string, data: T, ttl?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttl || this.defaultTTL);
    
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Get data age in milliseconds
  getAge(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return Date.now() - entry.timestamp;
  }

  // Check if data is stale (older than certain threshold)
  isStale(key: string, staleThreshold: number = 2 * 60 * 1000): boolean {
    const age = this.getAge(key);
    return age !== null && age > staleThreshold;
  }

  // Get all keys that are stale
  getStaleKeys(staleThreshold: number = 2 * 60 * 1000): string[] {
    const staleKeys: string[] = [];
    for (const [key] of this.cache) {
      if (this.isStale(key, staleThreshold)) {
        staleKeys.push(key);
      }
    }
    return staleKeys;
  }

  // Cleanup expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  // Get cache stats
  getStats(): { size: number; expired: number; fresh: number } {
    const now = Date.now();
    let expired = 0;
    let fresh = 0;

    for (const [, entry] of this.cache) {
      if (now > entry.expiresAt) {
        expired++;
      } else {
        fresh++;
      }
    }

    return {
      size: this.cache.size,
      expired,
      fresh
    };
  }
}