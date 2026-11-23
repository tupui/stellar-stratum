import { describe, expect, it } from 'vitest';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildSEP7TxUri, parseSEP7PayUri, parseSEP7TxUri, parseTransactionPayload } from './sep7';

const xdr = new TransactionBuilder(new Account(Keypair.random().publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
  .setTimeout(0)
  .build()
  .toXDR();

describe('SEP-7 transaction URIs', () => {
  it('round-trips the XDR and the network', () => {
    expect(parseSEP7TxUri(buildSEP7TxUri(xdr, 'testnet'))).toEqual({ xdr, network: 'testnet' });
    expect(parseSEP7TxUri(buildSEP7TxUri(xdr, 'mainnet'))).toEqual({ xdr, network: 'mainnet' });
    expect(buildSEP7TxUri(xdr, 'mainnet')).toMatch(/^web\+stellar:tx\?/);
  });

  it('reads the legacy network parameter and the bare stellar: scheme', () => {
    expect(parseSEP7TxUri(`stellar:tx?xdr=${encodeURIComponent(xdr)}&network=testnet`)).toEqual({ xdr, network: 'testnet' });
  });

  it('restores + signs that URLSearchParams turns into spaces', () => {
    expect(parseSEP7TxUri(`web+stellar:tx?xdr=${xdr}`)).toEqual({ xdr, network: 'mainnet' });
  });

  it('refuses networks the app cannot sign for, and ignores other operations', () => {
    expect(parseSEP7TxUri(`web+stellar:tx?xdr=${encodeURIComponent(xdr)}&network_passphrase=Other`)).toEqual({
      refused: 'This request is for a network Stratum does not support.',
    });
    expect(parseSEP7TxUri(`web+stellar:pay?destination=${Keypair.random().publicKey()}`)).toBeNull();
  });

  it('refuses a transaction with fields left to fill in', () => {
    const uri = `web+stellar:tx?xdr=${encodeURIComponent(xdr)}&replace=${encodeURIComponent('sourceAccount:X;X:account to pay from')}`;
    expect(parseSEP7TxUri(uri)).toHaveProperty('refused', expect.stringMatching(/fill in/));
    expect(parseTransactionPayload(uri)).toHaveProperty('refused');
  });

  it('ignores msg, callback, origin_domain and chain', () => {
    const extra = 'msg=Sign%20now&callback=url%3Ahttps%3A%2F%2Fexample.org&origin_domain=example.org&signature=abc&chain=x';
    expect(parseSEP7TxUri(`${buildSEP7TxUri(xdr, 'testnet')}&${extra}`)).toEqual({ xdr, network: 'testnet' });
  });
});

describe('SEP-7 payment requests', () => {
  const destination = Keypair.random().publicKey();
  const issuer = Keypair.random().publicKey();
  const pay = (params: string) => parseSEP7PayUri(`web+stellar:pay?destination=${destination}&${params}`);
  const testnet = `network_passphrase=${encodeURIComponent(Networks.TESTNET)}`;

  it('reads the network like a tx URI: none means the public network', () => {
    expect(pay('amount=10')).toEqual({ destination, network: 'mainnet', amount: '10' });
    expect(pay(`amount=10&${testnet}`)).toEqual({ destination, network: 'testnet', amount: '10' });
    expect(pay('network_passphrase=Other')).toEqual({ refused: 'This request is for a network Stratum does not support.' });
  });

  it('reads the asset, with XLM as no asset', () => {
    expect(pay(`asset_code=USDC&asset_issuer=${issuer}`)).toMatchObject({ asset: { code: 'USDC', issuer } });
    expect(pay('asset_code=XLM')).not.toHaveProperty('asset');
  });

  it('accepts both spellings of text and ID memos', () => {
    for (const type of ['MEMO_TEXT', 'text', 'Text']) {
      expect(pay(`memo=hello%20world&memo_type=${type}`)).toMatchObject({ memo: { type: 'text', value: 'hello world' } });
    }
    for (const type of ['MEMO_ID', 'id']) {
      expect(pay(`memo=123&memo_type=${type}`)).toMatchObject({ memo: { type: 'id', value: '123' } });
    }
    expect(pay('memo=hello')).toMatchObject({ memo: { type: 'text', value: 'hello' } });
  });

  it('refuses hash and return memos, which the form cannot send', () => {
    expect(pay('memo=AAAA&memo_type=MEMO_HASH')).toEqual({ refused: 'This request needs a hash memo, which Stratum cannot send.' });
    expect(pay('memo=AAAA&memo_type=return')).toEqual({ refused: 'This request needs a return memo, which Stratum cannot send.' });
  });

  it('refuses a missing or invalid destination and ignores other operations', () => {
    expect(parseSEP7PayUri('web+stellar:pay?amount=1')).toHaveProperty('refused');
    expect(parseSEP7PayUri('web+stellar:pay?destination=GABC')).toHaveProperty('refused');
    expect(parseSEP7PayUri(buildSEP7TxUri(xdr, 'testnet'))).toBeNull();
    expect(parseSEP7PayUri(destination)).toBeNull();
  });
});

describe('parseTransactionPayload', () => {
  it('accepts wrapped and URL-encoded base64 but names no network', () => {
    const wrapped = xdr.match(/.{1,60}/g)!.join('\n');
    expect(parseTransactionPayload(wrapped)).toEqual({ xdr });
    expect(parseTransactionPayload(encodeURIComponent(xdr))).toEqual({ xdr });
  });

  it('rejects anything else', () => {
    expect(parseTransactionPayload('hello')).toBeNull();
    expect(parseTransactionPayload('https://example.org/?r=abc')).toBeNull();
  });
});
