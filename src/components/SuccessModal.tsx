import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Copy, ExternalLink, X, Share2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';
import { createPortal } from 'react-dom';
import { ModernShareModal } from './ModernShareModal';
interface SuccessModalProps {
  type: 'network' | 'refractor';
  hash?: string;
  refractorId?: string;
  network?: 'mainnet' | 'testnet';
  onClose: () => void;
}
export const SuccessModal = ({
  type,
  hash,
  refractorId,
  network = 'mainnet',
  onClose
}: SuccessModalProps) => {
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [showShareModal, setShowShareModal] = useState(false);
  const {
    toast
  } = useToast();
  const shareUrl = type === 'refractor' && refractorId ? `${window.location.origin}?r=${refractorId}` : '';
  useEffect(() => {
    if (type === 'refractor' && shareUrl) {
      QRCode.toDataURL(shareUrl, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      }).then(setQrCodeDataUrl);
    }
  }, [type, shareUrl]);
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
      window.open(`${baseUrl}/tx/${hash}`, '_blank');
    } else if (type === 'refractor' && refractorId) {
      window.open(`https://api.refractor.space/tx/${refractorId}`, '_blank');
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
        if (typeof (navigator as any).canShare === 'function' && (navigator as any).canShare && !(navigator as any).canShare(shareData)) {
          await copyShareLink();
          return;
        }
        await (navigator as any).share(shareData);
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
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };
  const openWhatsApp = () => {
    if (!shareUrl) return;
    const text = encodeURIComponent(`Please sign this transaction on Stellar Stratum: ${shareUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };
  const openTelegram = () => {
    if (!shareUrl) return;
    const text = encodeURIComponent(`Please sign this transaction on Stellar Stratum: ${shareUrl}`);
    window.open(`https://t.me/share/url?url=${shareUrl}&text=${text}`, '_blank');
  };
  const displayValue = type === 'network' ? hash : refractorId;
  const label = type === 'network' ? 'Transaction Hash' : 'Transaction ID';
  const title = type === 'network' ? 'Transaction Submitted Successfully' : 'Submitted to Refractor Successfully';
  const description = type === 'network' ? 'Your transaction has been successfully submitted to the Stellar network' : 'Send this transaction to other signers for approval';
  return createPortal(
    <>
      {/* Full-screen backdrop that extends to all edges (rendered at document.body) */}
      <div className="fixed inset-0 z-[10000] bg-background/40 supports-[backdrop-filter]:bg-background/30 backdrop-blur-2xl" />
      {/* Soft radial glows */}
      <div className="fixed inset-0 z-[10001] pointer-events-none bg-[radial-gradient(1200px_600px_at_50%_-10%,hsl(var(--primary)/0.25),transparent_60%)]" />
      <div className="fixed inset-0 z-[10001] pointer-events-none bg-[radial-gradient(800px_400px_at_80%_100%,hsl(var(--success)/0.20),transparent_60%)]" />
      
      {/* Modal container */}
      <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4">
        <Card className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-primary/20 bg-card/30 supports-[backdrop-filter]:bg-card/20 backdrop-blur-2xl shadow-xl shadow-primary/10 ring-1 ring-primary/15">
          {/* Subtle top gradient sheen */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/15 via-transparent to-transparent" />
          <CardHeader className="pb-6 relative">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                
                <div>
                  <CardTitle className={`${type === 'refractor' ? 'text-primary' : 'text-success'} text-xl font-semibold`}>{title}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0 shrink-0 hover:bg-destructive/10 hover:text-destructive">
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

            {/* QR Code for Refractor */}
            {type === 'refractor' && qrCodeDataUrl && <div className="space-y-3">
                <div className="flex justify-center">
                  <div className="p-3 rounded-xl border border-border/60 bg-background">
                    <img src={qrCodeDataUrl} alt="QR code for signature request" className="w-44 h-44" loading="lazy" />
                  </div>
                </div>
                
                {/* Refractor ID below QR */}
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
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
                    <Button variant="ghost" size="sm" onClick={openExplorer} className="h-6 w-6 p-0">
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/40 backdrop-blur-sm p-2">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-xs break-all text-foreground/80 flex-1">{displayValue}</p>
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
                  <span className="text-sm font-medium text-muted-foreground">{label}</span>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(displayValue || '', label)} className="h-8 w-8 p-0">
                    {copied ? <CheckCircle className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/40 backdrop-blur-sm p-3">
                  <p className="font-mono text-sm break-all text-foreground">{displayValue}</p>
                </div>
              </div>}
            
            {/* Share Options (Refractor) */}
            {type === 'refractor' && refractorId && <div className="space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={copyShareLink} className="h-8 px-3">
                    {copied ? <CheckCircle className="w-4 h-4 mr-1 text-success" /> : <Copy className="w-4 h-4 mr-1" />}
                    Copy link
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowShareModal(true)} className="h-8 px-3">
                    <Share2 className="w-4 h-4 mr-1" />
                    Share
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
        
        {/* Modern Share Modal */}
        {showShareModal && refractorId && <ModernShareModal refractorId={refractorId} onClose={() => setShowShareModal(false)} />}
      </div>
    </>,
    document.body
  );
};