import { describe, expect, it } from 'vitest';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildSEP7TxUri, parseSEP7TxUri, parseTransactionPayload } from './sep7';

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
    expect(parseSEP7TxUri(`stellar:tx?xdr=${encodeURIComponent(xdr)}&network=testnet`)?.network).toBe('testnet');
  });

  it('restores + signs that URLSearchParams turns into spaces', () => {
    expect(parseSEP7TxUri(`web+stellar:tx?xdr=${xdr}`)?.xdr).toBe(xdr);
  });

  it('refuses networks the app cannot sign for and other operations', () => {
    expect(parseSEP7TxUri(`web+stellar:tx?xdr=${encodeURIComponent(xdr)}&network_passphrase=Other`)).toBeNull();
    expect(parseSEP7TxUri(`web+stellar:pay?destination=${Keypair.random().publicKey()}`)).toBeNull();
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
