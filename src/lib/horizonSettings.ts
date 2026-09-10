import { useSyncExternalStore } from 'react';
import { appConfig } from './appConfig';
import { safeStorage } from './storage';

/**
 * User-configurable Horizon endpoints, per network. By default the primary Horizon
 * plus the public mirrors from appConfig are used in order; users can disable any
 * of them or add their own (custom endpoints take priority over built-in ones).
 */
export type Network = 'mainnet' | 'testnet';

export interface HorizonEndpoint {
  url: string;
  enabled: boolean;
  builtIn: boolean;
}

interface NetworkSettings {
  custom: string[];
  disabled: string[];
}
type StoredSettings = Record<Network, NetworkSettings>;

const STORAGE_KEY = 'horizon-endpoints-v1';
const EMPTY: NetworkSettings = { custom: [], disabled: [] };

const normalizeUrl = (raw: string) => raw.trim().replace(/\/+$/, '');

const load = (): StoredSettings => {
  const stored = safeStorage.getJSON<Partial<StoredSettings>>(STORAGE_KEY, {});
  const clean = (s?: Partial<NetworkSettings>): NetworkSettings => ({
    custom: Array.isArray(s?.custom) ? s.custom.filter((u): u is string => typeof u === 'string').map(normalizeUrl) : [],
    disabled: Array.isArray(s?.disabled) ? s.disabled.filter((u): u is string => typeof u === 'string').map(normalizeUrl) : [],
  });
  return { mainnet: clean(stored.mainnet), testnet: clean(stored.testnet) };
};

let settings: StoredSettings = load();
const listeners = new Set<() => void>();
const commit = (next: StoredSettings) => {
  settings = next;
  safeStorage.setJSON(STORAGE_KEY, next);
  listeners.forEach((fn) => fn());
};

export const defaultHorizonUrls = (network: Network): string[] =>
  network === 'testnet'
    ? [appConfig.TESTNET_HORIZON, ...appConfig.TESTNET_HORIZON_FALLBACKS]
    : [appConfig.MAINNET_HORIZON, ...appConfig.MAINNET_HORIZON_FALLBACKS];

/** Every known endpoint for the network, custom ones first, with its enabled state. */
export const listHorizonEndpoints = (network: Network): HorizonEndpoint[] => {
  const { custom, disabled } = settings[network] ?? EMPTY;
  const builtIn = defaultHorizonUrls(network);
  return [
    ...custom.map((url) => ({ url, enabled: !disabled.includes(url), builtIn: false })),
    ...builtIn.map((url) => ({ url, enabled: !disabled.includes(url), builtIn: true })),
  ];
};

/**
 * Enabled endpoints in priority order. Never empty: if the user disabled everything
 * the built-in primary is used so the app keeps working.
 */
export const getHorizonUrls = (network: Network): string[] => {
  const enabled = listHorizonEndpoints(network).filter((e) => e.enabled).map((e) => e.url);
  return enabled.length > 0 ? enabled : [defaultHorizonUrls(network)[0]];
};

export const horizonSettings = {
  setEnabled(network: Network, url: string, enabled: boolean) {
    const current = settings[network] ?? EMPTY;
    const disabled = enabled ? current.disabled.filter((u) => u !== url) : [...new Set([...current.disabled, url])];
    commit({ ...settings, [network]: { ...current, disabled } });
  },
  addCustom(network: Network, rawUrl: string) {
    const url = normalizeUrl(rawUrl);
    const current = settings[network] ?? EMPTY;
    if (current.custom.includes(url) || defaultHorizonUrls(network).includes(url)) return;
    commit({ ...settings, [network]: { custom: [url, ...current.custom], disabled: current.disabled.filter((u) => u !== url) } });
  },
  removeCustom(network: Network, url: string) {
    const current = settings[network] ?? EMPTY;
    commit({
      ...settings,
      [network]: { custom: current.custom.filter((u) => u !== url), disabled: current.disabled.filter((u) => u !== url) },
    });
  },
  reset(network: Network) {
    commit({ ...settings, [network]: { custom: [], disabled: [] } });
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get: () => settings,
};

export const useHorizonEndpoints = (network: Network): HorizonEndpoint[] => {
  useSyncExternalStore(horizonSettings.subscribe, horizonSettings.get, horizonSettings.get);
  return listHorizonEndpoints(network);
};

export interface HorizonProbe {
  ok: boolean;
  version?: string;
  passphrase?: string;
  latestLedger?: number;
  latencyMs: number;
  error?: string;
}

/** Fetch a Horizon root document to confirm the URL is a Horizon for the given network. */
export const probeHorizon = async (rawUrl: string, network: Network): Promise<HorizonProbe> => {
  const url = normalizeUrl(rawUrl);
  const started = performance.now();
  const latency = () => Math.round(performance.now() - started);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, latencyMs: 0, error: 'Not a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return { ok: false, latencyMs: 0, error: 'Use https:// (http is only allowed for localhost)' };
  }
  try {
    const response = await fetch(`${url}/`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { ok: false, latencyMs: latency(), error: `HTTP ${response.status}` };
    const body = (await response.json()) as { horizon_version?: string; network_passphrase?: string; history_latest_ledger?: number };
    if (typeof body.horizon_version !== 'string') return { ok: false, latencyMs: latency(), error: 'Response is not a Horizon root document' };
    const expected = network === 'testnet' ? appConfig.TESTNET_PASSPHRASE : appConfig.MAINNET_PASSPHRASE;
    if (body.network_passphrase !== expected) {
      return { ok: false, latencyMs: latency(), version: body.horizon_version.split('-')[0], passphrase: body.network_passphrase, error: `Serves a different network (${body.network_passphrase ?? 'unknown'})` };
    }
    return { ok: true, latencyMs: latency(), version: body.horizon_version.split('-')[0], passphrase: body.network_passphrase, latestLedger: body.history_latest_ledger };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, latencyMs: latency(), error: /abort|timeout/i.test(message) ? 'No response within 10s' : `Unreachable (${message}); the endpoint may also be missing CORS headers` };
  }
};
