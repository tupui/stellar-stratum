import { describe, expect, it } from 'vitest';
import type { SignatureRequirement } from '../signatures';
import { checkSecondSignatureNeeded, proposeSigning, stratumLink } from './propose';

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

describe('checkSecondSignatureNeeded', () => {
  const requirement: SignatureRequirement = { account: 'GSOURCE', level: 'med', threshold: 2, weight: 1, signedBy: ['GCI'], known: true };

  it('accepts a signing key that leaves the threshold to someone else', () => {
    expect(() => checkSecondSignatureNeeded(requirement, 'GCI')).not.toThrow();
  });

  it('refuses a key that is not a signer of the account', () => {
    expect(() => checkSecondSignatureNeeded({ ...requirement, signedBy: [], weight: 0 }, 'GCI')).toThrow(
      'The signing key is not a signer of the source account.',
    );
  });

  it('refuses a key that reaches the threshold alone, as a single key account does', () => {
    expect(() => checkSecondSignatureNeeded({ ...requirement, threshold: 1 }, 'GCI')).toThrow(
      'The signing key alone reaches the threshold, so no second signature would be needed.',
    );
  });
});
