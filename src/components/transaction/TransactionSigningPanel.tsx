import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignerSelector } from '@/components/SignerSelector';
import { SuccessModal } from '@/components/SuccessModal';
import { TransactionSubmitter } from './TransactionSubmitter';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { useToast } from '@/hooks/use-toast';
import { useSignatureStatus } from '@/hooks/useSignatureStatus';
import { submitTransaction, submitToRefractor, type AccountData } from '@/lib/stellar';
import { submitLog } from '@/lib/submitLog';
import { verifiedSignerKeys } from '@/lib/signatures';
import { getInnerTransaction, getTransactionHash, tryParseTransaction, type NetworkId } from '@/lib/xdr/parse';

interface TransactionSigningPanelProps {
  /** Current envelope; empty when there is nothing to sign (the panel then only keeps its modal and log). */
  xdr: string;
  network: NetworkId;
  /** The account the user is working with; other involved accounts are loaded as needed. */
  account: AccountData | null;
  /** A signature was added: the envelope to show and sign from now on. */
  onXdrChange: (xdr: string) => void;
  /** The network accepted the transaction. */
  onSubmitted: () => void | Promise<void>;
  onRefractorSubmitted?: (id: string) => void;
  /** The user closed the confirmation of a submitted transaction. */
  onDone: () => void;
}

type SuccessData = { type: 'network' | 'refractor' | 'offline'; hash: string; xdr?: string };

/**
 * Collect signatures on a transaction, then submit it or hand it to the other signers
 * (Refractor or air-gapped QR). Signature weight is always computed from signatures that
 * verify against the envelope, for every account the transaction involves.
 */
export const TransactionSigningPanel = ({
  xdr,
  network,
  account,
  onXdrChange,
  onSubmitted,
  onRefractorSubmitted,
  onDone,
}: TransactionSigningPanelProps) => {
  const { toast } = useToast();
  const { signWithWallet } = useWalletKit();
  const { status, loading, signers } = useSignatureStatus(xdr, network, account);
  const [isSigning, setIsSigning] = useState(false);
  const [isSubmittingToNetwork, setIsSubmittingToNetwork] = useState(false);
  const [isSubmittingToRefractor, setIsSubmittingToRefractor] = useState(false);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);

  const handleSignWithSigner = async (signerKey: string, walletId: string) => {
    const original = tryParseTransaction(xdr, network);
    if (!original) return;
    setIsSigning(true);
    try {
      const { signedXdr, walletName } = await signWithWallet(xdr, walletId, network, signerKey);

      // Never trust the wallet blindly: it must return the same transaction, now carrying a
      // valid signature from the signer that was asked for.
      const signed = tryParseTransaction(signedXdr, network);
      if (!signed || getTransactionHash(signed.tx) !== getTransactionHash(original.tx)) {
        throw new Error(`${walletName} returned a different transaction. It was not added.`);
      }
      const inner = getInnerTransaction(signed.tx);
      const hash = signed.isFeeBump ? signed.tx.hash() : inner.hash();
      const signatures = signed.isFeeBump ? signed.tx.signatures : inner.signatures;
      if (!verifiedSignerKeys(hash, signatures, [{ key: signerKey, weight: 1 }]).includes(signerKey)) {
        throw new Error(
          `${walletName} did not sign with ${signerKey.slice(0, 8)}…. ` +
            'Switch to that account in the wallet and try again.',
        );
      }

      onXdrChange(signedXdr);
      toast({ title: 'Transaction signed', description: `Signed with ${walletName}`, duration: 2000 });
    } catch (error) {
      toast({
        title: 'Signing failed',
        description: error instanceof Error ? error.message : 'Failed to sign transaction',
        variant: 'destructive',
      });
    } finally {
      setIsSigning(false);
    }
  };

  const handleSubmitToNetwork = async () => {
    if (!xdr || isSubmittingToNetwork) return;
    setIsSubmittingToNetwork(true);
    submitLog.clear();
    submitLog.info('send button pressed', { network });
    try {
      const result = await submitTransaction(xdr, network);
      setSuccessData({ type: 'network', hash: result.hash });
      submitLog.wait('refreshing account data from horizon');
      try {
        await onSubmitted();
        submitLog.ok('account data refreshed');
      } catch (refreshError) {
        // The transaction is in; only the follow-up read failed.
        submitLog.info('could not refresh account data', refreshError);
      }
    } catch (error) {
      toast({
        title: 'Submission failed',
        description: error instanceof Error ? error.message : 'Failed to submit transaction',
        variant: 'destructive',
      });
    } finally {
      setIsSubmittingToNetwork(false);
    }
  };

  const handleSubmitToRefractor = async () => {
    if (!xdr || isSubmittingToRefractor) return;
    setIsSubmittingToRefractor(true);
    try {
      const id = await submitToRefractor(xdr, network);
      onRefractorSubmitted?.(id);
      setSuccessData({ type: 'refractor', hash: id });
    } catch (error) {
      toast({
        title: 'Refractor submission failed',
        description: error instanceof Error ? error.message : 'Failed to submit to Refractor',
        variant: 'destructive',
      });
    } finally {
      setIsSubmittingToRefractor(false);
    }
  };

  const handleShowOfflineModal = () => {
    const parsed = tryParseTransaction(xdr, network);
    if (!parsed) return;
    setSuccessData({ type: 'offline', hash: getTransactionHash(parsed.tx), xdr });
  };

  return (
    <>
      {xdr && status && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Sign Transaction</CardTitle>
            <CardDescription>Connect your wallet to add signatures to this transaction</CardDescription>
          </CardHeader>
          <CardContent>
            <SignerSelector
              signers={signers}
              requirements={status.requirements}
              currentAccountKey={account?.publicKey ?? ''}
              onSignWithSigner={handleSignWithSigner}
              isSigning={isSigning}
              loading={loading}
            />
          </CardContent>
        </Card>
      )}

      <TransactionSubmitter
        xdr={status ? xdr : ''}
        network={network}
        ready={Boolean(status?.ready) && !loading}
        isSubmittingToNetwork={isSubmittingToNetwork}
        isSubmittingToRefractor={isSubmittingToRefractor}
        onSubmitToNetwork={handleSubmitToNetwork}
        onSubmitToRefractor={handleSubmitToRefractor}
        onShowOfflineModal={handleShowOfflineModal}
      />

      {successData && (
        <SuccessModal
          type={successData.type}
          hash={successData.type === 'refractor' ? undefined : successData.hash}
          refractorId={successData.type === 'refractor' ? successData.hash : undefined}
          xdr={successData.xdr}
          network={network}
          onClose={() => setSuccessData(null)}
          onNavigateToDashboard={onDone}
        />
      )}
    </>
  );
};
