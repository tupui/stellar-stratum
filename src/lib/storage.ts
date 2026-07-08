// Small localStorage wrapper: never throws (private mode / quota / disabled storage).
// Every module in the app used to inline the same try/catch — this is the one home.

export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore — private mode, quota exceeded, storage disabled
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },

  getJSON<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  setJSON(key: string, value: unknown): void {
    try {
      this.set(key, JSON.stringify(value));
    } catch {
      // ignore serialization errors
    }
  },
};
