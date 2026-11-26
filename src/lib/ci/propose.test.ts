import { describe, expect, it } from 'vitest';
import { proposeSigning, stratumLink } from './propose';

describe('proposeSigning', () => {
  it('refuses a source account that is not a public key', async () => {
    const request = { sourceAccount: 'nope', network: 'testnet', kind: 'upload', wasm: new Uint8Array(1) } as const;
    await expect(proposeSigning(request)).rejects.toThrow('The source account is not a public key.');
  });
});

describe('stratumLink', () => {
  it('opens a stored transaction by its hash, and the app itself otherwise', () => {
    expect(stratumLink({ hash: 'abc', xdr: '', stored: true })).toBe('https://stellar-stratum.xyz/?r=abc');
    expect(stratumLink({ hash: 'abc', xdr: '', stored: false })).toBe('https://stellar-stratum.xyz');
  });
});
