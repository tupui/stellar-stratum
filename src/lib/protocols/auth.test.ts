import { describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  Asset,
  hash,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { accountMovements, authNodes } from './auth';
import { analyzeOperations } from './detect';

const ACCOUNT = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();

const AGGREGATOR = 'CARVQXFP4JF5ELLXUMQ6DALR346YVGBMQOHB4ENA7SSVXAYABXLBDDC4';
const ROUTER = 'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH';
const VAULT = 'CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK';
const XLM = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const USDC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const PAIR = 'CDN3LLHWKQKSKABVUGRB5TARVRSCM7H34SWUQ4AF53PS3QO66FMZACYB';
// Stand-in for attacker code reached through a hop of the route.
const EVIL = StrKey.encodeContract(hash('evil hop'));

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

const addressAuth = (signer: string, root: xdr.SorobanAuthorizedInvocation) =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(signer).toScAddress(),
        nonce: 1n,
        signatureExpirationLedger: 1234,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: root,
  });

/** Operations as the signing screen gets them: built, serialised, parsed back. */
const operationsOf = (op: xdr.Operation, source = ACCOUNT) => {
  const built = new TransactionBuilder(new Account(source, '100'), { fee: '100000', networkPassphrase: Networks.PUBLIC })
    .addOperation(op)
    .setTimeout(3600)
    .build();
  return (TransactionBuilder.fromXDR(built.toXDR(), Networks.PUBLIC) as Transaction).operations;
};

const invoke = (contract: string, fn: string, args: xdr.ScVal[], auth: xdr.SorobanAuthorizationEntry[]) =>
  operationsOf(Operation.invokeContractFunction({ contract, function: fn, args, auth }));

// --- The aggregator swap the Soroswap API builds: sell 1 XLM for at least 0.2147305 USDC ---

const distribution = (path: string[]) =>
  xdr.ScVal.scvVec([
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('bytes'), val: xdr.ScVal.scvVoid() }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('parts'), val: xdr.ScVal.scvU32(10) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('path'), val: nativeToScVal(path.map((c) => new Address(c))) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('protocol_id'), val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Soroswap')]) }),
    ]),
  ]);

const swapArgs = (path = [XLM, USDC]) => [
  address(ACCOUNT),
  address(XLM),
  i128(10_000_000n),
  address(USDC),
  i128(2_147_305n),
  distribution(path),
  xdr.ScVal.scvVoid(),
];

const swapOps = (subs: xdr.SorobanAuthorizedInvocation[], extra: xdr.SorobanAuthorizationEntry[] = [], path?: string[]) => {
  const args = swapArgs(path);
  return invoke(AGGREGATOR, 'swap_exact_in', args, [sourceAuth(call(AGGREGATOR, 'swap_exact_in', args, subs)), ...extra]);
};

const legitTransfer = () => transfer(XLM, ACCOUNT, AGGREGATOR, 10_000_000n);

describe('authorization tree decoding', () => {
  it('decodes nested sub-invocations, naming token arguments and flagging moves of the account', () => {
    const hop = call(EVIL, 'swap', [i128(1n)], [
      call(USDC, 'transfer_from', [address(ACCOUNT), address(OTHER), address(EVIL), i128(7n)]),
      call(USDC, 'approve', [address(ACCOUNT), address(EVIL), i128(9n), xdr.ScVal.scvU32(100)]),
      // Another holder's tokens: shown, but not a move of the signing account's.
      transfer(USDC, OTHER, EVIL, 3n),
    ]);
    const [decoded] = analyzeOperations(swapOps([legitTransfer(), hop]), 'mainnet', ACCOUNT);

    const [entry] = decoded.auth;
    expect(entry).toMatchObject({ credential: 'source', address: ACCOUNT, rootIsCall: true });
    expect(entry.root).toMatchObject({ contractId: AGGREGATOR, functionName: 'swap_exact_in' });
    // The root is the call itself: its arguments carry the protocol's names.
    expect(entry.root.args.map((a) => a.name)).toEqual(['from', 'token_in', 'amount_in', 'token_out', 'amount_out_min', 'distribution', 'options']);

    const [first, nested] = entry.root.subInvocations;
    expect(first.movement).toEqual({ kind: 'transfer', token: XLM, from: ACCOUNT, to: AGGREGATOR, amount: '10000000' });
    expect(nested).toMatchObject({ contractId: EVIL, functionName: 'swap' });
    const [pull, approval, foreign] = nested.subInvocations;
    expect(pull.args.map((a) => a.name)).toEqual(['spender', 'from', 'to', 'amount']);
    expect(pull.movement).toEqual({ kind: 'transfer_from', token: USDC, from: OTHER, to: EVIL, spender: ACCOUNT, amount: '7' });
    expect(approval.movement).toMatchObject({ kind: 'approve', from: ACCOUNT, to: EVIL, amount: '9' });
    expect(foreign.movement).toBeUndefined();

    expect(authNodes(decoded.auth)).toHaveLength(6);
    expect(accountMovements(decoded.auth, ACCOUNT).map(({ movement }) => movement.kind)).toEqual(['transfer', 'transfer_from', 'approve']);
    // Moved tokens are looked up for names and decimals.
    expect(decoded.tokens).toEqual(expect.arrayContaining([XLM, USDC]));
  });

  it('reads a separately signed entry as its signer\'s, not the source account\'s', () => {
    const args = swapArgs();
    const ops = invoke(AGGREGATOR, 'swap_exact_in', args, [addressAuth(OTHER, call(AGGREGATOR, 'swap_exact_in', args, [transfer(XLM, OTHER, AGGREGATOR, 1n)]))]);
    const [decoded] = analyzeOperations(ops, 'mainnet', ACCOUNT);
    expect(decoded.auth[0]).toMatchObject({ credential: 'address', address: OTHER, expirationLedger: 1234 });
    expect(decoded.auth[0].root.subInvocations[0].movement).toMatchObject({ from: OTHER });
    expect(accountMovements(decoded.auth, ACCOUNT)).toHaveLength(0);
  });

  it('reads a muxed transaction source as its base account', () => {
    const muxed = StrKey.encodeMed25519PublicKey(Buffer.concat([StrKey.decodeEd25519PublicKey(ACCOUNT), Buffer.alloc(8)]));
    const [decoded] = analyzeOperations(swapOps([legitTransfer()]), 'mainnet', muxed);
    expect(decoded.source).toBe(ACCOUNT);
    expect(decoded.match?.confidence).toBe('verified');
  });

  it('renders the aggregator distribution as route hops and names the payer', () => {
    const [decoded] = analyzeOperations(swapOps([legitTransfer()], [], [XLM, EVIL, USDC]), 'mainnet', ACCOUNT);
    expect(decoded.details).toMatchObject({
      kind: 'swap',
      from: ACCOUNT,
      hops: [{ protocol: 'Soroswap', path: [XLM, EVIL, USDC], parts: 10 }],
    });
    expect(decoded.tokens).toContain(EVIL);
  });
});

describe('verified status follows the authorization scope', () => {
  it('keeps a swap verified when it only authorises itself and the sold amount', () => {
    const [decoded] = analyzeOperations(swapOps([legitTransfer()]), 'mainnet', ACCOUNT);
    expect(decoded.match?.confidence).toBe('verified');
    expect(decoded.authIssues).toEqual([]);
  });

  it('drops verified for an extra transfer to another recipient', () => {
    const [decoded] = analyzeOperations(swapOps([legitTransfer(), transfer(XLM, ACCOUNT, OTHER, 1n)]), 'mainnet', ACCOUNT);
    expect(decoded.match?.confidence).toBe('unsafe');
    expect(decoded.authIssues).toEqual(['Also authorises calls or transfers the summary above does not show.']);
  });

  it('drops verified for a transfer of another token, even nested under a hop', () => {
    const drain = call(EVIL, 'swap', [], [transfer(USDC, ACCOUNT, OTHER, 5_000_000n)]);
    const [decoded] = analyzeOperations(swapOps([legitTransfer(), drain]), 'mainnet', ACCOUNT);
    expect(decoded.match?.confidence).toBe('unsafe');
    const [direct] = analyzeOperations(swapOps([transfer(USDC, ACCOUNT, OTHER, 1n)]), 'mainnet', ACCOUNT);
    expect(direct.match?.confidence).toBe('unsafe');
  });

  it('drops verified for a second entry rooted elsewhere or signed by someone else', () => {
    const [rooted] = analyzeOperations(
      swapOps([legitTransfer()], [sourceAuth(transfer(USDC, ACCOUNT, OTHER, 1n))]),
      'mainnet',
      ACCOUNT,
    );
    expect(rooted.match?.confidence).toBe('unsafe');
    expect(rooted.authIssues).toContain('Authorises a different call than the one it makes.');

    const args = swapArgs();
    const [separate] = analyzeOperations(
      swapOps([legitTransfer()], [addressAuth(OTHER, call(AGGREGATOR, 'swap_exact_in', args))]),
      'mainnet',
      ACCOUNT,
    );
    expect(separate.match?.confidence).toBe('unsafe');
    expect(separate.authIssues[0]).toMatch(/^Needs an authorization signed separately by/);
  });

  it('drops verified when the swap pays out to another account than the signer', () => {
    const args = [i128(10_000_000n), i128(2_147_305n), nativeToScVal([XLM, USDC].map((c) => new Address(c))), address(OTHER), nativeToScVal(1_900_000_000, { type: 'u64' })];
    const ops = invoke(ROUTER, 'swap_exact_tokens_for_tokens', args, [
      sourceAuth(call(ROUTER, 'swap_exact_tokens_for_tokens', args, [transfer(XLM, ACCOUNT, PAIR, 10_000_000n)])),
    ]);
    const [decoded] = analyzeOperations(ops, 'mainnet', ACCOUNT);
    expect(decoded.match?.confidence).toBe('unsafe');
    expect(decoded.authIssues[0]).toMatch(/^Sets to to .*, not the signing account\.$/);
  });

  it('flags without downgrading when the signing account is unknown, so verify.ts keeps its own wording', () => {
    const [decoded] = analyzeOperations(swapOps([legitTransfer(), transfer(XLM, OTHER, OTHER, 1n)]), 'mainnet');
    expect(decoded.match?.confidence).toBe('verified');
    // Amounts are then bounded across every transfer, whoever they are from.
    expect(decoded.authIssues).toHaveLength(1);
  });

  it('accepts the liquidity and vault calls the app builds', () => {
    const deadline = nativeToScVal(1_900_000_000, { type: 'u64' });
    const removeArgs = [address(XLM), address(USDC), i128(1_000_000n), i128(1n), i128(1n), address(ACCOUNT), deadline];
    const [removal] = analyzeOperations(
      invoke(ROUTER, 'remove_liquidity', removeArgs, [sourceAuth(call(ROUTER, 'remove_liquidity', removeArgs, [transfer(PAIR, ACCOUNT, PAIR, 1_000_000n)]))]),
      'mainnet',
      ACCOUNT,
    );
    expect(removal.match?.confidence).toBe('verified');
    // Shares must go back to the pair that burns them, not elsewhere.
    const [skim] = analyzeOperations(
      invoke(ROUTER, 'remove_liquidity', removeArgs, [sourceAuth(call(ROUTER, 'remove_liquidity', removeArgs, [transfer(USDC, ACCOUNT, OTHER, 1_000_000n)]))]),
      'mainnet',
      ACCOUNT,
    );
    expect(skim.match?.confidence).toBe('unsafe');

    const depositArgs = [nativeToScVal([i128(10_000_000n)]), nativeToScVal([i128(10_000_000n)]), address(ACCOUNT), nativeToScVal(false)];
    const [deposit] = analyzeOperations(
      invoke(VAULT, 'deposit', depositArgs, [sourceAuth(call(VAULT, 'deposit', depositArgs, [transfer(USDC, ACCOUNT, VAULT, 10_000_000n)]))]),
      'mainnet',
      ACCOUNT,
    );
    expect(deposit.match?.confidence).toBe('verified');
  });
});

describe('contract deployments and uploads', () => {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const wasmHash = Buffer.from(hash(wasm)).toString('hex');

  it('decodes createContractV2 with its constructor and treats it as unknown', () => {
    const salt = Buffer.alloc(32, 7);
    const ops = operationsOf(
      Operation.createCustomContract({
        address: new Address(ACCOUNT),
        wasmHash: hash(wasm),
        salt,
        constructorArgs: [address(OTHER), i128(5n)],
        auth: [],
      }),
    );
    const [decoded] = analyzeOperations(ops, 'mainnet', ACCOUNT);
    expect(decoded).toMatchObject({ functionName: 'createContractV2', match: null, intent: null, details: null });
    expect(decoded.deploy).toMatchObject({
      kind: 'create-contract',
      wasmHash,
      deployer: ACCOUNT,
      salt: salt.toString('hex'),
      constructorArgs: [{ value: OTHER }, { value: '5' }],
    });
    expect(StrKey.isValidContract(decoded.contractId)).toBe(true);
  });

  it('computes the address a wrapped asset gets and decodes the constructor\'s authorization', () => {
    const asset = new Asset('USDC', OTHER);
    const create = new xdr.CreateContractArgs({
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(asset.toXDRObject()),
      executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
    });
    const drain = sourceAuth(transfer(USDC, ACCOUNT, OTHER, 42n));
    const ops = operationsOf(
      Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeCreateContract(create), auth: [drain] }),
    );
    const [decoded] = analyzeOperations(ops, 'mainnet', ACCOUNT);
    expect(decoded.deploy).toMatchObject({ kind: 'create-contract', asset: `USDC:${OTHER}` });
    expect(decoded.contractId).toBe(asset.contractId(Networks.PUBLIC));
    expect(decoded.auth[0].rootIsCall).toBe(false);
    expect(accountMovements(decoded.auth, ACCOUNT)).toHaveLength(1);
  });

  it('decodes a WASM upload', () => {
    const [decoded] = analyzeOperations(operationsOf(Operation.uploadContractWasm({ wasm })), 'mainnet', ACCOUNT);
    expect(decoded).toMatchObject({ functionName: 'uploadContractWasm', match: null });
    expect(decoded.deploy).toEqual({ kind: 'upload-wasm', wasmHash, size: wasm.length });
  });
});
