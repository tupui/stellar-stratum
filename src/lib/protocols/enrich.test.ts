import { describe, expect, it, vi } from 'vitest';
import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';

// A localStorage holding what an older version cached from a poisoned token list.
const storage = vi.hoisted(() => {
  const items = new Map<string, string>([
    ['stratum_protocol_tokens_v1_mainnet', '{"at":0,"tokens":{}}'],
    ['stratum_protocol_tokens_v1_testnet', '{"at":0,"tokens":{}}'],
  ]);
  const localStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
    removeItem: (key: string) => void items.delete(key),
  };
  (globalThis as { localStorage?: unknown }).localStorage = localStorage;
  return { items, localStorage };
});

// The token list and the contracts are fixtures: no API or RPC call leaves the test.
const list = vi.hoisted(() => ({ getAssetList: vi.fn() }));
vi.mock('@/lib/soroswap-client', () => ({ soroswapSDK: list }));
vi.mock('@/lib/defindex-client', () => ({ defindexSDK: {} }));
const chain = vi.hoisted(() => ({ readTokenDecimals: vi.fn(), readTokenSymbol: vi.fn() }));
vi.mock('./onchain', () => chain);

import { loadOnchainToken, loadTokenDirectory, resolveToken } from './enrich';

const XLM = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const USDC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ISSUER = Keypair.random().publicKey();
const AQUA = new Asset('AQUA', ISSUER).contractId(Networks.PUBLIC);
const FAKE = 'CDN3LLHWKQKSKABVUGRB5TARVRSCM7H34SWUQ4AF53PS3QO66FMZACYB';
const CONTRACT_TOKEN = 'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH';

describe('loadTokenDirectory', () => {
  it('drops what an older version cached', () => {
    expect(storage.items.has('stratum_protocol_tokens_v1_mainnet')).toBe(false);
    expect(storage.items.has('stratum_protocol_tokens_v1_testnet')).toBe(false);
  });

  it('keeps only Stellar Asset Contracts that match their address, at 7 decimals, in memory only', async () => {
    list.getAssetList.mockResolvedValue({
      assets: [
        { code: 'XLM', contract: XLM, decimals: 7 },
        // A real SAC listed with lying decimals.
        { code: 'AQUA', issuer: ISSUER, contract: AQUA, decimals: 9, icon: 'https://aqua.example/logo.png' },
        // Another contract labelled as Circle's USDC.
        { code: 'USDC', issuer: USDC_ISSUER, contract: FAKE, decimals: 7, icon: 'https://usdc.example/logo.png' },
        // A contract token: its listed name and decimals are not used.
        { code: 'EURC', contract: CONTRACT_TOKEN, decimals: 2 },
      ],
    });
    const directory = await loadTokenDirectory('mainnet');
    expect([...directory.keys()].sort()).toEqual([AQUA, XLM].sort());
    expect(directory.get(AQUA)).toEqual({ code: 'AQUA', issuer: ISSUER, decimals: 7, icon: 'https://aqua.example/logo.png', known: true });
    expect(storage.localStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('resolveToken', () => {
  const directory = new Map([[AQUA, { code: 'AQUA', issuer: ISSUER, decimals: 7, icon: 'aqua.png', known: true }]]);
  const onchain = new Map([[CONTRACT_TOKEN, { code: 'BLND', decimals: 9, known: true }]]);

  it('prefers the pinned table, then checked list entries, then the contract itself', () => {
    expect(resolveToken(USDC, 'mainnet', directory, onchain)).toMatchObject({ code: 'USDC', decimals: 7, known: true });
    expect(resolveToken(AQUA, 'mainnet', directory, onchain)).toMatchObject({ code: 'AQUA', decimals: 7 });
    expect(resolveToken(CONTRACT_TOKEN, 'mainnet', directory, onchain)).toEqual({ code: 'BLND', decimals: 9, known: true });
    expect(resolveToken(FAKE, 'mainnet', directory, onchain)).toBeUndefined();
  });
});

describe('loadOnchainToken', () => {
  it('reads decimals and symbol from the contract, or gives up', async () => {
    chain.readTokenDecimals.mockResolvedValue(9);
    chain.readTokenSymbol.mockResolvedValue('BLND');
    // The symbol is whatever the contract says, so it is shown with its address.
    await expect(loadOnchainToken(CONTRACT_TOKEN, 'mainnet')).resolves.toEqual({ code: 'BLND · CAG5…JDDH', decimals: 9, known: true });
    chain.readTokenDecimals.mockRejectedValue(new Error('HostError'));
    await expect(loadOnchainToken(CONTRACT_TOKEN, 'mainnet')).resolves.toBeNull();
  });
});
