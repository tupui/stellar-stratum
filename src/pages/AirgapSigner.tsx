import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, Plus, Smartphone } from 'lucide-react';
import { TransactionScanner } from '@/components/airgap/TransactionScanner';
import { XdrDetails } from '@/components/XdrDetails';
import { TransactionSubmitter } from '@/components/transaction/TransactionSubmitter';
import { SuccessModal } from '@/components/SuccessModal';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { useToast } from '@/hooks/use-toast';
import { parseTransactionPayload, type TransactionPayload } from '@/lib/sep7';
import { verifiedSignerKeys } from '@/lib/signatures';
import { getInnerTransaction, getTransactionHash, tryParseTransaction } from '@/lib/xdr/parse';

const networkName = (network: 'mainnet' | 'testnet') => (network === 'mainnet' ? 'Mainnet' : 'Testnet');

const AirgapSigner = () => {
  const { network, setNetwork } = useNetwork();
  const { wallets: allWallets, signWithWallet } = useWalletKit();
  const wallets = allWallets.filter((w) => w.isAvailable);
  const { toast } = useToast();
  const [xdr, setXdr] = useState<string>('');
  const [pasted, setPasted] = useState('');
  // Addresses that signed on this device, for the current transaction only.
  const [signedBy, setSignedBy] = useState<string[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [isSigning, setIsSigning] = useState(false);
  const [showOfflineModal, setShowOfflineModal] = useState(false);

  // Disable network features for true air-gapped operation
  useEffect(() => {
    const originalFetch = window.fetch;
    const originalXHR = window.XMLHttpRequest;

    // Guard against double-wrapping (StrictMode double-invoke, re-mount).
    type AirgapMarkedFetch = typeof window.fetch & { __airgap?: true };
    type AirgapMarkedXHR = typeof window.XMLHttpRequest & { __airgap?: true };
    if ((window.fetch as AirgapMarkedFetch).__airgap) return;

    const blockedFetch: AirgapMarkedFetch = (() => {
      return Promise.reject(new Error('Network requests disabled in air-gapped mode'));
    }) as AirgapMarkedFetch;
    blockedFetch.__airgap = true;

    const BlockedXHR = function BlockedXHR() {
      throw new Error('Network requests disabled in air-gapped mode');
    } as unknown as AirgapMarkedXHR;
    BlockedXHR.__airgap = true;

    window.fetch = blockedFetch;
    window.XMLHttpRequest = BlockedXHR;

    return () => {
      window.fetch = originalFetch;
      window.XMLHttpRequest = originalXHR;
    };
  }, []);

  /**
   * A new transaction replaces the current one. The network comes from the SEP-7 URI when it
   * names one; raw XDR does not say, so the current choice stays and is shown for review.
   */
  const loadTransaction = (payload: TransactionPayload) => {
    const target = payload.network ?? network;
    if (!tryParseTransaction(payload.xdr, target)) {
      toast({
        title: 'Invalid Transaction',
        description: "Invalid transaction payload. Ensure it's a SEP-7 tx QR or base64 XDR.",
        variant: 'destructive',
      });
      return;
    }
    setNetwork(target);
    setXdr(payload.xdr);
    setSignedBy([]);
    setPasted('');
    toast({
      title: 'Transaction Received',
      description: `Ready for review and signing on ${networkName(target)}`,
    });
  };

  // ?xdr= (raw XDR or a SEP-7 URI) and ?network= in the page URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const networkParam = params.get('network');
    const requested = networkParam === 'testnet' || networkParam === 'mainnet' ? networkParam : undefined;
    const xdrParam = params.get('xdr');
    if (!xdrParam) {
      if (requested) setNetwork(requested);
      return;
    }
    const payload = parseTransactionPayload(xdrParam);
    if (payload) {
      loadTransaction({ xdr: payload.xdr, network: payload.network ?? requested });
    } else {
      toast({
        title: 'Invalid URL Parameter',
        description: 'The XDR in the URL is not a valid transaction.',
        variant: 'destructive',
      });
    }
    // Runs once on load; loadTransaction reads the network at that time.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSign = async () => {
    const original = tryParseTransaction(xdr, network);
    if (!original || !selectedWalletId) return;
    setIsSigning(true);
    try {
      const { signedXdr, address, walletName } = await signWithWallet(xdr, selectedWalletId, network);
      const signed = tryParseTransaction(signedXdr, network);
      if (!signed || getTransactionHash(signed.tx) !== getTransactionHash(original.tx)) {
        throw new Error(`${walletName} returned a different transaction. It was not added.`);
      }
      const hash = signed.isFeeBump ? signed.tx.hash() : getInnerTransaction(signed.tx).hash();
      const signatures = signed.isFeeBump ? signed.tx.signatures : getInnerTransaction(signed.tx).signatures;
      if (address && !verifiedSignerKeys(hash, signatures, [{ key: address, weight: 1 }]).includes(address)) {
        throw new Error(`${walletName} did not return a valid signature for ${networkName(network)}.`);
      }
      setXdr(signedXdr);
      if (address) setSignedBy((prev) => (prev.includes(address) ? prev : [...prev, address]));
      toast({
        title: 'Transaction Signed',
        description: address ? `Signature added from ${address.slice(0, 8)}...${address.slice(-8)}` : `Signed with ${walletName}`,
      });
    } catch (error) {
      toast({
        title: 'Signing Failed',
        description: error instanceof Error ? error.message : 'Failed to sign transaction',
        variant: 'destructive',
      });
    } finally {
      setIsSigning(false);
    }
  };

  const parsed = xdr ? tryParseTransaction(xdr, network) : null;
  const signatureCount = parsed
    ? (parsed.isFeeBump ? parsed.tx.signatures.length : 0) + getInnerTransaction(parsed.tx).signatures.length
    : 0;

  const renderScanStep = () => (
    <div className="space-y-6">
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">Air‑gapped signing</span> lets you approve transactions on an offline device. This page blocks network requests for safety.
        </p>
        <div className="grid gap-1">
          <p className="text-foreground font-medium">What you need</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>Device A (online): build the transaction and display its QR</li>
            <li>Device B (offline): this page to scan and sign</li>
          </ul>
        </div>
        <div className="grid gap-1">
          <p className="text-foreground font-medium">Steps</p>
          <ol className="list-decimal pl-5 text-muted-foreground">
            <li>Scan the transaction QR below (or paste its XDR).</li>
            <li>Check the network and the hash, review the details and add signatures on this device.</li>
            <li>Show the Signature QR back to Device A to merge and submit.</li>
          </ol>
        </div>
        <div className="grid gap-1">
          <p className="text-foreground font-medium">Safety tips</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>Compare the transaction hash on both devices before signing.</li>
            <li>Keep this device offline for the entire flow.</li>
          </ul>
        </div>
      </div>

      <TransactionScanner onTransaction={loadTransaction} />

      <div className="space-y-2">
        <Textarea
          placeholder="Or paste a transaction XDR / SEP-7 URI"
          className="min-h-24 font-address text-xs"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <Button
          variant="outline"
          className="w-full"
          disabled={!pasted.trim()}
          onClick={() => {
            const payload = parseTransactionPayload(pasted);
            if (payload) loadTransaction(payload);
            else toast({ title: 'Invalid Transaction', description: 'This is not a transaction XDR or SEP-7 URI.', variant: 'destructive' });
          }}
        >
          Load transaction
        </Button>
      </div>
    </div>
  );

  const renderLoadedStep = () => (
    <div className="space-y-6">
      {/* The XDR does not say which network it is for; the signature is only valid on this one */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-secondary/40">
        <span className="text-sm">
          Signing for <span className="font-semibold">{networkName(network)}</span>
        </span>
        <Select value={network} onValueChange={(value) => setNetwork(value as 'mainnet' | 'testnet')}>
          <SelectTrigger className="w-32 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mainnet">Mainnet</SelectItem>
            <SelectItem value="testnet">Testnet</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <XdrDetails xdr={xdr} defaultExpanded={true} networkType={network} offlineMode={true} />

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Sign with Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {signatureCount} signature{signatureCount === 1 ? '' : 's'} on this transaction.
          </p>
          {signedBy.map((address) => (
            <div key={address} className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <p className="font-address text-sm">{address.slice(0, 8)}...{address.slice(-8)}</p>
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
              <SelectTrigger>
                <SelectValue placeholder="Select wallet to sign with" />
              </SelectTrigger>
              <SelectContent>
                {wallets.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSign} disabled={!selectedWalletId || isSigning} className="w-full">
              {isSigning ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Signing...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Sign with Wallet
                </div>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <TransactionSubmitter
        xdr={xdr}
        network={network}
        ready={false}
        isSubmittingToNetwork={false}
        isSubmittingToRefractor={false}
        onSubmitToNetwork={async () => {}}
        onSubmitToRefractor={async () => {}}
        onShowOfflineModal={() => setShowOfflineModal(true)}
        offlineOnly={true}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/50 to-stellar-yellow/5 relative overflow-hidden">
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-4 md:p-6 border-b border-border/50 bg-background/80 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-stellar-yellow/10 rounded-xl">
                <Smartphone className="w-6 h-6 text-stellar-yellow" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Air-Gapped Signer</h1>
              </div>
              {xdr && (
                <Button
                  onClick={() => {
                    setXdr('');
                    setSignedBy([]);
                  }}
                  size="sm"
                  className="self-start bg-success hover:bg-success/90 text-success-foreground"
                >
                  Back to Scanner
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-2xl mx-auto">
            <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-2xl shadow-xl">
              <div className="p-4 md:p-6">{xdr ? renderLoadedStep() : renderScanStep()}</div>
            </div>
          </div>
        </main>
      </div>

      {showOfflineModal && parsed && (
        <SuccessModal
          type="offline"
          hash={getTransactionHash(parsed.tx)}
          xdr={xdr}
          network={network}
          onClose={() => setShowOfflineModal(false)}
        />
      )}
    </div>
  );
};

export default AirgapSigner;
