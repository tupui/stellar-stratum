// Pricing diagnostics utility for transparency and debugging
import { pricingLogger, type PricingEvent } from './pricing-logger';
import { getLastPriceUpdate } from './reflector';

export interface PricingDiagnostics {
  lastUpdate: Date | null;
  recentErrors: PricingEvent[];
  cacheHitRate: number;
  totalRequests: number;
  errorRate: number;
  averageResponseTime: number | null;
  staleness: 'fresh' | 'recent' | 'stale' | 'very_stale';
}

export const getPricingDiagnostics = (): PricingDiagnostics => {
  const events = pricingLogger.getEvents();
  const recentErrors = pricingLogger.getRecentErrors();
  const lastUpdate = getLastPriceUpdate();
  
  // Calculate cache hit rate
  const cacheHits = events.filter(e => e.type === 'cache_hit').length;
  const totalRequests = events.filter(e => 
    ['cache_hit', 'cache_miss', 'price_fetch'].includes(e.type)
  ).length;
  const cacheHitRate = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;
  
  // Calculate error rate
  const errors = events.filter(e => e.type.includes('error')).length;
  const errorRate = events.length > 0 ? (errors / events.length) * 100 : 0;
  
  // Determine staleness
  let staleness: PricingDiagnostics['staleness'] = 'very_stale';
  if (lastUpdate) {
    const ageMs = Date.now() - lastUpdate.getTime();
    const minutes = ageMs / (60 * 1000);
    
    if (minutes <= 5) staleness = 'fresh';
    else if (minutes <= 15) staleness = 'recent';
    else if (minutes <= 30) staleness = 'stale';
    else staleness = 'very_stale';
  }
  
  // Calculate average response time (simplified - based on event frequency)
  const priceEvents = events.filter(e => e.type === 'price_fetch');
  const averageResponseTime = priceEvents.length > 1 ? 
    (priceEvents[priceEvents.length - 1].timestamp - priceEvents[0].timestamp) / priceEvents.length : 
    null;
  
  return {
    lastUpdate,
    recentErrors,
    cacheHitRate,
    totalRequests,
    errorRate,
    averageResponseTime,
    staleness
  };
};

export const formatDiagnosticsReport = (): string => {
  const diagnostics = getPricingDiagnostics();
  
  return `
## Pricing System Diagnostics

**Last Update:** ${diagnostics.lastUpdate ? diagnostics.lastUpdate.toLocaleString() : 'Never'}
**Staleness:** ${diagnostics.staleness}
**Cache Hit Rate:** ${diagnostics.cacheHitRate.toFixed(1)}%
**Error Rate:** ${diagnostics.errorRate.toFixed(1)}%
**Total Requests:** ${diagnostics.totalRequests}
**Recent Errors:** ${diagnostics.recentErrors.length}

${diagnostics.recentErrors.length > 0 ? 
  '**Recent Error Details:**\n' + 
  diagnostics.recentErrors.map(e => `- ${e.type}: ${e.error || 'Unknown error'} (${e.asset || 'N/A'})`).join('\n')
  : '**No recent errors**'
}
`.trim();
};