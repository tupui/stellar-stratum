import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Copy, ExternalLink, X, Share2, Mail, MessageCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';

interface SuccessModalProps {
  type: 'network' | 'refractor';
  hash?: string;
  refractorId?: string;
  network?: 'mainnet' | 'testnet';
  onClose: () => void;
}

export const SuccessModal = ({ type, hash, refractorId, network = 'mainnet', onClose }: SuccessModalProps) => {
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const { toast } = useToast();

  const shareUrl = type === 'refractor' && refractorId 
    ? `${window.location.origin}?r=${refractorId}`
    : '';

  useEffect(() => {
    if (type === 'refractor' && shareUrl) {
      QRCode.toDataURL(shareUrl, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).then(setQrCodeDataUrl);
    }
  }, [type, shareUrl]);

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Copied to clipboard",
      description: `${label} has been copied`,
      duration: 3000,
    });
  };

  const openExplorer = () => {
    if (type === 'network' && hash) {
      const baseUrl = network === 'testnet' 
        ? 'https://stellar.expert/explorer/testnet' 
        : 'https://stellar.expert/explorer/public';
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
    if (navigator.share && shareUrl) {
      try {
        await navigator.share({
          title: 'Sign Transaction on Stellar Stratum',
          text: `Please sign this transaction: ${refractorId}`,
          url: shareUrl,
        });
      } catch (error) {
        // ignore
      }
    } else {
      copyShareLink();
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
  const title = type === 'network' 
    ? 'Transaction Submitted Successfully'
    : 'Submitted to Refractor Successfully';
  const description = type === 'network'
    ? 'Your transaction has been successfully submitted to the Stellar network'
    : 'Your transaction has been submitted to Refractor for signature collection';

  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl border">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-success" />
              </div>
              <div>
                <CardTitle className="text-success text-lg">{title}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{description}</p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose}
              className="h-8 w-8 p-0 shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Network Badge */}
          {type === 'network' && (
            <div className="flex justify-center">
              <Badge variant={network === 'mainnet' ? 'default' : 'secondary'} className="px-3">
                {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
              </Badge>
            </div>
          )}

          {/* QR Code for Refractor */}
          {type === 'refractor' && qrCodeDataUrl && (
            <div className="space-y-3">
              <div className="flex justify-center">
                <div className="p-4 bg-white rounded-lg border">
                  <img src={qrCodeDataUrl} alt="QR Code" className="w-40 h-40" />
                </div>
              </div>
              
              {/* Refractor ID below QR */}
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={openExplorer}
                    className="h-6 w-6 p-0"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                </div>
                <div 
                  className="bg-secondary/50 rounded-lg p-2 border cursor-pointer hover:bg-secondary/70 transition-colors"
                  onClick={() => copyToClipboard(displayValue || '', label)}
                >
                  <p className="font-mono text-xs text-center break-all text-muted-foreground">{displayValue}</p>
                </div>
              </div>
            </div>
          )}

          {/* Hash Display for Network */}
          {type === 'network' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(displayValue || '', label)}
                  className="h-8 w-8 p-0"
                >
                  {copied ? <CheckCircle className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3 border">
                <p className="font-mono text-sm break-all text-foreground">{displayValue}</p>
              </div>
            </div>
          )}
          
          {/* Share Options (Refractor) */}
          {type === 'refractor' && refractorId && (
            <div className="space-y-3">
              <span className="text-sm font-medium text-muted-foreground">Share for signatures</span>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {typeof navigator !== 'undefined' && 'share' in navigator && (
                    <Button variant="outline" onClick={handleWebShare} className="text-sm h-9">
                      <Share2 className="w-4 h-4 mr-2" />
                      Share
                    </Button>
                  )}
                  <Button variant="outline" onClick={copyShareLink} className="text-sm h-9">
                    <Copy className="w-4 h-4 mr-2" />
                    Copy link
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="ghost" size="sm" onClick={openEmailClient} className="text-xs h-8">
                    <Mail className="w-3 h-3 mr-1" />
                    Email
                  </Button>
                  <Button variant="ghost" size="sm" onClick={openWhatsApp} className="text-xs h-8">
                    <MessageCircle className="w-3 h-3 mr-1" />
                    WhatsApp
                  </Button>
                  <Button variant="ghost" size="sm" onClick={openTelegram} className="text-xs h-8">
                    <MessageCircle className="w-3 h-3 mr-1" />
                    Telegram
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Action Button for Network only */}
          {type === 'network' && (
            <div className="flex gap-3 pt-2">
              <Button 
                onClick={openExplorer}
                className="flex-1 bg-success hover:bg-success/90 text-success-foreground"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View on Stellar Expert
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};