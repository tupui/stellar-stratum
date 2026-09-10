/**
 * Keeps the address bar in sync with app state so any view can be shared or refreshed.
 *
 * Params:
 *   public_key  account being viewed (G...)
 *   network     mainnet | testnet
 *   view        transaction | multisig-config (absent on the dashboard)
 *   tab         active tab inside the current view
 */
export type UrlParamUpdates = Record<string, string | null | undefined>;

/** Set (string) or remove (null/undefined/empty) params, leaving path, hash and other params intact. */
export const updateUrlParams = (updates: UrlParamUpdates) => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const next = url.toString();
  if (next === window.location.href) return;
  // Preserve history.state so react-router's own entry state survives the rewrite.
  window.history.replaceState(window.history.state, '', next);
};

export const readUrlParam = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
};

/** Shareable link that reopens an account directly. */
export const buildAccountUrl = (publicKey: string, network: 'mainnet' | 'testnet'): string => {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('public_key', publicKey);
  url.searchParams.set('network', network);
  return url.toString();
};
