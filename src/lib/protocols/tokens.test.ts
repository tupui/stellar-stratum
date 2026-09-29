import { describe, expect, it } from 'vitest';
import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import { checkListedToken, sacContract } from './tokens';

const XLM = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const ISSUER = Keypair.random().publicKey();
const AQUA = new Asset('AQUA', ISSUER).contractId(Networks.PUBLIC);
// Some Soroban token that is not a Stellar Asset Contract.
const CONTRACT_TOKEN = 'CDN3LLHWKQKSKABVUGRB5TARVRSCM7H34SWUQ4AF53PS3QO66FMZACYB';

describe('sacContract', () => {
  it('derives the Stellar Asset Contract of XLM and of a classic asset', () => {
    expect(sacContract('XLM', undefined, 'mainnet')).toBe(XLM);
    expect(sacContract('USDC', USDC_ISSUER, 'mainnet')).toBe(USDC);
    expect(sacContract('USDC', USDC_ISSUER, 'testnet')).not.toBe(USDC);
  });

  it('is null for what is not a classic asset', () => {
    expect(sacContract('USDC', undefined, 'mainnet')).toBeNull();
    expect(sacContract('USDC', 'not-an-issuer', 'mainnet')).toBeNull();
    expect(sacContract('WAY_TOO_LONG_CODE', ISSUER, 'mainnet')).toBeNull();
  });
});

describe('checkListedToken', () => {
  it('keeps a Stellar Asset Contract at 7 decimals, whatever the list says', () => {
    expect(checkListedToken({ contract: AQUA, code: 'AQUA', issuer: ISSUER, decimals: 9 } as never, 'mainnet')).toEqual({
      contract: AQUA,
      sac: true,
      code: 'AQUA',
      issuer: ISSUER,
      decimals: 7,
    });
  });

  it('names the native contract XLM, whatever the list says', () => {
    expect(checkListedToken({ contract: XLM, code: 'USDC' }, 'mainnet')).toEqual({
      contract: XLM,
      sac: true,
      code: 'XLM',
      decimals: 7,
    });
  });

  it('drops an entry whose code and issuer are not those of its contract', () => {
    // Another contract passed off as Circle's USDC: the real issuer, a fake address.
    expect(checkListedToken({ contract: AQUA, code: 'USDC', issuer: USDC_ISSUER }, 'mainnet')).toBeNull();
    expect(checkListedToken({ contract: CONTRACT_TOKEN, code: 'USDC', issuer: USDC_ISSUER }, 'mainnet')).toBeNull();
    // The real native contract claimed by an issued asset.
    expect(checkListedToken({ contract: XLM, code: 'XLM', issuer: ISSUER }, 'mainnet')).toBeNull();
    // An entry calling itself XLM that is not the native contract.
    expect(checkListedToken({ contract: CONTRACT_TOKEN, code: 'XLM' }, 'mainnet')).toBeNull();
    expect(checkListedToken({ code: 'AQUA', issuer: ISSUER }, 'mainnet')).toBeNull();
  });

  it('keeps any other contract without vouching for its name or decimals', () => {
    expect(checkListedToken({ contract: CONTRACT_TOKEN, code: 'EURC' }, 'mainnet')).toEqual({ contract: CONTRACT_TOKEN, sac: false });
  });
});
