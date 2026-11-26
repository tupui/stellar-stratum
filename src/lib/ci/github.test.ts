import { describe, expect, it } from 'vitest';
import { messageOf, readRequest } from './github';

const inputs: Record<string, string> = {
  'source-account': 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
  network: 'testnet',
  operation: 'call',
  contract: 'CABC',
  method: 'upgrade',
  args: '{"new_wasm_hash":"ab"}',
};
const read = (override: Record<string, string> = {}) => readRequest((name) => ({ ...inputs, ...override })[name] ?? '');
const request = { sourceAccount: inputs['source-account'], network: 'testnet', kind: 'call', contractId: 'CABC', method: 'm' } as const;

describe('readRequest', () => {
  it('reads a contract call with its arguments', () => {
    expect(read()).toMatchObject({ kind: 'call', contractId: 'CABC', method: 'upgrade', args: { new_wasm_hash: 'ab' } });
  });

  it('names the input that has a value it does not know', () => {
    expect(() => read({ network: 'futurenet' })).toThrow('The network must be one of testnet, mainnet.');
    expect(() => read({ operation: 'burn' })).toThrow('The operation must be one of upload, deploy, call.');
  });
});

describe('messageOf', () => {
  it('links to the stored transaction', () => {
    const message = messageOf(request, { hash: 'abc', xdr: '', stored: true });
    expect(message).toContain('[Review and sign in Stratum](https://stellar-stratum.xyz/?r=abc)');
  });

  it('says that the CI has signed and a human signature is still missing', () => {
    const message = messageOf(request, { hash: 'abc', xdr: '', stored: true, signed: { weight: 1, threshold: 2 } });
    expect(message).toContain('is signed by the CI (1 of 2) and waits for the human signature');
  });

  it('sends the signers to the Import tab when the transaction is too large for Refractor', () => {
    const message = messageOf(request, { hash: 'abc', xdr: '', stored: false });
    expect(message).toContain('choose Import');
    expect(message).toContain('`abc`');
  });
});
