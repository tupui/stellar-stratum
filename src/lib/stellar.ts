import { appConfig } from './appConfig';
import { submitLog } from './submitLog';
import { getHorizonUrls } from './horizonSettings';

import { Horizon, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

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
  }>;
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
        const baseBalance = { asset_type: balance.asset_type, balance: balance.balance };
        if (balance.asset_type !== 'native' && 'asset_code' in balance) {
          return {
            ...baseBalance,
            asset_code: balance.asset_code,
            asset_issuer: balance.asset_issuer,
          };
        }
        return baseBalance;
      }),
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
      );
    }
    const original = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load account data from Horizon: ${original}`);
  }
};

// Submission progress is reported through submitLog (shown in the SubmissionTerminal and,
// in dev builds, mirrored to the console). Horizon holds the request open until the tx is
// included in a ledger (or ~30s+ until it gives up with a 504 tx_timeout), so the timings
// show where the time goes and exactly what Horizon answered.
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Look a transaction hash up on every known Horizon; first hit wins. */
const findTransactionAnywhere = async (
  hash: string,
  urls: string[],
): Promise<Horizon.ServerApi.TransactionRecord | null> => {
  const lookups = urls.map(async (url) => {
    try {
      return await new Horizon.Server(url).transactions().transaction(hash).call();
    } catch {
      return null;
    }
  });
  const results = await Promise.all(lookups);
  return results.find((r): r is Horizon.ServerApi.TransactionRecord => r !== null) ?? null;
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
    const transaction = TransactionBuilder.fromXDR(signedXdr, config.passphrase);
    const inner = 'innerTransaction' in transaction ? transaction.innerTransaction : transaction;
    const hash = transaction.hash().toString('hex');
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

    // Compare the tx fee with what the network is currently charging: a fee below the
    // surge-pricing level is the usual reason a submission sits in the queue and times out.
    try {
      const fees = await new Horizon.Server(urls[0]).feeStats();
      const feePerOp = Number(transaction.fee) / Math.max(1, inner.operations.length);
      const p50 = Number(fees.fee_charged.p50);
      const p90 = Number(fees.fee_charged.p90);
      submitLog.info(`network fee stats: base ${fees.last_ledger_base_fee}, charged p50 ${p50} / p90 ${p90} / max ${fees.fee_charged.max} stroops per op, ledger ${Math.round(Number(fees.ledger_capacity_usage) * 100)}% full; this tx pays up to ${feePerOp} per op`);
      if (feePerOp < p50) {
        submitLog.wait(`fee ${feePerOp} is below the median charged fee ${p50} — surge pricing will likely delay or drop this transaction`);
      } else if (feePerOp < p90) {
        submitLog.wait(`fee ${feePerOp} is below the p90 charged fee ${p90} — may wait for a less busy ledger`);
      }
    } catch (feeError) {
      submitLog.info('could not fetch fee stats', feeError);
    }

    const alreadyIncluded = (found: Horizon.ServerApi.TransactionRecord) => {
      submitLog.ok(`transaction is in ledger ${found.ledger_attr} after ${elapsed()}`, { hash: found.hash, successful: found.successful });
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
        const horizonError = asHorizonError(attemptError);
        const status = horizonError.response?.status;
        const codes = horizonError.response?.data?.extras?.result_codes;
        const isTimeout = status === 504 || codes?.transaction === 'tx_timeout' || attemptError instanceof Error && attemptError.message.startsWith('no answer');
        const isRejection = status === 400 && codes !== undefined && codes.transaction !== 'tx_timeout';

        if (isRejection) {
          // Could be tx_bad_seq because an earlier attempt already got it into a ledger.
          const found = await findTransactionAnywhere(hash, urls);
          if (found) return alreadyIncluded(found);
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
    const codeSummary = codes
      ? ` (${[codes.transaction, ...(codes.operations || [])].filter(Boolean).join(', ')})`
      : '';
    const base = error instanceof Error ? error.message : 'Failed to submit transaction';
    throw new Error(`${base}${codeSummary}`);
  }
};

// Refractor integration functions
export const submitToRefractor = async (xdr: string, network: 'mainnet' | 'testnet'): Promise<string> => {
  try {
    const response = await fetch(`${appConfig.REFRACTOR_API_BASE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      // Refractor always speaks to public network XDR regardless of client network.
      body: JSON.stringify({ network: 'public', xdr }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Refractor API error: ${response.status} - ${errorText}`);
    }

    // Compute hash (ID) to share based on network
    const config = getNetworkConfig(network);
    const tx = TransactionBuilder.fromXDR(xdr, config.passphrase);
    return tx.hash().toString('hex');
  } catch (error) {
    throw new Error(`Failed to submit to Refractor: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const pullFromRefractor = async (refractorId: string): Promise<string> => {
  try {
    const response = await fetch(`${appConfig.REFRACTOR_API_BASE}/${refractorId}`);
    if (!response.ok) throw new Error('Failed to fetch from Refractor');

    const result = await response.json();
    const xdr = result?.xdr;
    if (typeof xdr !== 'string' || xdr.length < 100) {
      throw new Error('Refractor returned an invalid XDR payload');
    }

    // Validate XDR parses on at least one known network before handing it back
    let parses = false;
    for (const passphrase of [appConfig.MAINNET_PASSPHRASE, appConfig.TESTNET_PASSPHRASE]) {
      try {
        TransactionBuilder.fromXDR(xdr, passphrase);
        parses = true;
        break;
      } catch {
        /* try next */
      }
    }
    if (!parses) throw new Error('Refractor returned a payload that is not a valid Stellar transaction');
    return xdr;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to fetch transaction from Refractor');
  }
};
