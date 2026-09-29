import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Copy, ExternalLink, X, Mail, MessageCircle, Send, Fingerprint } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';
import { createPortal } from 'react-dom';
import { buildSEP7TxUri } from '@/lib/sep7';
import { openExternal } from '@/lib/utils';
interface SuccessModalProps {
  type: 'network' | 'refractor' | 'offline';
  hash?: string;
  refractorId?: string;
  xdr?: string;
  network?: 'mainnet' | 'testnet';
  onClose: () => void;
  onNavigateToDashboard?: () => void;
}
export const SuccessModal = ({
  type,
  hash,
  refractorId,
  xdr,
  network = 'mainnet',
  onClose,
  onNavigateToDashboard
}: SuccessModalProps) => {
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const {
    toast
  } = useToast();
  const [qrError, setQrError] = useState(false);
  const shareUrl = type === 'refractor' && refractorId ? `${window.location.origin}${import.meta.env.BASE_URL}?r=${refractorId}` : '';
  useEffect(() => {
    let qrData = '';
    if (type === 'offline' && xdr) {
      // SEP-7 URI so the signing device also learns which network to sign for
      qrData = buildSEP7TxUri(xdr, network);
    } else if (type === 'refractor') {
      qrData = shareUrl;
    }
    if (!qrData) return;

    let cancelled = false;
    setQrError(false);
    QRCode.toDataURL(qrData, {
      width: 320,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    })
      .then((url) => {
        if (!cancelled) setQrCodeDataUrl(url);
      })
      .catch(() => {
        // Too much data for a single QR code (large batches, Soroban calls, many signatures)
        if (!cancelled) {
          setQrCodeDataUrl('');
          setQrError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [type, shareUrl, xdr, network]);
  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied to clipboard',
        description: `${label} has been copied`,
        duration: 2500
      });
    } catch (e) {
      toast({
        title: 'Could not copy',
        description: 'Please copy manually.',
        duration: 3000
      });
    }
  };
  const openExplorer = () => {
    if (type === 'network' && hash) {
      const baseUrl = network === 'testnet' ? 'https://stellar.expert/explorer/testnet' : 'https://stellar.expert/explorer/public';
      openExternal(`${baseUrl}/tx/${hash}`);
    } else if (type === 'refractor' && refractorId) {
      openExternal(`https://refractor.space/tx/${refractorId}`);
    }
  };
  const copyShareLink = async () => {
    if (!shareUrl) return;
    await copyToClipboard(shareUrl, 'Share link');
  };
  const handleWebShare = async () => {
    if (!shareUrl) return;
    const shareData = {
      title: 'Sign Transaction on Stellar Stratum',
      text: refractorId ? `Please sign this transaction: ${refractorId}` : 'Please sign this transaction',
      url: shareUrl
    };
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        // If canShare exists and returns false, fallback to copy
        if (typeof (navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare === 'function' && 
            (navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare && 
            !(navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare!(shareData)) {
          await copyShareLink();
          return;
        }
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share(shareData);
      } catch (err) {
        // Fallback to copy if share fails or is cancelled
        await copyShareLink();
      }
    } else {
      await copyShareLink();
    }
  };
  const openEmailClient = () => {
    if (!shareUrl) return;
    const subject = encodeURIComponent('Sign Transaction on Stellar Stratum');
    const body = encodeURIComponent(`Please sign this transaction using Stellar Stratum:\n\nTransaction ID: ${refractorId}\nLink: ${shareUrl}`);
    openExternal(`mailto:?subject=${subject}&body=${body}`);
  };
  const openWhatsApp = () => {
    if (!shareUrl) return;
    const text = encodeURIComponent(`Please sign this transaction on Stellar Stratum: ${shareUrl}`);
    openExternal(`https://wa.me/?text=${text}`);
  };
  const openTelegram = () => {
    if (!shareUrl) return;
    const text = encodeURIComponent(`Please sign this transaction on Stellar Stratum: ${shareUrl}`);
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${text}`);
  };
  const displayValue = type === 'network' || type === 'offline' ? hash : refractorId;
  const label = type === 'network' || type === 'offline' ? 'Transaction Hash' : 'Transaction ID';
  const title = type === 'network' ? 'Transaction Submitted Successfully' : 'Send for Signature';
  const description = type === 'network' ? 'Your transaction has been successfully submitted to the Stellar network' : type === 'offline' ? 'Scan this QR code with your air-gapped signing device' : 'Send this transaction to other signers for approval';
  return createPortal(
    <>
      {/* Full-screen backdrop that extends to all edges (rendered at document.body) */}
      <div className="fixed inset-0 z-[10000] bg-background/40 supports-[backdrop-filter]:bg-background/30 backdrop-blur-2xl" />
      {/* Soft radial glows */}
      <div className="fixed inset-0 z-[10001] pointer-events-none bg-[radial-gradient(1200px_600px_at_50%_-10%,hsl(var(--primary)/0.25),transparent_60%)]" />
      <div className="fixed inset-0 z-[10001] pointer-events-none bg-[radial-gradient(800px_400px_at_80%_100%,hsl(var(--success)/0.20),transparent_60%)]" />
      
      {/* Modal container */}
      <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4" onClick={onClose}>
        <Card className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-primary/20 bg-card/30 supports-[backdrop-filter]:bg-card/20 backdrop-blur-2xl shadow-xl shadow-primary/10 ring-1 ring-primary/15" onClick={(e) => e.stopPropagation()}>
          {/* Subtle top gradient sheen */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/15 via-transparent to-transparent" />
          <CardHeader className="pb-6 relative">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                
                <div>
                  <CardTitle className={`${type === 'refractor' || type === 'offline' ? 'text-stellar-yellow' : 'text-success'} text-xl font-semibold`}>{title}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => {
                onClose();
                // Only a finished submission leaves the page; a share or air-gap QR may still be needed.
                if (type === 'network') onNavigateToDashboard?.();
              }} className="h-8 w-8 p-0 shrink-0 hover:bg-destructive/10 hover:text-destructive">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-4 max-h-[80vh] overflow-y-auto">
            {/* Network Badge */}
            {type === 'network' && <div className="flex justify-center">
                <Badge variant={network === 'mainnet' ? 'default' : 'secondary'} className="px-3">
                  {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
                </Badge>
              </div>}

            {/* QR Code for Refractor and Offline */}
            {type === 'offline' && qrError && xdr && <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-3">
                <p className="text-sm text-foreground">
                  This transaction is too large for a single QR code. Transfer the XDR another way (copy it to a file or paste it on the signing device).
                </p>
                <Button variant="outline" size="sm" className="w-full" onClick={() => copyToClipboard(xdr, 'Transaction XDR')}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy XDR
                </Button>
              </div>}

            {(type === 'refractor' || type === 'offline') && (qrCodeDataUrl || qrError) && <div className="space-y-3">
                {qrCodeDataUrl && <div className="flex justify-center">
                  <div className="p-3 rounded-xl border border-border/60 bg-background">
                    <img src={qrCodeDataUrl} alt="QR code for signature request" className="w-64 h-64" />
                  </div>
                </div>}
                
                {/* ID/Hash below QR */}
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <Fingerprint className="w-3 h-3" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {type === 'refractor' ? (
                        <>
                          <a 
                            href="https://refractor.space" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-colors"
                          >
                            Refractor.Space
                          </a>
                          {" ID"}
                        </>
                      ) : label}
                    </span>
                    {type === 'refractor' && (
                      <Button variant="ghost" size="sm" onClick={openExplorer} className="h-6 w-6 p-0">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/40 backdrop-blur-sm p-2">
                    <div className="flex items-center justify-between">
                      <p className="font-address text-xs break-all text-foreground/80 flex-1">{displayValue}</p>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(displayValue || '', label)} className="h-6 w-6 p-0 ml-2 shrink-0">
                        {copied ? <CheckCircle className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>}

            {/* Hash Display for Network */}
            {type === 'network' && <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Fingerprint className="w-4 h-4" />
                    <span className="text-sm font-medium text-muted-foreground">{label}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(displayValue || '', label)} className="h-8 w-8 p-0">
                    {copied ? <CheckCircle className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/40 backdrop-blur-sm p-3">
                  <p className="font-address text-sm break-all text-foreground">{displayValue}</p>
                </div>
              </div>}
            
            {/* Share Options (Refractor only, not offline) */}
            {type === 'refractor' && refractorId && <div className="space-y-4">
                {/* Copy Link */}
                <Button variant="outline" className="w-full h-12 bg-background/50 hover:bg-background/80 border-primary/20" onClick={copyShareLink}>
                  {copied ? <CheckCircle className="w-4 h-4 mr-3 text-success" /> : <Copy className="w-4 h-4 mr-3" />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </Button>

                {/* Share Options Grid */}
                <div className="grid grid-cols-3 gap-6">
                  <Button variant="outline" className="h-16 flex flex-col gap-2 px-2 py-3 bg-background/50 hover:bg-background/80 border-primary/20" onClick={openEmailClient}>
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <Mail className="w-4 h-4 text-blue-500" />
                    </div>
                    <span className="text-xs font-medium">Email</span>
                  </Button>
                  
                  <Button variant="outline" className="h-16 flex flex-col gap-2 px-2 py-3 bg-background/50 hover:bg-background/80 border-primary/20" onClick={openWhatsApp}>
                    <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                      <MessageCircle className="w-4 h-4 text-green-500" />
                    </div>
                    <span className="text-xs font-medium">WhatsApp</span>
                  </Button>
                  
                  <Button variant="outline" className="h-16 flex flex-col gap-2 px-2 py-3 bg-background/50 hover:bg-background/80 border-primary/20" onClick={openTelegram}>
                    <div className="w-6 h-6 rounded-full bg-blue-400/20 flex items-center justify-center">
                      <Send className="w-4 h-4 text-blue-400" />
                    </div>
                    <span className="text-xs font-medium">Telegram</span>
                  </Button>
                </div>
              </div>}

            {/* Action Button for Network only */}
            {type === 'network' && <div className="flex gap-3 pt-2">
                <Button onClick={openExplorer} className="flex-1 bg-success hover:bg-success/90 text-success-foreground">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View on Stellar Expert
                </Button>
              </div>}
          </CardContent>
        </Card>
      </div>
    </>,
    document.body
  );
};