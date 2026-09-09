import { appConfig } from './appConfig';
import { submitLog } from './submitLog';

import { Horizon, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

// Network configuration using centralized config
const getNetworkConfig = (network: 'mainnet' | 'testnet') => ({
  passphrase: network === 'testnet' ? appConfig.TESTNET_PASSPHRASE : appConfig.MAINNET_PASSPHRASE,
  horizonUrl: network === 'testnet' ? appConfig.TESTNET_HORIZON : appConfig.MAINNET_HORIZON,
});

export const getNetworkPassphrase = (network: 'mainnet' | 'testnet') => getNetworkConfig(network).passphrase;
export const getHorizonUrl = (network: 'mainnet' | 'testnet') => getNetworkConfig(network).horizonUrl;

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
export const submitTransaction = async (
  signedXdr: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
): Promise<Horizon.HorizonApi.SubmitTransactionResponse> => {
  const startedAt = performance.now();
  const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`;
  try {
    const config = getNetworkConfig(network);
    const transaction = TransactionBuilder.fromXDR(signedXdr, config.passphrase);
    const inner = 'innerTransaction' in transaction ? transaction.innerTransaction : transaction;
    submitLog.info('parsed signed envelope', {
      network,
      horizon: config.horizonUrl,
      hash: transaction.hash().toString('hex'),
      source: inner.source,
      sequence: inner.sequence,
      fee: transaction.fee,
      operations: inner.operations.map((op) => op.type),
      signatures: transaction.signatures.length,
      timeBounds: inner.timeBounds,
      xdrLength: signedXdr.length,
    });
    const server = createHorizonServer(network);

    // Compare the tx fee with what the network is currently charging: a fee below the
    // surge-pricing level is the usual reason a submission sits in the queue and times out.
    try {
      const fees = await server.feeStats();
      const feePerOp = Number(transaction.fee) / Math.max(1, inner.operations.length);
      const p50 = Number(fees.fee_charged.p50);
      submitLog.info(`network fee stats: base ${fees.last_ledger_base_fee}, charged p50 ${fees.fee_charged.p50} / p90 ${fees.fee_charged.p90} / max ${fees.fee_charged.max} stroops per op; this tx pays ${feePerOp} per op`);
      if (feePerOp < p50) {
        submitLog.wait(`fee ${feePerOp} is below the median charged fee ${p50} — surge pricing may delay or drop this transaction`);
      }
    } catch (feeError) {
      submitLog.info('could not fetch fee stats', feeError);
    }

    submitLog.wait(`POST ${config.horizonUrl}/transactions — Horizon blocks until the tx lands in a ledger (~5s) or gives up after ~30s`);
    try {
      const result = await server.submitTransaction(transaction);
      submitLog.ok(`horizon accepted the transaction after ${elapsed()}`, { hash: result.hash, ledger: result.ledger, successful: result.successful });
      return result;
    } catch (submitError) {
      const horizonError = asHorizonError(submitError);
      const status = horizonError.response?.status;
      const codes = horizonError.response?.data?.extras?.result_codes;
      const isTimeout = status === 504 || codes?.transaction === 'tx_timeout';
      const hash = horizonError.response?.data?.extras?.hash || transaction.hash().toString('hex');
      if (!isTimeout) throw submitError;

      // Horizon gave up waiting, but the tx may still land. Poll for it before failing.
      submitLog.wait(`horizon timed out after ${elapsed()} (504): the tx was queued but not yet in a ledger. Polling GET /transactions/${hash.slice(0, 12)}… for up to 60s`);
      const deadline = performance.now() + 60_000;
      while (performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        try {
          const found = await server.transactions().transaction(hash).call();
          submitLog.ok(`transaction found in ledger ${found.ledger_attr} after ${elapsed()}`, { hash: found.hash, successful: found.successful });
          return found as unknown as Horizon.HorizonApi.SubmitTransactionResponse;
        } catch (pollError) {
          const pollStatus = asHorizonError(pollError).response?.status;
          if (pollStatus !== 404) submitLog.info(`poll error (status ${pollStatus ?? '?'})`, pollError);
          else submitLog.wait(`not in a ledger yet (${elapsed()})`);
        }
      }
      throw new Error(
        `Horizon timed out and the transaction has not appeared in a ledger after 60s. ` +
          `It may still be included later; check hash ${hash} before resubmitting. ` +
          `If it never lands, the fee is likely too low for current surge pricing.`,
      );
    }
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
