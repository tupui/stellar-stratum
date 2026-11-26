import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Download, Copy, CheckCircle, Share2, QrCode } from 'lucide-react';
import { Spinner } from '@/components/brand/Mark';
import refractorLogo from '@/assets/refractor-favicon.ico';
import { useToast } from '@/hooks/use-toast';
import { ShareModal } from './ShareModal';
import { QRScanner, type ScanRefusal } from './QRScanner';
import { isRefusal, parseTransactionPayload } from '@/lib/sep7';

interface ImportTabProps {
  xdrInput: string;
  /** Why the pasted text cannot be used, if it cannot. */
  xdrError?: string;
  onXdrInputChange: (xdr: string) => void;
  onPullTransaction: (refractorId: string) => Promise<void>;
  lastRefractorId?: string;
  network: 'mainnet' | 'testnet';
}

export const ImportTab = ({ 
  xdrInput, 
  xdrError,
  onXdrInputChange,
  onPullTransaction,
  lastRefractorId,
  network
}: ImportTabProps) => {
  const [refractorId, setRefractorId] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const { toast } = useToast();

  const handlePullTransaction = async () => {
    if (!refractorId.trim()) {
      toast({
        title: "Missing Refractor ID",
        description: "Please enter a valid Refractor transaction ID",
        variant: "destructive",
        duration: 5000
      });
      return;
    }
    setIsPulling(true);
    try {
      await onPullTransaction(refractorId.trim());
      setRefractorId('');
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setIsPulling(false);
    }
  };

  const copyRefractorId = async () => {
    if (lastRefractorId) {
      await navigator.clipboard.writeText(lastRefractorId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied to clipboard",
        description: "Refractor ID has been copied",
        duration: 3000
      });
    }
  };

  // Transactions arrive as SEP-7 URIs (including this app's air-gap QR) or raw XDR; share links
  // and Refractor IDs point at a transaction stored on Refractor.
  const handleQRScan = (data: string): ScanRefusal | void => {
    const text = data.trim();
    const payload = parseTransactionPayload(text);
    if (isRefusal(payload)) return { title: "Transaction refused", description: payload.refused };
    if (payload) {
      onXdrInputChange(text);
      toast({ title: "Transaction imported", description: "Transaction loaded from the QR code", duration: 3000 });
      return;
    }
    try {
      const refractorParam = new URL(text).searchParams.get('r');
      if (refractorParam) {
        setRefractorId(refractorParam);
        return;
      }
    } catch {
      // Not a URL
    }
    if (/^[0-9a-f]{64}$/i.test(text)) {
      setRefractorId(text);
      return;
    }
    return {
      title: "Unrecognized QR code",
      description: "Expected a transaction (SEP-7, XDR or an animated QR), a share link or a Refractor ID.",
    };
  };

  const openRefractor = () => {
    const newWindow = window.open('https://refractor.space/', '_blank', 'noopener,noreferrer');
    if (newWindow) newWindow.opener = null;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* XDR Input Section */}
      <div className="flex flex-col gap-2">
        <label htmlFor="xdr-input" className="text-[13px] text-muted-foreground">Transaction XDR</label>
        {/* four whole 18 px lines: no line is cut in half */}
        <Textarea
          id="xdr-input"
          placeholder="Paste transaction XDR here..."
          className="h-[98px] min-h-0 resize-none break-all font-address text-xs leading-[18px]"
          spellCheck={false}
          value={xdrInput}
          onChange={(e) => onXdrInputChange(e.target.value)}
        />
        {xdrError && <p className="text-[13px] text-destructive">{xdrError}</p>}
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        <span className="text-[13px] text-muted-foreground">Or import from Refractor</span>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </div>

      {/* Last Submitted Transaction */}
      {lastRefractorId && (
        <div className="well flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="sub">Last Submitted</h3>
            <div className="-mr-2 flex">
              <button
                type="button"
                onClick={copyRefractorId}
                aria-label="Copy Refractor ID"
                className="grid size-11 place-items-center text-muted-foreground hover:text-foreground"
              >
                {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setShowShareModal(true)}
                aria-label="Share"
                className="grid size-11 place-items-center text-muted-foreground hover:text-foreground"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <p className="break-all font-address text-[13px] text-muted-foreground">ID: {lastRefractorId}</p>
          <Button variant="outline" size="sm" className="self-start" onClick={openRefractor}>
            <img src={refractorLogo} alt="" className="h-4 w-4" />
            <span>View on Refractor</span>
          </Button>
        </div>
      )}

      {/* Import from Refractor */}
      <div className="flex flex-col gap-2">
        <label htmlFor="refractor-id" className="text-[13px] text-muted-foreground">Refractor transaction ID</label>
        <div className="flex gap-2">
          <Input
            id="refractor-id"
            placeholder="Enter Refractor transaction ID"
            className="font-address text-[13px]"
            value={refractorId}
            onChange={e => setRefractorId(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handlePullTransaction();
              }
            }}
          />
          <Button
            variant="outline"
            size="icon"
            className="size-12 shrink-0"
            onClick={() => setShowQRScanner(true)}
            aria-label="Scan QR code"
          >
            <QrCode className="!size-5" />
          </Button>
        </div>
        <Button
          onClick={handlePullTransaction}
          disabled={isPulling || !refractorId.trim()}
          className="mt-1 w-full"
        >
          {isPulling ? (
            <>
              <Spinner />
              Pulling...
            </>
          ) : (
            <>
              <Download />
              Pull
            </>
          )}
        </Button>
      </div>

      {/* Modals */}
      {lastRefractorId && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          refractorId={lastRefractorId}
          network={network}
        />
      )}

      <QRScanner
        isOpen={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={handleQRScan}
      />
    </div>
  );
};
