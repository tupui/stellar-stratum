import { describe, expect, it } from 'vitest';
import { Account, Keypair, MuxedAccount, StrKey } from '@stellar/stellar-sdk';
import { accountIdOf } from './validation';

describe('accountIdOf', () => {
  const account = Keypair.random().publicKey();

  it('opens the account behind a muxed address', () => {
    expect(accountIdOf(account)).toBe(account);
    expect(accountIdOf(new MuxedAccount(new Account(account, '0'), '42').accountId())).toBe(account);
  });

  it('refuses anything that is not an account', () => {
    expect(accountIdOf(StrKey.encodeContract(Buffer.alloc(32, 7)))).toBeNull();
    expect(accountIdOf(`${account.slice(0, -1)}A`)).toBeNull();
    expect(accountIdOf('')).toBeNull();
  });
});
