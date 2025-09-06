import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Download, Upload, Copy, CheckCircle, Share2, QrCode } from 'lucide-react';
import refractorLogo from '@/assets/refractor-favicon.ico';
import { useToast } from '@/hooks/use-toast';
import { ShareModal } from './ShareModal';
import { QRScanner } from './QRScanner';
interface RefractorIntegrationProps {
  onPullTransaction: (refractorId: string) => Promise<void>;
  lastRefractorId?: string;
  network: 'mainnet' | 'testnet';
}
export const RefractorIntegration = ({
  onPullTransaction,
  lastRefractorId,
  network
}: RefractorIntegrationProps) => {
  const [refractorId, setRefractorId] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const {
    toast
  } = useToast();
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
  const handleQRScan = (data: string) => {
    // Check if it's a SEP-7 URI or Stellar Stratum deep link
    try {
      const url = new URL(data);
      
      // Check for SEP-7 tx URI
      if (url.protocol === 'web+stellar:' && url.pathname === 'tx') {
        const xdr = url.searchParams.get('xdr');
        if (xdr) {
          // This is XDR data, let the parent handle it directly
          // For now, just extract refractor ID if present
          const callback = url.searchParams.get('callback');
          if (callback) {
            try {
              const callbackUrl = new URL(callback);
              if (callbackUrl.hostname === 'refractor.space') {
                const refractorParam = callbackUrl.searchParams.get('r');
                if (refractorParam) {
                  setRefractorId(refractorParam);
                  handlePullTransaction();
                  return;
                }
              }
            } catch {
              // Invalid callback URL
            }
          }
        }
      }
      
      // Check for Stratum deep link
      const refractorParam = url.searchParams.get('r');
      if (refractorParam) {
        setRefractorId(refractorParam);
        handlePullTransaction();
        return;
      }
    } catch {
      // Not a valid URL, might be just the refractor ID
    }

    // Assume it's a refractor ID or XDR
    if (data.length > 50) {
      // Likely XDR data - could be handled by parent component
      // For now, just treat as refractor ID
    }
    setRefractorId(data);
  };
  const openRefractor = () => {
    const newWindow = window.open('https://refractor.space/', '_blank', 'noopener,noreferrer');
    if (newWindow) newWindow.opener = null;
  };
  return <Card className="shadow-card">
      <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <img src={refractorLogo} alt="Refractor" className="w-5 h-5 shrink-0" />
            Import Transaction
          </CardTitle>
          <CardDescription>
            Paste XDR directly or retrieve transactions from{' '}
            <a href="https://refractor.space/" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              Refractor.space
            </a>{' '}
            using an ID or QR code
          </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Last Submitted Transaction */}
        {lastRefractorId && <>
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  <span className="text-sm font-medium">Last Submitted</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={copyRefractorId}>
                    {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowShareModal(true)}>
                    <Share2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <p className="font-mono text-sm text-muted-foreground">
                ID: {lastRefractorId}
              </p>
              <Button variant="outline" size="sm" className="mt-2 inline-flex items-center gap-2" onClick={openRefractor}>
                <img src={refractorLogo} alt="Refractor" className="w-4 h-4" />
                <span>View on Refractor</span>
              </Button>
            </div>
            <Separator />
          </>}

        {/* Pull Transaction from Refractor */}
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="refractor-id">Refractor Transaction ID</Label>
            <div className="flex gap-2">
              <Input id="refractor-id" placeholder="Enter Refractor transaction ID" value={refractorId} onChange={e => setRefractorId(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter') {
                handlePullTransaction();
              }
            }} />
              <Button variant="outline" size="icon" onClick={() => setShowQRScanner(true)}>
                <QrCode className="w-4 h-4" />
              </Button>
              <Button onClick={handlePullTransaction} disabled={isPulling || !refractorId.trim()} size="sm" className="inline-flex items-center gap-2">
                {isPulling ? <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Pulling...
                  </div> : <>
                    <Download className="w-4 h-4" />
                    Pull
                  </>}
              </Button>
            </div>
          </div>
        </div>

        {/* Info */}
        
      </CardContent>

      {/* Modals */}
      {lastRefractorId && <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} refractorId={lastRefractorId} network={network} />}
      
      <QRScanner isOpen={showQRScanner} onClose={() => setShowQRScanner(false)} onScan={handleQRScan} />
    </Card>;
};