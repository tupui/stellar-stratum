import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, Copy, X, Mail, MessageCircle, Send, ExternalLink } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';
interface ModernShareModalProps {
  refractorId: string;
  onClose: () => void;
}
export const ModernShareModal = ({
  refractorId,
  onClose
}: ModernShareModalProps) => {
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const {
    toast
  } = useToast();
  const shareUrl = `${window.location.origin}?r=${refractorId}`;
  useEffect(() => {
    QRCode.toDataURL(shareUrl, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    }).then(setQrCodeDataUrl);
  }, [shareUrl]);
  const copyShareUrl = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = shareUrl;
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
        description: 'Share link has been copied',
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

  const copyRefractorId = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(refractorId);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = refractorId;
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
        description: 'Transaction ID has been copied',
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
  const openEmailClient = () => {
    const subject = encodeURIComponent('Sign Transaction on Stellar Stratum');
    const body = encodeURIComponent(`Please sign this transaction using Stellar Stratum:\n\nTransaction ID: ${refractorId}\nLink: ${shareUrl}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };
  const openWhatsApp = () => {
    const text = encodeURIComponent(`Please sign this transaction on Stellar Stratum: ${shareUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };
  const openTelegram = () => {
    const text = encodeURIComponent(`Please sign this transaction on Stellar Stratum: ${shareUrl}`);
    window.open(`https://t.me/share/url?url=${shareUrl}&text=${text}`, '_blank');
  };
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/40 supports-[backdrop-filter]:bg-background/30 backdrop-blur-2xl" />
      {/* Glows */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(1200px_600px_at_50%_-10%,hsl(var(--primary)/0.15),transparent_60%)]" />
      
      <Card className="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/20 bg-card/30 supports-[backdrop-filter]:bg-card/20 backdrop-blur-2xl shadow-xl shadow-primary/10">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent" />
        
        <CardHeader className="pb-4 relative">
          <div className="flex items-center justify-between">
            <CardTitle className="text-primary text-lg font-semibold">Send for Signature
          </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0 shrink-0 hover:bg-destructive/10 hover:text-destructive">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Send this transaction to other signers for approval</p>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* QR Code */}
          <div className="flex justify-center">
            <div className="p-3 rounded-xl border border-border/60 bg-background">
              {qrCodeDataUrl && <img src={qrCodeDataUrl} alt="Transaction QR code" className="w-40 h-40" loading="lazy" />}
            </div>
          </div>

          {/* Transaction ID */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                <a 
                  href="https://refractor.space" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors"
                >
                  Refractor.Space
                </a>
                {" ID"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => window.open(`https://api.refractor.space/tx/${refractorId}`, '_blank')} className="h-6 w-6 p-0">
                <ExternalLink className="w-3 h-3" />
              </Button>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/40 backdrop-blur-sm p-2">
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs break-all text-foreground/80 flex-1">{refractorId}</p>
                <Button variant="ghost" size="sm" onClick={() => copyRefractorId()} className="h-6 w-6 p-0 ml-2 shrink-0">
                  {copied ? <CheckCircle className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          </div>

          {/* Share Options */}
          <div className="space-y-4">
            {/* Copy Link */}
            <Button variant="outline" className="w-full h-12 bg-background/50 hover:bg-background/80 border-primary/20" onClick={copyShareUrl}>
              {copied ? <CheckCircle className="w-4 h-4 mr-2 text-success" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? 'Copied!' : 'Copy Link'}
            </Button>

            {/* Share Options Grid */}
            <div className="grid grid-cols-3 gap-3">
              <Button variant="outline" className="h-18 flex flex-col gap-2 px-4 py-3 bg-background/50 hover:bg-background/80 border-primary/20" onClick={openEmailClient}>
                <Mail className="w-5 h-5" />
                <span className="text-xs">Email</span>
              </Button>
              
              <Button variant="outline" className="h-18 flex flex-col gap-2 px-4 py-3 bg-background/50 hover:bg-background/80 border-primary/20" onClick={openWhatsApp}>
                <MessageCircle className="w-5 h-5" />
                <span className="text-xs">WhatsApp</span>
              </Button>
              
              <Button variant="outline" className="h-18 flex flex-col gap-2 px-4 py-3 bg-background/50 hover:bg-background/80 border-primary/20" onClick={openTelegram}>
                <Send className="w-5 h-5" />
                <span className="text-xs">Telegram</span>
              </Button>
            </div>
          </div>

          {/* Instructions */}
          
        </CardContent>
      </Card>
    </div>;
};