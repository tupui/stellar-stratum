import { useEffect, useRef } from 'react';

/**
 * Performance monitoring hooks for development and optimization
 */

interface PerformanceMetrics {
  renderCount: number;
  lastRenderTime: number;
  averageRenderTime: number;
  slowRenders: number;
}

export const useRenderPerformance = (componentName: string, threshold = 16) => {
  const metricsRef = useRef<PerformanceMetrics>({
    renderCount: 0,
    lastRenderTime: 0,
    averageRenderTime: 0,
    slowRenders: 0
  });
  
  const renderStartTime = useRef(performance.now());

  useEffect(() => {
    const renderEndTime = performance.now();
    const renderTime = renderEndTime - renderStartTime.current;
    
    const metrics = metricsRef.current;
    metrics.renderCount++;
    metrics.lastRenderTime = renderTime;
    metrics.averageRenderTime = (metrics.averageRenderTime * (metrics.renderCount - 1) + renderTime) / metrics.renderCount;
    
    if (renderTime > threshold) {
      metrics.slowRenders++;
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Slow render detected in ${componentName}: ${renderTime.toFixed(2)}ms`);
      }
    }

    renderStartTime.current = performance.now();
  });

  return metricsRef.current;
};

export const useMemoryMonitor = () => {
  useEffect(() => {
    if ('memory' in performance && process.env.NODE_ENV === 'development') {
      const checkMemory = () => {
        const memory = (performance as any).memory;
        if (memory.usedJSHeapSize > memory.totalJSHeapSize * 0.9) {
          console.warn('High memory usage detected', {
            used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
            total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + 'MB'
          });
        }
      };

      const interval = setInterval(checkMemory, 10000);
      return () => clearInterval(interval);
    }
  }, []);
};

export { useRenderPerformance as usePerformanceMonitor };