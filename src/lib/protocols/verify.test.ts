import { describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  Asset,
  Keypair,
  Memo,
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

/** The account's current sequence number; the fixtures are built on the next one. */
const SEQUENCE = 100n;
/** A router deadline ten minutes out, inside the fixtures' one-hour validity. */
const DEADLINE = Math.floor(Date.now() / 1000) + 600;

const address = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const u64 = (n: number | bigint) => nativeToScVal(n, { type: 'u64' });

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
  /** Extra conditions (memo, ledger bounds…) set on the builder. */
  tweak?: (builder: TransactionBuilder) => TransactionBuilder;
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
  tweak = (builder) => builder,
}: Fixture) => {
  const builder = new TransactionBuilder(new Account(source, SEQUENCE.toString()), { fee, networkPassphrase: passphrase }).addOperation(
    Operation.invokeContractFunction({
      contract,
      function: fn,
      args,
      auth: auth ?? [sourceAuth(call(contract, fn, args, transfers))],
      source: opSource,
    }),
  );
  extraOps.forEach((op) => builder.addOperation(op));
  return tweak(builder.setTimeout(timeout)).build().toXDR();
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

const check = (
  xdrBase64: string,
  expected: ExpectedCall = quotedSwap,
  network: 'mainnet' | 'testnet' = 'mainnet',
  sequence = SEQUENCE,
) => () => verifyProtocolTransaction(xdrBase64, network, ACCOUNT, expected, { sequence });

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
      args: [i128(10_000_000n), i128(2_147_305n), nativeToScVal([XLM, USDC].map((c) => new Address(c))), address(OTHER), u64(DEADLINE)],
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
      args: [i128(10_000_000n), i128(2_147_305n), nativeToScVal([TESTNET_XLM, USDC].map((c) => new Address(c))), address(ACCOUNT), u64(DEADLINE)],
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
    // No preconditions at all: the SDK builder cannot make one, so strip them from the XDR.
    const tx = TransactionBuilder.fromXDR(swap(), Networks.PUBLIC) as Transaction;
    const bare = tx.toEnvelope();
    if (bare.type !== 'envelopeTypeTx') throw new Error('expected a v1 envelope');
    Object.assign(bare.v1.tx, { cond: xdr.Preconditions.precondNone() });
    expect(check(bare.toXDR('base64'))).toThrow(/never expires/);
  });

  it('refuses a transaction that stays valid longer than the app allows', () => {
    // The app's own transactions are valid for a day; a few minutes of clock skew are tolerated.
    expect(check(swap({ timeout: 86_400 + 60 }))).not.toThrow();
    expect(check(swap({ timeout: 86_400 + 3600 }))).toThrow(/stays valid for 25 hours/);
    expect(check(swap({ timeout: 10 * 365 * 86_400 }))).toThrow(/instead of at most 24/);
  });

  it('refuses a memo and any condition beyond a time window', () => {
    expect(check(swap({ tweak: (b) => b.addMemo(Memo.text('Claim your refund at …')) }))).toThrow(/carries a memo/);
    expect(check(swap({ tweak: (b) => b.addMemo(Memo.id('1')) }))).toThrow(/carries a memo/);
    expect(check(swap({ tweak: (b) => b.setLedgerbounds(1, 0) }))).toThrow(/range of ledgers/);
    expect(check(swap({ tweak: (b) => b.setMinAccountSequence('7') }))).toThrow(/conditions on the account sequence/);
    expect(check(swap({ tweak: (b) => b.setMinAccountSequenceAge(5n) }))).toThrow(/conditions on the account sequence/);
    expect(check(swap({ tweak: (b) => b.setMinAccountSequenceLedgerGap(3) }))).toThrow(/conditions on the account sequence/);
    expect(check(swap({ tweak: (b) => b.setExtraSigners([Keypair.random().publicKey()]) }))).toThrow(/extra signers/);
  });

  it('refuses a sequence number other than the account’s next one', () => {
    // Built on sequence 101: right for an account at 100, not for one at 99 or 150.
    expect(check(swap(), quotedSwap, 'mainnet', 100n)).not.toThrow();
    expect(check(swap(), quotedSwap, 'mainnet', 99n)).toThrow(/sequence number 101 instead of your next one \(100\)/);
    expect(check(swap(), quotedSwap, 'mainnet', 150n)).toThrow(/sequence number/);
  });

  it('leaves a router deadline to the transaction expiry', () => {
    const routed = (deadline: xdr.ScVal) =>
      envelope({
        contract: ROUTER,
        fn: 'swap_exact_tokens_for_tokens',
        args: [i128(10_000_000n), i128(2_147_305n), nativeToScVal([XLM, USDC].map((c) => new Address(c))), address(ACCOUNT), deadline],
        transfers: [transfer(XLM, ACCOUNT, PAIR, 10_000_000n)],
      });
    // The transaction cannot land after its own expiry, whatever the contract deadline says.
    expect(check(routed(u64(DEADLINE)))).not.toThrow();
    expect(check(routed(u64(2n ** 64n - 1n)))).not.toThrow();
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
    address(USDC), address(XLM), i128(10_000_000n), i128(46_000_000n), i128(9_900_000n), i128(minB), address(ACCOUNT), u64(DEADLINE),
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
    kind: 'add-liquidity', tokenA: XLM, tokenB: USDC, amountA: 46_000_000n, amountB: 10_000_000n, minA: 45_535_400n, minB: 9_899_000n, newPool: false,
  };

  it('accepts the requested deposit in either token order', () => {
    expect(check(add(), requested)).not.toThrow();
  });

  it('refuses a looser slippage floor', () => {
    expect(check(add(40_000_000n), requested)).toThrow(/more slippage/);
  });

  it('refuses a minimum of 0 unless the pair is new or empty on chain', () => {
    const unbounded: ExpectedCall = { ...requested, minA: 0n, minB: 0n };
    expect(check(add(0n), unbounded)).toThrow(/no minimum on a pool that already has a price/);
    expect(check(add(0n), { ...unbounded, newPool: true })).not.toThrow();
  });

  const removal = (minA: bigint) =>
    envelope({
      contract: ROUTER,
      fn: 'remove_liquidity',
      args: [address(XLM), address(USDC), i128(1_000_000n), i128(minA), i128(217_000n), address(ACCOUNT), u64(DEADLINE)],
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

  const withdraw = (minOut: xdr.ScVal[]) =>
    envelope({
      contract: VAULT,
      fn: 'withdraw',
      args: [i128(5_000_000n), nativeToScVal(minOut), address(ACCOUNT)],
    });
  const withdrawal: ExpectedCall = { kind: 'vault-withdraw', vault: VAULT, shares: 5_000_000n, minAmountsOut: [5_048_000n] };

  it('checks withdrawals by shares', () => {
    expect(check(withdraw([i128(5_100_000n)]), withdrawal)).not.toThrow();
    expect(check(withdraw([i128(5_100_000n)]), { ...withdrawal, shares: 4_000_000n })).toThrow(/different number of shares/);
  });

  it('refuses a withdrawal whose minimum out is below the floor', () => {
    expect(check(withdraw([i128(5_048_000n)]), withdrawal)).not.toThrow();
    expect(check(withdraw([i128(5_047_999n)]), withdrawal)).toThrow(/less than the amount you are withdrawing/);
    expect(check(withdraw([i128(0n)]), withdrawal)).toThrow(/less than the amount you are withdrawing/);
    expect(check(withdraw([]), withdrawal)).toThrow(/less than the amount you are withdrawing/);
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

  it('shortens an expiry beyond the app window, then passes verification', () => {
    const now = Math.floor(Date.now() / 1000);
    const longLived = new TransactionBuilder(new Account(ACCOUNT, '100'), {
      fee: '100',
      networkPassphrase: Networks.PUBLIC,
      timebounds: { minTime: 0, maxTime: now + 30 * 86_400 },
    })
      .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
      .build();
    const shortened = TransactionBuilder.fromXDR(withExpiry(longLived.toXDR(), 'mainnet'), Networks.PUBLIC) as Transaction;
    expect(Number(shortened.timeBounds?.maxTime)).toBeLessThanOrEqual(now + 86_400 + 5);
    expect(shortened.sequence).toBe(longLived.sequence);
    expect(shortened.fee).toBe(longLived.fee);
  });
});
