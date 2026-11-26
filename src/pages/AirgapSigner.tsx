import { useState, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Pen, QrCode, Wifi, WifiOff } from 'lucide-react';
import { TransactionScanner } from '@/components/airgap/TransactionScanner';
import { XdrDetails } from '@/components/XdrDetails';
import { AirgapSyncModal } from '@/components/airgap/AirgapSyncModal';
import { Footer } from '@/components/Footer';
import { Mark, Spinner } from '@/components/brand/Mark';
import { AppHeader, BackButton, Dock, SignerCell, Wrap } from '@/components/brand/Shell';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { useToast } from '@/hooks/use-toast';
import { isRefusal, parseTransactionPayload, type TransactionPayload } from '@/lib/sep7';
import { verifiedSignerKeys } from '@/lib/signatures';
import { getInnerTransaction, getTransactionHash, tryParseTransaction } from '@/lib/xdr/parse';
import { shortAddress } from '@/lib/xdr/describe';

const networkName = (network: 'mainnet' | 'testnet') => (network === 'mainnet' ? 'Mainnet' : 'Testnet');

// From sm up the actions sit in the page; below it, the main one is in the Dock at the bottom.
const WIDE = '(min-width: 640px)';
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );

/** A row of the guide: a bare leading glyph or number, then the text. */
const GuideRow = ({ lead, children }: { lead: ReactNode; children: ReactNode }) => (
  <li className="flex items-start gap-3 border-t border-line py-3 text-[15px] leading-normal">
    <span className="inline-flex w-6 flex-none justify-center">
      <span className="inline-flex h-[22px] items-center text-muted-foreground">{lead}</span>
    </span>
    <span className="min-w-0 flex-1">{children}</span>
  </li>
);

const GuideSection = ({ title, ordered, children }: { title: string; ordered?: boolean; children: ReactNode }) => {
  const List = ordered ? 'ol' : 'ul';
  return (
    <section>
      <h2 className="sub mb-2">{title}</h2>
      <List className="border-b border-line">{children}</List>
    </section>
  );
};

const StepNumber = ({ n }: { n: number }) => (
  <span className="font-pix text-[24px] leading-[22px] text-foreground" aria-hidden="true">
    {n}
  </span>
);

const Bullet = () => <i className="h-1 w-1 bg-muted-foreground" aria-hidden="true" />;

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
  const wide = useWide();

  // The app itself makes no requests from this page: block the ways scripts can reach the
  // network, so nothing loaded here can send the transaction anywhere. This is a second line of
  // defence only; the device itself must be offline.
  useEffect(() => {
    const originals = {
      fetch: window.fetch,
      XMLHttpRequest: window.XMLHttpRequest,
      WebSocket: window.WebSocket,
      EventSource: window.EventSource,
      sendBeacon: navigator.sendBeacon,
    };

    // Guard against double-wrapping (StrictMode double-invoke, re-mount).
    type AirgapMarkedFetch = typeof window.fetch & { __airgap?: true };
    if ((window.fetch as AirgapMarkedFetch).__airgap) return;

    const refuse = () => {
      throw new Error('Network requests disabled in air-gapped mode');
    };
    const blockedFetch: AirgapMarkedFetch = (() =>
      Promise.reject(new Error('Network requests disabled in air-gapped mode'))) as AirgapMarkedFetch;
    blockedFetch.__airgap = true;

    window.fetch = blockedFetch;
    window.XMLHttpRequest = refuse as unknown as typeof window.XMLHttpRequest;
    window.WebSocket = refuse as unknown as typeof window.WebSocket;
    window.EventSource = refuse as unknown as typeof window.EventSource;
    navigator.sendBeacon = () => false;

    return () => {
      window.fetch = originals.fetch;
      window.XMLHttpRequest = originals.XMLHttpRequest;
      window.WebSocket = originals.WebSocket;
      window.EventSource = originals.EventSource;
      navigator.sendBeacon = originals.sendBeacon;
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
        title: 'Invalid transaction',
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
      title: 'Transaction received',
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
    if (isRefusal(payload)) {
      toast({ title: 'Transaction refused', description: payload.refused, variant: 'destructive' });
    } else if (payload) {
      loadTransaction({ xdr: payload.xdr, network: payload.network ?? requested });
    } else {
      toast({
        title: 'Invalid URL parameter',
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
      const before = original.isFeeBump ? original.tx.signatures : getInnerTransaction(original.tx).signatures;
      if (!address || !verifiedSignerKeys(hash, signatures, [{ key: address, weight: 1 }]).includes(address)) {
        throw new Error(`${walletName} did not return a valid signature for ${networkName(network)}.`);
      }
      if (signatures.length <= before.length && signedBy.includes(address)) {
        throw new Error(`${shortAddress(address)} has already signed this transaction.`);
      }
      setXdr(signedXdr);
      setSignedBy((prev) => (prev.includes(address) ? prev : [...prev, address]));
      toast({
        title: 'Transaction signed',
        description: `Signature added from ${shortAddress(address)}`,
      });
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


  const parsed = xdr ? tryParseTransaction(xdr, network) : null;
  const signatureCount = parsed
    ? (parsed.isFeeBump ? parsed.tx.signatures.length : 0) + getInnerTransaction(parsed.tx).signatures.length
    : 0;
  // Once a signature is added here, handing it back by QR is the next step and takes the primary.
  const signedHere = signedBy.length > 0;

  const loadPasted = () => {
    const payload = parseTransactionPayload(pasted);
    if (isRefusal(payload)) toast({ title: 'Transaction refused', description: payload.refused, variant: 'destructive' });
    else if (payload) loadTransaction(payload);
    else toast({ title: 'Invalid transaction', description: 'This is not a transaction XDR or SEP-7 URI.', variant: 'destructive' });
  };

  const renderScanStep = () => (
    <Wrap className="grid gap-4 py-4 sm:gap-6 sm:py-8 lg:grid-cols-[7fr_5fr] lg:items-start">
      <div className="flex flex-col gap-4 sm:gap-6">
        <p className="lede">
          <b className="font-semibold text-foreground">Air‑gapped signing</b> lets you approve transactions on an offline device. Open this page, then disconnect the device from every network before loading a transaction. The page itself sends nothing.
        </p>
        <GuideSection title="What You Need">
          <GuideRow lead={<Wifi className="h-[18px] w-[18px]" strokeWidth={1.5} role="img" aria-label="Online" />}>
            Device A (online): build the transaction and display its QR
          </GuideRow>
          <GuideRow lead={<WifiOff className="h-[18px] w-[18px]" strokeWidth={1.5} role="img" aria-label="Offline" />}>
            Device B (offline): this page to scan and sign
          </GuideRow>
        </GuideSection>
        <GuideSection title="Steps" ordered>
          <GuideRow lead={<StepNumber n={1} />}>Scan the transaction QR below (or paste its XDR).</GuideRow>
          <GuideRow lead={<StepNumber n={2} />}>
            Check the network and the hash, review the details and add signatures on this device.
          </GuideRow>
          <GuideRow lead={<StepNumber n={3} />}>Show the Signature QR back to Device A to merge and submit.</GuideRow>
        </GuideSection>
        <GuideSection title="Safety Tips">
          <GuideRow lead={<Bullet />}>Compare the transaction hash on both devices before signing.</GuideRow>
          <GuideRow lead={<Bullet />}>Keep this device offline for the entire flow.</GuideRow>
        </GuideSection>
      </div>

      <section aria-label="Load a transaction" className="flex flex-col gap-3 lg:border lg:border-line lg:bg-ink-2 lg:p-4">
        <TransactionScanner onTransaction={loadTransaction} />
        <Textarea
          aria-label="Transaction XDR or SEP-7 URI"
          placeholder="Or paste a transaction XDR / SEP-7 URI"
          className="min-h-24 resize-none font-address text-xs leading-[18px]"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <Button variant="outline" className="w-full" disabled={!pasted.trim()} onClick={loadPasted}>
          Load Transaction
        </Button>
      </section>
    </Wrap>
  );

  // The pieces of the loaded state, placed differently on the phone and from sm up.

  /* The XDR does not say which network it is for; the signature is only valid on this one */
  const networkRow = (
    <div className="flex items-center justify-between gap-3 text-[15px]">
      <span>
        Signing for <b className="font-semibold">{networkName(network)}</b>
      </span>
      <Select value={network} onValueChange={(value) => setNetwork(value as 'mainnet' | 'testnet')}>
        <SelectTrigger aria-label="Network" className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="testnet">Testnet</SelectItem>
          <SelectItem value="mainnet">Mainnet</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const signIntro = (
    <>
      <h2 id="sign-with-wallet" className="sec">
        Sign with Wallet
      </h2>
      <p className="text-[15px] text-muted-foreground">
        {signatureCount} signature{signatureCount === 1 ? '' : 's'} attached. The online device checks which ones are
        valid; those added here are listed below.
      </p>
      {signedHere && (
        <ul className="border-b border-line">
          {signedBy.map((address) => (
            <li key={address} className="flex items-center gap-3 border-t border-line py-3">
              <SignerCell signed />
              <span className="min-w-0 flex-1 font-address text-[13px]">{shortAddress(address)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const walletControls = (primary: boolean) => (
    <div className="flex flex-col gap-3">
      <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
        <SelectTrigger aria-label="Wallet">
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
      <Button
        variant={primary ? 'default' : 'outline'}
        onClick={handleSign}
        disabled={!selectedWalletId || isSigning}
        className="w-full"
      >
        {isSigning ? (
          <>
            <Spinner />
            Signing...
          </>
        ) : (
          <>
            <Pen aria-hidden="true" />
            Sign with Wallet
          </>
        )}
      </Button>
    </div>
  );

  const syncButton = (primary: boolean) => (
    <Button variant={primary ? 'default' : 'outline'} className="w-full" onClick={() => setShowOfflineModal(true)}>
      <QrCode aria-hidden="true" />
      Air-gap Sync
    </Button>
  );

  const verification = <XdrDetails xdr={xdr} defaultExpanded={true} networkType={network} offlineMode={true} />;

  const renderLoadedPhone = () => (
    <div>
      <section aria-label="Network" className="p-4">
        {networkRow}
      </section>
      <div className="border-t border-line">{verification}</div>
      {!signedHere && (
        <section aria-label="Air-gap Sync" className="border-t border-line p-4">
          {syncButton(false)}
        </section>
      )}
      <section aria-labelledby="sign-with-wallet" className="flex flex-col gap-3 border-t border-line p-4">
        {signIntro}
        {signedHere && walletControls(false)}
      </section>
    </div>
  );

  const renderLoadedWide = () => (
    <Wrap className="grid gap-6 pb-8 pt-6 lg:grid-cols-[7fr_5fr] lg:items-start">
      <div className="min-w-0">{verification}</div>
      {/* Below lg the column is single: the network still comes first, above the verification */}
      <aside className="flex flex-col gap-4 max-lg:contents lg:sticky lg:top-6">
        <section aria-label="Network" className="border border-line bg-ink-2 p-4 max-lg:order-first">
          {networkRow}
        </section>
        <section aria-labelledby="sign-with-wallet" className="flex flex-col gap-3 border border-line bg-ink-2 p-4">
          {signIntro}
          {walletControls(!signedHere)}
        </section>
        {syncButton(signedHere)}
      </aside>
    </Wrap>
  );

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <AppHeader
        brand={
          <span className="inline-flex items-center gap-2 text-foreground">
            <Mark label="Stratum" />
            <h1 className="whitespace-nowrap font-pix text-[20px] font-normal leading-none tracking-[0.02em] sm:text-[24px]">
              Air-gapped Signer
            </h1>
          </span>
        }
        right={
          xdr ? (
            <BackButton
              label="Back to Scanner"
              onClick={() => {
                setXdr('');
                setSignedBy([]);
              }}
            />
          ) : undefined
        }
      />

      <main className="flex-1">{xdr ? (wide ? renderLoadedWide() : renderLoadedPhone()) : renderScanStep()}</main>
      <Footer />
      {xdr && !wide && <Dock>{signedHere ? syncButton(true) : walletControls(true)}</Dock>}

      {showOfflineModal && parsed && (
        <AirgapSyncModal mode="response" xdr={xdr} network={network} signedBy={signedBy} onClose={() => setShowOfflineModal(false)} />
      )}
    </div>
  );
};

export default AirgapSigner;
