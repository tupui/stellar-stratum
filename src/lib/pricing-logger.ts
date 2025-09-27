// Centralized logging for pricing operations
export interface PricingEvent {
  type: 'price_fetch' | 'cache_hit' | 'cache_miss' | 'oracle_error' | 'kraken_error' | 'fallback_used';
  asset?: string;
  oracle?: string;
  price?: number;
  error?: string;
  timestamp: number;
}

class PricingLogger {
  private events: PricingEvent[] = [];
  private maxEvents = 100; // Keep last 100 events

  log(event: Omit<PricingEvent, 'timestamp'>): void {
    const logEvent: PricingEvent = {
      ...event,
      timestamp: Date.now()
    };

    // Add to events array
    this.events.push(logEvent);
    
    // Trim to max size
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Console log in development
    if (import.meta.env.DEV) {
      const prefix = `[Pricing ${event.type}]`;
      if (event.type.includes('error')) {
        console.warn(prefix, event);
      } else {
        console.info(prefix, event);
      }
    }
  }

  getEvents(): PricingEvent[] {
    return [...this.events];
  }

  getRecentErrors(minutes: number = 5): PricingEvent[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.events.filter(e => 
      e.timestamp > cutoff && 
      (e.type.includes('error') || e.type === 'fallback_used')
    );
  }

  clear(): void {
    this.events = [];
  }
}

export const pricingLogger = new PricingLogger();