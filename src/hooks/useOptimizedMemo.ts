import { useMemo, useCallback, DependencyList, useRef, useState, useEffect } from 'react';

/**
 * Enhanced memoization hooks with better performance characteristics
 */

// Deep comparison memoization for complex objects
export const useDeepMemo = <T>(
  factory: () => T,
  deps: DependencyList
): T => {
  const depsRef = useRef<DependencyList>();
  const valueRef = useRef<T>();

  return useMemo(() => {
    const depsChanged = !depsRef.current || 
      depsRef.current.length !== deps.length ||
      depsRef.current.some((dep, index) => {
        const newDep = deps[index];
        if (typeof dep === 'object' && typeof newDep === 'object') {
          return JSON.stringify(dep) !== JSON.stringify(newDep);
        }
        return dep !== newDep;
      });

    if (depsChanged) {
      depsRef.current = deps;
      valueRef.current = factory();
    }

    return valueRef.current!;
  }, deps);
};

// Stable callback that only updates when deps change
export const useStableCallback = <T extends (...args: any[]) => any>(
  callback: T,
  deps: DependencyList
): T => {
  return useCallback(callback, deps);
};

// Memoization with cleanup function
export const useMemoWithCleanup = <T>(
  factory: () => T,
  cleanup: (value: T) => void,
  deps: DependencyList
): T => {
  const valueRef = useRef<T>();

  return useMemo(() => {
    // Clean up previous value if it exists
    if (valueRef.current !== undefined) {
      cleanup(valueRef.current);
    }

    valueRef.current = factory();
    return valueRef.current;
  }, deps);
};

// Async memoization for promises
export const useAsyncMemo = <T>(
  asyncFactory: () => Promise<T>,
  deps: DependencyList,
  initialValue: T
): T => {
  const [value, setValue] = useState<T>(initialValue);
  const lastDeps = useRef<DependencyList>();

  useEffect(() => {
    const depsChanged = !lastDeps.current || 
      lastDeps.current.some((dep, index) => dep !== deps[index]);

    if (depsChanged) {
      lastDeps.current = deps;
      asyncFactory().then(setValue).catch(console.error);
    }
  }, deps);

  return value;
};