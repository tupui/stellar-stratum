import { useState, useEffect } from 'react';
import { getLastPriceUpdate } from '@/lib/reflector';

export interface PriceStalenessInfo {
  isStale: boolean;
  lastUpdate: Date | null;
  minutesSinceUpdate: number | null;
  stalenessLevel: 'fresh' | 'recent' | 'stale' | 'very_stale';
}

export const usePriceStaleness = () => {
  const [stalenessInfo, setStalenessInfo] = useState<PriceStalenessInfo>({
    isStale: false,
    lastUpdate: null,
    minutesSinceUpdate: null,
    stalenessLevel: 'fresh'
  });

  useEffect(() => {
    const checkStaleness = () => {
      const lastUpdate = getLastPriceUpdate();
      
      if (!lastUpdate) {
        setStalenessInfo({
          isStale: true,
          lastUpdate: null,
          minutesSinceUpdate: null,
          stalenessLevel: 'very_stale'
        });
        return;
      }

      const now = Date.now();
      const ageMs = now - lastUpdate.getTime();
      const minutesSinceUpdate = Math.floor(ageMs / (60 * 1000));

      let stalenessLevel: PriceStalenessInfo['stalenessLevel'] = 'fresh';
      let isStale = false;

      if (minutesSinceUpdate > 30) {
        stalenessLevel = 'very_stale';
        isStale = true;
      } else if (minutesSinceUpdate > 15) {
        stalenessLevel = 'stale';
        isStale = true;
      } else if (minutesSinceUpdate > 5) {
        stalenessLevel = 'recent';
        isStale = false;
      } else {
        stalenessLevel = 'fresh';
        isStale = false;
      }

      setStalenessInfo({
        isStale,
        lastUpdate,
        minutesSinceUpdate,
        stalenessLevel
      });
    };

    // Check immediately
    checkStaleness();

    // Check every minute
    const interval = setInterval(checkStaleness, 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return stalenessInfo;
};