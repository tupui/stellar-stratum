/**
 * Build the transaction for the operations assembled in the payment form.
 *
 * Everything is checked against live Horizon state at build time, since the transaction may
 * wait hours for its co-signers: destinations and their trustlines, what the source can
 * actually spend after its minimum reserve, and path-payment limits from real order books.
 * Anything that would make the network reject the transaction is refused here instead.
 */
import { Address, Asset, Horizon, Memo, Operation, StrKey, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { Decimal } from 'decimal.js';
import { appConfig } from './appConfig';
import { minimumBalance } from './balance-utils';
import { baseAccountId } from './signatures';
import { passphraseFor, type NetworkId } from './xdr/parse';

export interface PaymentOperationInput {
  /** An account (G…), a muxed account (M…) or a contract (C…). */
  destination: string;
  amount: string;
  asset: string;
  assetIssuer?: string;
  receiveAsset?: string;
  receiveAssetIssuer?: string;
  /** Exact-out: what the destination receives. Exact-in: an optional minimum the user set. */
  receiveAmount?: string;
  /** Percent, e.g. 0.5 */
  slippageTolerance?: number;
  exactOut?: boolean;
  isAccountClosure?: boolean;
}

export interface MemoInput {
  type: 'text' | 'id';
  value: string;
}

type Balance = Horizon.HorizonApi.BalanceLine;

const toAsset = (code: string, issuer?: string) => (code === 'XLM' && !issuer ? Asset.native() : new Asset(code, issuer));
const assetId = (asset: Asset) => (asset.isNative() ? 'native' : `${asset.getCode()}:${asset.getIssuer()}`);
const assetName = (asset: Asset) => (asset.isNative() ? 'XLM' : asset.getCode());
const short = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;
const amountString = (value: Decimal, rounding: Decimal.Rounding) => value.toDecimalPlaces(7, rounding).toFixed(7);

const findLine = (balances: Balance[], asset: Asset) =>
  balances.find((b) =>
    asset.isNative()
      ? b.asset_type === 'native'
      : 'asset_code' in b && b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );

const isNotFound = (error: unknown) => {
  const err = error as { name?: string; response?: { status?: number } };
  return err?.name === 'NotFoundError' || err?.response?.status === 404;
};

const recordAsset = (r: { asset_type: string; asset_code?: string; asset_issuer?: string }) =>
  r.asset_type === 'native' ? Asset.native() : new Asset(r.asset_code!, r.asset_issuer);

/** What a payment to a contract needs from Soroban RPC: ledger entries and the simulation. */
export type SorobanServer = Pick<rpc.Server, 'getContractData' | 'prepareTransaction'>;

const sorobanServer = (network: NetworkId): SorobanServer =>
  new rpc.Server(network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC);

const contractExists = async (soroban: SorobanServer, contractId: string): Promise<boolean> => {
  try {
    await soroban.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance());
    return true;
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 404) return false;
    throw new Error(`Could not check contract ${short(contractId)}. Check your connection and try again.`, { cause: error });
  }
};

/**
 * A contract holds no trustline and takes no payment operation: it is paid by calling `transfer`
 * on the asset's contract, which the simulation checks against the live ledger. Such a
 * transaction holds that single operation and no memo.
 */
async function buildContractTransfer(
  server: Horizon.Server,
  sourceId: string,
  network: NetworkId,
  op: PaymentOperationInput,
  memo: MemoInput,
  soroban: SorobanServer,
): Promise<string> {
  const destination = op.destination.trim();
  if (op.isAccountClosure) throw new Error('An account cannot be merged into a contract.');
  const asset = toAsset(op.asset, op.assetIssuer);
  if (op.receiveAsset && !toAsset(op.receiveAsset, op.receiveAssetIssuer).equals(asset)) {
    throw new Error(`A contract can only be sent the asset itself: convert to ${op.receiveAsset} first.`);
  }
  if (memo.value) throw new Error('A payment to a contract cannot carry a memo. Remove the memo.');
  const amount = new Decimal(op.amount);
  if (!amount.gt(0)) throw new Error('Enter an amount.');

  // Nothing can move what is sent to an address where no contract lives (a contract of another network, say).
  if (!(await contractExists(soroban, destination))) {
    throw new Error(`There is no contract at ${short(destination)} on ${network === 'testnet' ? 'Testnet' : 'Mainnet'}.`);
  }
  const assetContract = asset.contractId(passphraseFor(network));
  if (!(await contractExists(soroban, assetContract))) {
    throw new Error(`${assetName(asset)} has no asset contract on this network yet, so it cannot be sent to a contract.`);
  }

  const source = await server.loadAccount(sourceId);
  const builder = new TransactionBuilder(source, {
    fee: appConfig.DEFAULT_BASE_FEE_STROOPS.toString(),
    networkPassphrase: passphraseFor(network),
  });
  builder.addOperation(Operation.invokeContractFunction({
    contract: assetContract,
    function: 'transfer',
    args: [
      new Address(sourceId).toScVal(),
      new Address(destination).toScVal(),
      nativeToScVal(BigInt(amount.times(1e7).toFixed(0, Decimal.ROUND_DOWN)), { type: 'i128' }),
    ],
  }));
  builder.setTimeout(appConfig.TX_VALIDITY_SECONDS);
  try {
    return (await soroban.prepareTransaction(builder.build())).toXDR();
  } catch (error) {
    // The first line says what failed; the rest is the host's event log.
    const reason = (error instanceof Error ? error.message : String(error)).split('\n')[0];
    throw new Error(
      /Contract, #10\b/.test(reason)
        ? `This account cannot spend ${amount.toFixed()} ${assetName(asset)} (after the minimum reserve and open offers).`
        : `${assetName(asset)} cannot be sent to ${short(destination)}: ${reason}`,
      { cause: error },
    );
  }
}

export async function buildPaymentTransaction(
  server: Horizon.Server,
  sourceId: string,
  network: NetworkId,
  operations: PaymentOperationInput[],
  memo: MemoInput,
  soroban: SorobanServer = sorobanServer(network),
): Promise<string> {
  if (operations.length === 0) throw new Error('Add at least one operation.');
  if (operations.some((op) => StrKey.isValidContract(op.destination.trim()))) {
    if (operations.length > 1) {
      throw new Error('A payment to a contract (C…) must be the only operation of its transaction. Send it separately.');
    }
    return buildContractTransfer(server, sourceId, network, operations[0], memo, soroban);
  }
  const mergeIndex = operations.findIndex((op) => op.isAccountClosure);
  if (mergeIndex !== -1 && mergeIndex !== operations.length - 1) {
    throw new Error('The account merge must be the last operation: nothing can run after the account is closed.');
  }
  const source = await server.loadAccount(sourceId);
  const fee = appConfig.DEFAULT_BASE_FEE_STROOPS;
  const builder = new TransactionBuilder(source, { fee: fee.toString(), networkPassphrase: passphraseFor(network) });
  let opCount = 0;
  const add = (operation: Parameters<TransactionBuilder['addOperation']>[0]) => {
    builder.addOperation(operation);
    opCount += 1;
  };

  const destinations = new Map<string, Horizon.AccountResponse | null>();
  /** Looked up by base account: Horizon only knows accounts by their G… address. */
  const loadDestination = async (address: string) => {
    const id = baseAccountId(address);
    if (!destinations.has(id)) {
      try {
        destinations.set(id, await server.loadAccount(id));
      } catch (error) {
        if (!isNotFound(error)) throw new Error(`Could not check destination ${short(id)}. Check your connection and try again.`, { cause: error });
        destinations.set(id, null);
      }
    }
    return destinations.get(id)!;
  };
  const created = new Set<string>();
  const outflow = new Map<string, Decimal>();
  const spend = (asset: Asset, amount: Decimal) =>
    outflow.set(assetId(asset), (outflow.get(assetId(asset)) ?? new Decimal(0)).plus(amount));

  /** The destination must hold an authorised trustline with room for `amount` (when known). */
  const checkTrustline = (account: Horizon.AccountResponse, asset: Asset, amount?: Decimal) => {
    if (asset.isNative()) return;
    const line = findLine(account.balances, asset);
    if (!line || !('limit' in line)) {
      throw new Error(`${short(account.accountId())} has no trustline for ${assetName(asset)} (${short(asset.getIssuer())}), so it cannot receive it.`);
    }
    if ('is_authorized' in line && line.is_authorized === false) {
      throw new Error(`The issuer has not authorised ${short(account.accountId())} to hold ${assetName(asset)}.`);
    }
    if (amount && new Decimal(line.limit).minus(line.balance).lt(amount)) {
      throw new Error(`${short(account.accountId())} would exceed its ${assetName(asset)} trustline limit.`);
    }
  };

  let merged = false;
  for (const [index, op] of operations.entries()) {
    const label = `Operation ${index + 1}`;
    const destination = op.destination.trim();
    // A muxed (M…) destination is the account behind it, with an ID the recipient reads.
    const destinationAccount = baseAccountId(destination);

    if (op.isAccountClosure) {
      if (destinationAccount === sourceId) throw new Error('An account cannot be merged into itself.');
      if (!(await loadDestination(destination))) throw new Error(`${label}: the merge destination does not exist.`);
      if (Number(source.num_sponsoring ?? 0) > 0) throw new Error('This account sponsors other entries and cannot be merged.');
      const trustlines = source.balances.filter((b) => b.asset_type !== 'native');
      if (trustlines.some((b) => b.asset_type === 'liquidity_pool_shares')) {
        throw new Error('Withdraw from your liquidity pools before merging this account.');
      }
      const extraSigners = source.signers.filter((s) => s.key !== sourceId).length;
      if (source.subentry_count !== extraSigners + trustlines.length) {
        throw new Error('This account still has open offers or data entries, so it cannot be merged.');
      }
      for (const line of trustlines) {
        if (!('asset_code' in line)) continue;
        const asset = new Asset(line.asset_code, line.asset_issuer);
        if (!new Decimal(line.balance).minus(outflow.get(assetId(asset)) ?? 0).eq(0)) {
          throw new Error(`Send all your ${line.asset_code} before merging: a trustline can only be removed when empty.`);
        }
        add(Operation.changeTrust({ asset, limit: '0' }));
      }
      add(Operation.accountMerge({ destination }));
      merged = true;
      continue;
    }

    const sendAsset = toAsset(op.asset, op.assetIssuer);
    const destAsset = op.receiveAsset ? toAsset(op.receiveAsset, op.receiveAssetIssuer) : sendAsset;
    const isPath = !destAsset.equals(sendAsset);
    const slippage = new Decimal(op.slippageTolerance ?? 0.5).div(100);
    const account = created.has(destinationAccount) ? null : await loadDestination(destination);

    if (!account && !created.has(destinationAccount)) {
      // Unfunded destination: only a createAccount with XLM can reach it.
      if (isPath || !sendAsset.isNative()) {
        throw new Error(`${label}: ${short(destination)} does not exist yet. Send it at least 1 XLM first to create it.`);
      }
      // createAccount takes no muxed ID, so the ID would be silently dropped.
      if (destination !== destinationAccount) {
        throw new Error(`${label}: the account behind ${short(destination)} does not exist yet. Create it by sending to its G… address first.`);
      }
      const amount = new Decimal(op.amount);
      if (amount.lt(1)) throw new Error(`${label}: creating ${short(destination)} requires at least 1 XLM.`);
      add(Operation.createAccount({ destination, startingBalance: amountString(amount, Decimal.ROUND_DOWN) }));
      spend(sendAsset, amount);
      created.add(destinationAccount);
      continue;
    }
    if (!account) {
      // Created earlier in this transaction: it has no trustlines yet.
      if (!destAsset.isNative()) throw new Error(`${label}: ${short(destination)} is created by this transaction and cannot hold ${assetName(destAsset)} yet.`);
    }

    if (!isPath) {
      const amount = new Decimal(op.amount);
      if (account) checkTrustline(account, destAsset, amount);
      add(Operation.payment({ destination, asset: sendAsset, amount: amountString(amount, Decimal.ROUND_DOWN) }));
      spend(sendAsset, amount);
      continue;
    }

    if (op.exactOut) {
      const destAmount = new Decimal(op.receiveAmount || '0');
      if (destAmount.lte(0)) throw new Error(`${label}: enter the amount to receive.`);
      if (account) checkTrustline(account, destAsset, destAmount);
      const { records } = await server.strictReceivePaths([sendAsset], destAsset, amountString(destAmount, Decimal.ROUND_UP)).call();
      const best = records
        .filter((r) => recordAsset({ asset_type: r.source_asset_type, asset_code: r.source_asset_code, asset_issuer: r.source_asset_issuer }).equals(sendAsset))
        .sort((a, b) => new Decimal(a.source_amount).cmp(b.source_amount))[0];
      if (!best) throw new Error(`${label}: no market path from ${assetName(sendAsset)} to ${assetName(destAsset)} right now.`);
      const sendMax = new Decimal(best.source_amount).times(slippage.plus(1));
      add(Operation.pathPaymentStrictReceive({
        sendAsset,
        sendMax: amountString(sendMax, Decimal.ROUND_UP),
        destination,
        destAsset,
        destAmount: amountString(destAmount, Decimal.ROUND_UP),
        path: best.path.map(recordAsset),
      }));
      spend(sendAsset, sendMax);
      continue;
    }

    const sendAmount = new Decimal(op.amount);
    const { records } = await server.strictSendPaths(sendAsset, amountString(sendAmount, Decimal.ROUND_DOWN), [destAsset]).call();
    const best = records
      .filter((r) => recordAsset({ asset_type: r.destination_asset_type, asset_code: r.destination_asset_code, asset_issuer: r.destination_asset_issuer }).equals(destAsset))
      .sort((a, b) => new Decimal(b.destination_amount).cmp(a.destination_amount))[0];
    if (!best) throw new Error(`${label}: no market path from ${assetName(sendAsset)} to ${assetName(destAsset)} right now.`);
    const quoted = new Decimal(best.destination_amount);
    const userMin = op.receiveAmount ? new Decimal(op.receiveAmount) : null;
    if (userMin && quoted.lt(userMin)) {
      throw new Error(`${label}: the best price now gives ${quoted.toFixed()} ${assetName(destAsset)}, below your minimum of ${userMin.toFixed()}.`);
    }
    const destMin = Decimal.max(quoted.times(new Decimal(1).minus(slippage)), userMin ?? 0);
    if (account) checkTrustline(account, destAsset, destMin);
    add(Operation.pathPaymentStrictSend({
      sendAsset,
      sendAmount: amountString(sendAmount, Decimal.ROUND_DOWN),
      destination,
      destAsset,
      destMin: amountString(destMin, Decimal.ROUND_DOWN),
      path: best.path.map(recordAsset),
    }));
    spend(sendAsset, sendAmount);
  }

  // Everything sent must be spendable now: balance minus open offers and, for XLM, the reserve and fee.
  const feeXlm = new Decimal(fee).times(opCount).div(1e7);
  for (const [id, amount] of outflow) {
    const asset = id === 'native' ? Asset.native() : new Asset(id.split(':')[0], id.split(':')[1]);
    const line = findLine(source.balances, asset);
    if (!line) throw new Error(`This account does not hold ${assetName(asset)}.`);
    let available = new Decimal(line.balance).minus('selling_liabilities' in line ? line.selling_liabilities : 0);
    if (asset.isNative() && !merged) {
      available = available.minus(minimumBalance({ subentry_count: source.subentry_count, num_sponsoring: Number(source.num_sponsoring ?? 0), num_sponsored: Number(source.num_sponsored ?? 0) })).minus(feeXlm);
    }
    if (amount.gt(available)) {
      throw new Error(
        `This transaction sends up to ${amount.toFixed()} ${assetName(asset)}, but only ${Decimal.max(available, 0).toFixed()} can be spent` +
          (asset.isNative() ? ' after the minimum reserve and the fee.' : '.'),
      );
    }
  }

  if (memo.value) builder.addMemo(memo.type === 'id' ? Memo.id(memo.value) : Memo.text(memo.value));
  builder.setTimeout(appConfig.TX_VALIDITY_SECONDS);
  return builder.build().toXDR();
}
