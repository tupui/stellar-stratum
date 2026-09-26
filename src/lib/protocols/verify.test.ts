import { describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { analyzeOperations } from './detect';
import { verifyProtocolTransaction, withExpiry, type ExpectedCall } from './verify';

const ACCOUNT = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();

const AGGREGATOR = 'CARVQXFP4JF5ELLXUMQ6DALR346YVGBMQOHB4ENA7SSVXAYABXLBDDC4';
const ROUTER = 'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH';
const VAULT = 'CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK';
const XLM = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const USDC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const PAIR = 'CDN3LLHWKQKSKABVUGRB5TARVRSCM7H34SWUQ4AF53PS3QO66FMZACYB';
const TESTNET_ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const TESTNET_XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const address = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

const call = (contract: string, fn: string, args: xdr.ScVal[], subInvocations: xdr.SorobanAuthorizedInvocation[] = []) =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args }),
    ),
    subInvocations,
  });

const transfer = (token: string, from: string, to: string, amount: bigint) =>
  call(token, 'transfer', [address(from), address(to), i128(amount)]);

const sourceAuth = (root: xdr.SorobanAuthorizedInvocation) =>
  new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: root });

interface Fixture {
  contract: string;
  fn: string;
  args: xdr.ScVal[];
  /** Authorized token transfers under the root call. */
  transfers?: xdr.SorobanAuthorizedInvocation[];
  auth?: xdr.SorobanAuthorizationEntry[];
  source?: string;
  opSource?: string;
  extraOps?: xdr.Operation[];
  passphrase?: string;
  fee?: string;
  timeout?: number;
}

/** An envelope as the API would hand it back: unsigned, one contract call, source-account auth. */
const envelope = ({
  contract,
  fn,
  args,
  transfers = [],
  auth,
  source = ACCOUNT,
  opSource,
  extraOps = [],
  passphrase = Networks.PUBLIC,
  fee = '166497',
  timeout = 3600,
}: Fixture) => {
  const builder = new TransactionBuilder(new Account(source, '100'), { fee, networkPassphrase: passphrase }).addOperation(
    Operation.invokeContractFunction({
      contract,
      function: fn,
      args,
      auth: auth ?? [sourceAuth(call(contract, fn, args, transfers))],
      source: opSource,
    }),
  );
  extraOps.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(timeout).build().toXDR();
};

// --- Swap through the aggregator, as `/quote/build` returns it today ---

const swapArgs = ({ from = ACCOUNT, minOut = 2_147_305n, options = xdr.ScVal.scvVoid() as xdr.ScVal } = {}) => [
  address(from),
  address(XLM),
  i128(10_000_000n),
  address(USDC),
  i128(minOut),
  xdr.ScVal.scvVec([]),
  options,
];

const swap = (overrides: Partial<Fixture> & { from?: string; minOut?: bigint; options?: xdr.ScVal } = {}) => {
  const { from, minOut, options, ...rest } = overrides;
  return envelope({
    contract: AGGREGATOR,
    fn: 'swap_exact_in',
    args: swapArgs({ from, minOut, options }),
    transfers: [transfer(XLM, from ?? ACCOUNT, AGGREGATOR, 10_000_000n)],
    ...rest,
  });
};

const quotedSwap: ExpectedCall = {
  kind: 'swap',
  exact: 'in',
  tokenIn: XLM,
  tokenOut: USDC,
  amountIn: 10_000_000n,
  minOut: 2_147_305n,
};

const check = (xdrBase64: string, expected: ExpectedCall = quotedSwap, network: 'mainnet' | 'testnet' = 'mainnet') =>
  () => verifyProtocolTransaction(xdrBase64, network, ACCOUNT, expected);

describe('verifyProtocolTransaction — Soroswap swap', () => {
  it('accepts the swap that was requested', () => {
    expect(check(swap())).not.toThrow();
  });

  it('accepts a minimum above the quoted one', () => {
    expect(check(swap({ minOut: 2_200_000n }))).not.toThrow();
  });

  it('refuses another source account', () => {
    expect(check(swap({ source: OTHER }))).toThrow(/source account/);
  });

  it('refuses an operation run from another account', () => {
    expect(check(swap({ opSource: OTHER }))).toThrow(/runs its operation from/);
  });

  it('refuses a contract that is not the pinned aggregator or router', () => {
    expect(check(swap({ contract: PAIR }))).toThrow(/not the Soroswap Aggregator or Router/);
  });

  it('refuses spending from, or paying out to, another address', () => {
    expect(check(swap({ from: OTHER }))).toThrow(/sets from to/);
    const routed = envelope({
      contract: ROUTER,
      fn: 'swap_exact_tokens_for_tokens',
      args: [i128(10_000_000n), i128(2_147_305n), nativeToScVal([XLM, USDC].map((c) => new Address(c))), address(OTHER), nativeToScVal(1_900_000_000, { type: 'u64' })],
      transfers: [transfer(XLM, ACCOUNT, PAIR, 10_000_000n)],
    });
    expect(check(routed)).toThrow(/sets to to/);
  });

  it('refuses a filled trailing option (it could redirect or skim the output)', () => {
    expect(check(swap({ options: address(OTHER) }))).toThrow(/form the app cannot check/);
  });

  it('refuses a minimum below the quote', () => {
    expect(check(swap({ minOut: 2_147_304n }))).toThrow(/less than the minimum/);
  });

  it('refuses a different amount or token pair', () => {
    expect(check(swap(), { ...quotedSwap, amountIn: 20_000_000n })).toThrow(/sells a different amount/);
    expect(check(swap(), { ...quotedSwap, tokenOut: PAIR })).toThrow(/different pair/);
  });

  it('refuses an extra operation', () => {
    const drain = Operation.payment({ destination: OTHER, asset: Asset.native(), amount: '1000' });
    expect(check(swap({ extraOps: [drain] }))).toThrow(/2 operations/);
  });

  it('refuses a transaction built for the other network', () => {
    const testnet = envelope({
      contract: TESTNET_ROUTER,
      fn: 'swap_exact_tokens_for_tokens',
      args: [i128(10_000_000n), i128(2_147_305n), nativeToScVal([TESTNET_XLM, USDC].map((c) => new Address(c))), address(ACCOUNT), nativeToScVal(1_900_000_000, { type: 'u64' })],
      transfers: [transfer(TESTNET_XLM, ACCOUNT, PAIR, 10_000_000n)],
      passphrase: Networks.TESTNET,
    });
    expect(check(testnet)).toThrow(/testnet deployment/);
    // The passphrase is not in an unsigned envelope: the same bytes checked
    // against testnet fail on the network-specific contract address instead.
    expect(check(swap(), quotedSwap, 'testnet')).toThrow(/mainnet deployment/);
  });

  it('refuses authorization beyond the call itself', () => {
    const args = swapArgs();
    const tooMuch = [transfer(XLM, ACCOUNT, AGGREGATOR, 10_000_001n)];
    expect(check(swap({ transfers: tooMuch }))).toThrow(/more of your funds/);
    const otherToken = [transfer(XLM, ACCOUNT, AGGREGATOR, 10_000_000n), transfer(USDC, ACCOUNT, OTHER, 1n)];
    expect(check(swap({ transfers: otherToken }))).toThrow(/more of your funds/);
    const otherRoot = [sourceAuth(call(USDC, 'transfer', [address(ACCOUNT), address(OTHER), i128(1n)]))];
    expect(check(swap({ auth: otherRoot }))).toThrow(/different call/);
    const otherSigner = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(OTHER).toScAddress(),
          nonce: 1n,
          signatureExpirationLedger: 1,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: call(AGGREGATOR, 'swap_exact_in', args),
    });
    expect(check(swap({ auth: [otherSigner] }))).toThrow(/authorization signed outside/);
  });

  it('refuses a draining fee and a transaction that never expires', () => {
    expect(check(swap({ fee: '1000000000' }))).toThrow(/XLM fee/);
    expect(check(swap({ timeout: 0 }))).toThrow(/never expires/);
  });

  it('decodes the swap on the signing screen', () => {
    const tx = TransactionBuilder.fromXDR(swap(), Networks.PUBLIC) as Transaction;
    const [decoded] = analyzeOperations(tx.operations, 'mainnet');
    expect(decoded.match).toMatchObject({ protocol: 'soroswap', role: 'Aggregator', confidence: 'verified' });
    expect(decoded.details).toMatchObject({
      kind: 'swap',
      sell: { contract: XLM, raw: '10000000', bound: 'exact' },
      buy: { contract: USDC, raw: '2147305', bound: 'min' },
    });
  });
});

describe('verifyProtocolTransaction — Soroswap liquidity', () => {
  const addArgs = (minB: bigint) => [
    address(USDC), address(XLM), i128(10_000_000n), i128(46_000_000n), i128(9_900_000n), i128(minB), address(ACCOUNT), nativeToScVal(1_900_000_000, { type: 'u64' }),
  ];
  const add = (minB = 45_540_000n) =>
    envelope({
      contract: ROUTER,
      fn: 'add_liquidity',
      args: addArgs(minB),
      transfers: [transfer(USDC, ACCOUNT, PAIR, 10_000_000n), transfer(XLM, ACCOUNT, PAIR, 46_000_000n)],
    });
  // Requested as XLM/USDC: the router may take the pair in the other order.
  const requested: ExpectedCall = {
    kind: 'add-liquidity', tokenA: XLM, tokenB: USDC, amountA: 46_000_000n, amountB: 10_000_000n, minA: 45_535_400n, minB: 9_899_000n,
  };

  it('accepts the requested deposit in either token order', () => {
    expect(check(add(), requested)).not.toThrow();
  });

  it('refuses a looser slippage floor', () => {
    expect(check(add(40_000_000n), requested)).toThrow(/more slippage/);
  });

  const removal = (minA: bigint) =>
    envelope({
      contract: ROUTER,
      fn: 'remove_liquidity',
      args: [address(XLM), address(USDC), i128(1_000_000n), i128(minA), i128(217_000n), address(ACCOUNT), nativeToScVal(1_900_000_000, { type: 'u64' })],
      transfers: [transfer(PAIR, ACCOUNT, PAIR, 1_000_000n)],
    });
  const removeRequest: ExpectedCall = {
    kind: 'remove-liquidity', pool: PAIR, tokenA: XLM, tokenB: USDC, liquidity: 1_000_000n, minA: 4_500_000n, minB: 217_000n,
  };

  it('accepts a removal with minimums at the requested floor', () => {
    expect(check(removal(4_500_000n), removeRequest)).not.toThrow();
  });

  it('refuses a removal with zero minimums', () => {
    expect(check(removal(0n), removeRequest)).toThrow(/more slippage/);
  });
});

describe('verifyProtocolTransaction — DeFindex vault', () => {
  const deposit = (from = ACCOUNT, vault = VAULT) =>
    envelope({
      contract: vault,
      fn: 'deposit',
      args: [nativeToScVal([i128(10_000_000n)]), nativeToScVal([i128(10_000_000n)]), address(from), nativeToScVal(false)],
      transfers: [transfer(USDC, from, vault, 10_000_000n)],
    });
  const requested: ExpectedCall = { kind: 'vault-deposit', vault: VAULT, amounts: [10_000_000n], invest: false };

  it('accepts the requested deposit', () => {
    expect(check(deposit(), requested)).not.toThrow();
  });

  it('refuses a deposit from another address or into another vault', () => {
    expect(check(deposit(OTHER), requested)).toThrow(/sets from to/);
    expect(check(deposit(ACCOUNT, ROUTER), requested)).toThrow(/not the DeFindex Vault/);
  });

  it('checks withdrawals by shares', () => {
    const withdraw = envelope({
      contract: VAULT,
      fn: 'withdraw',
      args: [i128(5_000_000n), nativeToScVal([i128(5_100_000n)]), address(ACCOUNT)],
    });
    expect(check(withdraw, { kind: 'vault-withdraw', vault: VAULT, shares: 5_000_000n })).not.toThrow();
    expect(check(withdraw, { kind: 'vault-withdraw', vault: VAULT, shares: 4_000_000n })).toThrow(/different number of shares/);
  });
});

describe('withExpiry', () => {
  it('bounds a transaction that never expires and changes nothing else', () => {
    const args = [nativeToScVal([i128(10_000_000n)]), nativeToScVal([i128(10_000_000n)]), address(ACCOUNT), nativeToScVal(false)];
    const unbounded = new TransactionBuilder(new Account(ACCOUNT, '100'), { fee: '100', networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.invokeContractFunction({ contract: VAULT, function: 'deposit', args, auth: [sourceAuth(call(VAULT, 'deposit', args, [transfer(USDC, ACCOUNT, VAULT, 10_000_000n)]))] }))
      .setSorobanData(new SorobanDataBuilder().setResourceFee(953_054).build())
      .setTimeout(0)
      .build();
    expect(unbounded.timeBounds?.maxTime).toBe('0');

    const bounded = TransactionBuilder.fromXDR(withExpiry(unbounded.toXDR(), 'mainnet'), Networks.PUBLIC) as Transaction;
    const maxTime = Number(bounded.timeBounds?.maxTime);
    expect(maxTime).toBeGreaterThan(Date.now() / 1000);
    expect(maxTime).toBeLessThanOrEqual(Date.now() / 1000 + 86_400 + 5);
    expect(bounded.fee).toBe(unbounded.fee);
    expect(bounded.sequence).toBe(unbounded.sequence);
    // Operations (with their auth) and the Soroban resources, byte for byte.
    const body = (tx: Transaction) => {
      const envelope = tx.toEnvelope();
      if (envelope.type !== 'envelopeTypeTx') throw new Error('expected a v1 envelope');
      const { operations, ext } = envelope.value.tx;
      return [...operations, ext].map((part) => part.toXDR('base64'));
    };
    expect(body(bounded)).toEqual(body(unbounded));
    expect(check(bounded.toXDR(), { kind: 'vault-deposit', vault: VAULT, amounts: [10_000_000n], invest: false })).not.toThrow();
  });

  it('leaves a bounded transaction untouched', () => {
    const bounded = swap();
    expect(withExpiry(bounded, 'mainnet')).toBe(bounded);
  });
});
