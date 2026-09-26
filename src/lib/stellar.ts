import { appConfig } from './appConfig';
import { submitLog } from './submitLog';
import { getHorizonUrls } from './horizonSettings';
import { getTransactionHash } from './xdr/parse';

import { AccountRequiresMemoError, Horizon, Transaction, TransactionBuilder, type FeeBumpTransaction } from '@stellar/stellar-sdk';

// Network configuration using centralized config. The Horizon URL honours the user's
// endpoint settings (custom endpoints and disabled mirrors), see horizonSettings.ts.
const getNetworkConfig = (network: 'mainnet' | 'testnet') => ({
  passphrase: network === 'testnet' ? appConfig.TESTNET_PASSPHRASE : appConfig.MAINNET_PASSPHRASE,
  horizonUrl: getHorizonUrls(network)[0],
});

export const getNetworkPassphrase = (network: 'mainnet' | 'testnet') => getNetworkConfig(network).passphrase;
export const getHorizonUrl = (network: 'mainnet' | 'testnet') => getNetworkConfig(network).horizonUrl;
export { getHorizonUrls };

export const createHorizonServer = (network: 'mainnet' | 'testnet' = 'mainnet', customUrl?: string) => {
  const config = getNetworkConfig(network);
  return new Horizon.Server(customUrl || config.horizonUrl);
};

export interface AccountData {
  publicKey: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
    /** Amount locked in open sell offers; it cannot be spent. */
    selling_liabilities?: string;
    limit?: string;
    liquidity_pool_id?: string;
  }>;
  /** Trustlines, offers, data entries and extra signers: each needs 0.5 XLM of reserve. */
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: Array<{
    key: string;
    weight: number;
    type: string;
  }>;
}

// Narrow the various shapes Horizon errors can take without leaking `any`.
type HorizonErrorShape = {
  name?: string;
  message?: string;
  response?: {
    status?: number;
    type?: string;
    data?: {
      title?: string;
      detail?: string;
      extras?: {
        hash?: string;
        result_codes?: { transaction?: string; operations?: string[] };
        result_xdr?: string;
        envelope_xdr?: string;
      };
    };
  };
};
const asHorizonError = (error: unknown): HorizonErrorShape => (error && typeof error === 'object' ? (error as HorizonErrorShape) : {});

export const fetchAccountData = async (publicKey: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<AccountData> => {
  try {
    const server = createHorizonServer(network);
    const account = await server.loadAccount(publicKey);

    return {
      publicKey,
      balances: account.balances.map((balance) => {
        const baseBalance = {
          asset_type: balance.asset_type,
          balance: balance.balance,
          ...('selling_liabilities' in balance ? { selling_liabilities: balance.selling_liabilities } : {}),
          ...('limit' in balance ? { limit: balance.limit } : {}),
        };
        if (balance.asset_type === 'liquidity_pool_shares' && 'liquidity_pool_id' in balance) {
          return { ...baseBalance, liquidity_pool_id: balance.liquidity_pool_id };
        }
        if (balance.asset_type !== 'native' && 'asset_code' in balance) {
          return {
            ...baseBalance,
            asset_code: balance.asset_code,
            asset_issuer: balance.asset_issuer,
          };
        }
        return baseBalance;
      }),
      subentry_count: account.subentry_count,
      num_sponsoring: account.num_sponsoring ?? 0,
      num_sponsored: account.num_sponsored ?? 0,
      thresholds: {
        low_threshold: account.thresholds.low_threshold,
        med_threshold: account.thresholds.med_threshold,
        high_threshold: account.thresholds.high_threshold,
      },
      signers: account.signers.map((signer) => ({
        key: signer.key,
        weight: signer.weight,
        type: signer.type,
      })),
    };
  } catch (error) {
    const err = asHorizonError(error);
    const isNotFound =
      err.name === 'NotFoundError' ||
      err.response?.status === 404 ||
      err.response?.type === 'https://stellar.org/horizon-errors/not_found';
    if (isNotFound) {
      const networkName = network === 'mainnet' ? 'Mainnet' : 'Testnet';
      throw new Error(
        `Account not found on Stellar ${networkName}. ` +
          `This account doesn't exist yet. To use this account, you need to either: ` +
          `1) Switch to the correct network, or 2) Fund the account first to activate it on ${networkName}.`,
        { cause: error },
      );
    }
    const original = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load account data from Horizon: ${original}`, { cause: error });
  }
};

// Submission progress is reported through submitLog (shown in the SubmissionTerminal and,
// in dev builds, mirrored to the console). Horizon holds the request open until the tx is
// included in a ledger (or ~30s+ until it gives up with a 504 tx_timeout), so the timings
// show where the time goes and exactly what Horizon answered.
/** Resource fee declared by a Soroban transaction (0 for classic transactions). */
const getSorobanResourceFee = (transaction: Transaction | FeeBumpTransaction): number => {
  try {
    const inner = 'innerTransaction' in transaction ? transaction.innerTransaction : transaction;
    const envelope = inner.toEnvelope();
    if (envelope.type !== 'envelopeTypeTx') return 0;
    const { ext } = envelope.v1.tx;
    if (ext.type !== 'sorobanData') return 0;
    return Number(ext.sorobanData.resourceFee);
  } catch {
    return 0;
  }
};

interface InclusionFeeMarket {
  min: number;
  p50: number;
  p90: number;
  max: number;
  ledgerCount: number;
}

/**
 * Inclusion-fee percentiles from Soroban RPC getFeeStats, which separates the Soroban
 * lane from the classic lane (Horizon's fee_stats mixes resource fees into the numbers).
 */
const fetchInclusionFeeMarket = async (network: 'mainnet' | 'testnet', soroban: boolean): Promise<InclusionFeeMarket> => {
  const rpcUrl = network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC;
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getFeeStats' }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`getFeeStats HTTP ${response.status}`);
  const body = (await response.json()) as { result?: Record<string, Record<string, string>> };
  const stats = body.result?.[soroban ? 'sorobanInclusionFee' : 'inclusionFee'];
  if (!stats) throw new Error('getFeeStats returned no inclusion fee stats');
  return {
    min: Number(stats.min),
    p50: Number(stats.p50),
    p90: Number(stats.p90),
    max: Number(stats.max),
    ledgerCount: Number(stats.ledgerCount),
  };
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Look a transaction hash up on every known Horizon; first hit wins, a slow mirror can't stall it. */
const findTransactionAnywhere = async (
  hash: string,
  urls: string[],
): Promise<Horizon.ServerApi.TransactionRecord | null> => {
  const lookups = urls.map(async (url) => {
    const record = await Promise.race([
      new Horizon.Server(url).transactions().transaction(hash).call(),
      sleep(5_000).then(() => null),
    ]);
    if (!record) throw new Error('not found');
    return record;
  });
  try {
    return await Promise.any(lookups);
  } catch {
    return null;
  }
};

/** Plain-language reasons for the result codes people actually hit. */
const RESULT_CODE_HINTS: Record<string, string> = {
  tx_bad_seq: 'the sequence number was already used (another transaction from this account went through first). Rebuild the transaction and collect the signatures again',
  tx_too_late: 'the transaction expired before it was submitted. Rebuild it and collect the signatures again',
  tx_too_early: 'the transaction is not valid yet (its time bounds start later)',
  tx_bad_auth: 'the signatures do not reach the required threshold, or one was made for another network',
  tx_bad_auth_extra: 'the transaction carries a signature that is not needed; remove it and submit again',
  tx_insufficient_balance: 'the source account cannot pay the fee',
  tx_insufficient_fee: 'the fee is too low for current network load',
  op_underfunded: 'an account does not hold enough of the asset being sent (keep the minimum XLM reserve in mind)',
  op_low_reserve: 'the operation would leave an account below its minimum XLM reserve',
  op_no_trust: 'the destination has no trustline for the asset',
  op_not_authorized: 'the issuer has not authorised this trustline',
  op_line_full: 'the destination trustline limit would be exceeded',
  op_no_destination: 'the destination account does not exist; send at least 1 XLM to create it',
  op_under_dest_min: 'the path payment would deliver less than the minimum (the price moved)',
  op_over_source_max: 'the path payment would cost more than the maximum (the price moved)',
  op_too_few_offers: 'there is no market path between these assets right now',
  op_has_sub_entries: 'the account still has trustlines, offers or data entries and cannot be merged',
  op_is_sponsor: 'the account sponsors other entries and cannot be merged',
  op_bad_auth: 'an operation does not have enough signature weight for its source account',
};

type ResultCodes = { transaction?: string; operations?: string[] };

const describeResultCodes = (codes: ResultCodes): string => {
  const all = [codes.transaction, ...(codes.operations || [])].filter((c): c is string => Boolean(c) && c !== 'op_success');
  const hints = [...new Set(all.map((c) => RESULT_CODE_HINTS[c]).filter(Boolean))];
  return `${all.join(', ')}${hints.length ? `: ${hints.join('; ')}` : ''}`;
};

/**
 * Submit a signed transaction, failing over across public Horizon mirrors.
 *
 * Each Horizon gets HORIZON_SUBMIT_ATTEMPT_MS to answer. A definitive rejection
 * (HTTP 400 with result codes) stops immediately; a timeout, 5xx or network error
 * moves on to the next mirror. Because a submitted tx keeps propagating through the
 * network even when Horizon stops waiting for it, the hash is checked on every
 * mirror before any failure is reported, and polled for HORIZON_SUBMIT_POLL_MS at
 * the end.
 */
export const submitTransaction = async (
  signedXdr: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
): Promise<Horizon.HorizonApi.SubmitTransactionResponse> => {
  const startedAt = performance.now();
  const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`;
  try {
    const config = getNetworkConfig(network);
    const urls = getHorizonUrls(network);
    const transaction = TransactionBuilder.fromXdr(signedXdr, config.passphrase);
    const inner = 'innerTransaction' in transaction ? transaction.innerTransaction : transaction;
    const hash = getTransactionHash(transaction);
    submitLog.info('parsed signed envelope', {
      network,
      horizons: urls.map(hostOf),
      hash,
      source: inner.source,
      sequence: inner.sequence,
      fee: transaction.fee,
      operations: inner.operations.map((op) => op.type),
      signatures: transaction.signatures.length,
      timeBounds: inner.timeBounds,
      xdrLength: signedXdr.length,
    });

    // Priority in a busy ledger is decided by the inclusion fee alone. For a Soroban tx
    // most of the fee is the resource fee, which buys no priority, so compare the right part.
    const resourceFee = getSorobanResourceFee(transaction);
    const opCount = Math.max(1, inner.operations.length);
    const inclusionFeePerOp = (Number(transaction.fee) - resourceFee) / opCount;
    if (resourceFee > 0) {
      submitLog.info(`soroban tx: fee ${transaction.fee} = resource fee ${resourceFee} (no priority) + inclusion fee ${inclusionFeePerOp}`);
    }
    try {
      const market = await fetchInclusionFeeMarket(network, resourceFee > 0);
      const lane = resourceFee > 0 ? 'soroban' : 'classic';
      submitLog.info(`${lane} inclusion fee market (last ${market.ledgerCount} ledgers): min ${market.min}, p50 ${market.p50}, p90 ${market.p90}, max ${market.max} stroops; this tx offers ${inclusionFeePerOp}`);
      if (inclusionFeePerOp < market.p50) {
        submitLog.wait(`inclusion fee ${inclusionFeePerOp} is below the market p50 ${market.p50}: when the ${lane} lane is full, core drops the lowest-fee transactions from its queue, so this may never land. Rebuild with a higher fee (or fee-bump it).`);
      } else if (inclusionFeePerOp < market.p90) {
        submitLog.wait(`inclusion fee ${inclusionFeePerOp} is below the market p90 ${market.p90}: may wait for a less busy ledger`);
      }
    } catch (feeError) {
      submitLog.info('could not fetch fee stats', feeError);
    }

    const alreadyIncluded = (found: Horizon.ServerApi.TransactionRecord) => {
      if (!found.successful) {
        // Included in a ledger but failed: the fee and sequence number are spent, nothing else happened.
        submitLog.error(`transaction is in ledger ${found.ledger_attr} but FAILED`, { hash: found.hash, result_xdr: found.result_xdr });
        throw new Error(`The transaction was included in ledger ${found.ledger_attr} but failed, so nothing was transferred (the fee was charged).`);
      }
      submitLog.ok(`transaction is in ledger ${found.ledger_attr} after ${elapsed()}`, { hash: found.hash });
      return found as unknown as Horizon.HorizonApi.SubmitTransactionResponse;
    };

    for (const [index, url] of urls.entries()) {
      const host = hostOf(url);
      submitLog.wait(`[${index + 1}/${urls.length}] POST ${host}/transactions — waiting up to ${appConfig.HORIZON_SUBMIT_ATTEMPT_MS / 1000}s`);
      const attemptStart = performance.now();
      const attemptElapsed = () => `${Math.round(performance.now() - attemptStart)}ms`;
      try {
        const result = await Promise.race([
          new Horizon.Server(url).submitTransaction(transaction),
          sleep(appConfig.HORIZON_SUBMIT_ATTEMPT_MS).then(() => {
            throw new Error(`no answer from ${host} within ${appConfig.HORIZON_SUBMIT_ATTEMPT_MS / 1000}s`);
          }),
        ]);
        submitLog.ok(`${host} accepted the transaction after ${attemptElapsed()} (total ${elapsed()})`, { hash: result.hash, ledger: result.ledger, successful: result.successful });
        return result;
      } catch (attemptError) {
        // The SDK checks SEP-29 before posting: the destination (usually an exchange) needs a memo.
        if (attemptError instanceof AccountRequiresMemoError) {
          throw new Error(
            `${attemptError.accountId} requires a memo (it is probably an exchange deposit address). ` +
              'Add the memo they gave you and rebuild the transaction.',
            { cause: attemptError },
          );
        }
        const horizonError = asHorizonError(attemptError);
        const status = horizonError.response?.status;
        const codes = horizonError.response?.data?.extras?.result_codes;
        const isTimeout = status === 504 || codes?.transaction === 'tx_timeout' || attemptError instanceof Error && attemptError.message.startsWith('no answer');
        const isRejection = status === 400 && codes !== undefined && codes.transaction !== 'tx_timeout';

        if (isRejection) {
          // tx_bad_seq can mean an earlier attempt already got it into a ledger.
          if (codes.transaction === 'tx_bad_seq') {
            const found = await findTransactionAnywhere(hash, urls);
            if (found) return alreadyIncluded(found);
          }
          submitLog.error(`${host} rejected the transaction after ${attemptElapsed()}`, {
            status,
            title: horizonError.response?.data?.title,
            detail: horizonError.response?.data?.detail,
            result_codes: codes,
            result_xdr: horizonError.response?.data?.extras?.result_xdr,
          });
          throw attemptError;
        }

        submitLog.wait(
          isTimeout
            ? `${host} timed out after ${attemptElapsed()} (${status ?? 'client cap'}): the tx was queued but not yet in a ledger`
            : `${host} failed after ${attemptElapsed()} (status ${status ?? 'network error'}): ${horizonError.message ?? String(attemptError)}`,
        );
        const found = await findTransactionAnywhere(hash, urls);
        if (found) return alreadyIncluded(found);
        if (index < urls.length - 1) submitLog.wait(`not in a ledger yet — trying the next Horizon`);
      }
    }

    // Every Horizon has been asked. The tx may still land: poll for it before giving up.
    submitLog.wait(`all ${urls.length} Horizons tried; polling ${urls.length} endpoints for ${hash.slice(0, 12)}… for up to ${appConfig.HORIZON_SUBMIT_POLL_MS / 1000}s`);
    const deadline = performance.now() + appConfig.HORIZON_SUBMIT_POLL_MS;
    while (performance.now() < deadline) {
      await sleep(4_000);
      const found = await findTransactionAnywhere(hash, urls);
      if (found) return alreadyIncluded(found);
      submitLog.wait(`not in a ledger yet (${elapsed()})`);
    }
    throw new Error(
      `No Horizon confirmed the transaction and it has not appeared in a ledger after ${elapsed()}. ` +
        `It may still be included later; check hash ${hash} before resubmitting. ` +
        `If it never lands, the fee is likely too low for current surge pricing.`,
    );
  } catch (error) {
    const horizonError = asHorizonError(error);
    submitLog.error(`submission failed after ${elapsed()}`, {
      name: horizonError.name,
      message: horizonError.message,
      status: horizonError.response?.status,
      type: horizonError.response?.type,
      title: horizonError.response?.data?.title,
      detail: horizonError.response?.data?.detail,
      hash: horizonError.response?.data?.extras?.hash,
      result_codes: horizonError.response?.data?.extras?.result_codes,
      result_xdr: horizonError.response?.data?.extras?.result_xdr,
      raw: error,
    });
    const codes = horizonError.response?.data?.extras?.result_codes;
    if (codes) throw new Error(`The network rejected the transaction (${describeResultCodes(codes)}).`, { cause: error });
    throw new Error(error instanceof Error ? error.message : 'Failed to submit transaction', { cause: error });
  }
};

// Refractor (refractor.space) stores a transaction so co-signers can add signatures, for both
// networks. Its ID is the transaction hash on the network it was posted for.
const refractorNetwork = (network: 'mainnet' | 'testnet') => (network === 'testnet' ? 'testnet' : 'public');

export const submitToRefractor = async (xdr: string, network: 'mainnet' | 'testnet'): Promise<string> => {
  try {
    const response = await fetch(`${appConfig.REFRACTOR_API_BASE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ network: refractorNetwork(network), xdr }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Refractor API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const expected = getTransactionHash(TransactionBuilder.fromXdr(xdr, getNetworkConfig(network).passphrase));
    if (result?.hash !== expected) {
      throw new Error('Refractor stored the transaction under an unexpected ID');
    }
    return expected;
  } catch (error) {
    throw new Error(`Failed to submit to Refractor: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
  }
};

export const pullFromRefractor = async (
  refractorId: string,
): Promise<{ xdr: string; network: 'mainnet' | 'testnet' }> => {
  const response = await fetch(`${appConfig.REFRACTOR_API_BASE}/${encodeURIComponent(refractorId)}`);
  if (response.status === 404) throw new Error('No transaction with this ID on Refractor');
  if (!response.ok) throw new Error(`Refractor API error: ${response.status}`);

  const result = await response.json();
  const xdr = result?.xdr;
  if (typeof xdr !== 'string' || !xdr) throw new Error('Refractor returned an invalid XDR payload');
  if (result.network !== 'public' && result.network !== 'testnet') {
    throw new Error(`Refractor returned an unknown network: ${String(result.network)}`);
  }
  const network = result.network === 'testnet' ? 'testnet' : 'mainnet';
  try {
    TransactionBuilder.fromXdr(xdr, getNetworkConfig(network).passphrase);
  } catch {
    throw new Error('Refractor returned a payload that is not a valid Stellar transaction');
  }
  return { xdr, network };
};
