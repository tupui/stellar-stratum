import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Copy, ExternalLink, Mail, MessageCircle, Send, Fingerprint } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';
import { GlassModal } from '@/components/GlassModal';
import { HashField } from '@/components/HashField';
import { copyText, openExternal } from '@/lib/utils';

interface SuccessModalProps {
  type: 'network' | 'refractor';
  hash?: string;
  refractorId?: string;
  network?: 'mainnet' | 'testnet';
  onClose: () => void;
  onNavigateToDashboard?: () => void;
}

/** A transaction sent to the network, or to Refractor for the other signers. */
export const SuccessModal = ({ type, hash, refractorId, network = 'mainnet', onClose, onNavigateToDashboard }: SuccessModalProps) => {
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const { toast } = useToast();
  const shareUrl = type === 'refractor' && refractorId ? `${window.location.origin}${import.meta.env.BASE_URL}?r=${refractorId}` : '';

  useEffect(() => {
    if (!shareUrl) return;
    let cancelled = false;
    QRCode.toDataURL(shareUrl, { width: 320, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setQrCodeDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrCodeDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Copied to clipboard', description: `${label} has been copied`, duration: 2500 });
    } catch {
      toast({ title: 'Could not copy', description: 'Please copy manually.', duration: 3000 });
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

  const label = type === 'network' ? 'Transaction Hash' : 'Transaction ID';
  const displayValue = type === 'network' ? hash : refractorId;

  return (
    <GlassModal
      title={type === 'network' ? 'Transaction Submitted Successfully' : 'Send for Signature'}
      description={
        type === 'network' ? 'Your transaction has been successfully submitted to the Stellar network' : 'Send this transaction to other signers for approval'
      }
      tone={type === 'network' ? 'done' : 'pending'}
      onClose={() => {
        onClose();
        // Only a finished submission leaves the page; a share link may still be needed.
        if (type === 'network') onNavigateToDashboard?.();
      }}
    >
      {type === 'network' && (
        <div className="flex justify-center">
          <Badge variant={network === 'mainnet' ? 'default' : 'secondary'} className="px-3">
            {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
          </Badge>
        </div>
      )}

      {type === 'refractor' && qrCodeDataUrl && (
        <div className="space-y-3">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl border border-border/60 bg-background">
              <img src={qrCodeDataUrl} alt="QR code for signature request" className="w-64 h-64" />
            </div>
          </div>
          <HashField
            label={
              <>
                <a href="https://refractor.space" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  Refractor.Space
                </a>
                {' ID'}
              </>
            }
            copyLabel={label}
            value={displayValue ?? ''}
            action={
              <Button variant="ghost" size="sm" onClick={openExplorer} className="h-6 w-6 p-0">
                <ExternalLink className="w-3 h-3" />
              </Button>
            }
          />
        </div>
      )}

      {type === 'network' && (
        <div className="space-y-2">
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
        </div>
      )}

      {type === 'refractor' && refractorId && (
        <div className="space-y-4">
          <Button variant="outline" className="w-full h-12 bg-background/50 hover:bg-background/80 border-primary/20" onClick={copyShareLink}>
            {copied ? <CheckCircle className="w-4 h-4 mr-3 text-success" /> : <Copy className="w-4 h-4 mr-3" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>

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
        </div>
      )}

      {type === 'network' && (
        <div className="flex gap-3 pt-2">
          <Button onClick={openExplorer} className="flex-1 bg-success hover:bg-success/90 text-success-foreground">
            <ExternalLink className="w-4 h-4 mr-2" />
            View on Stellar Expert
          </Button>
        </div>
      )}
    </GlassModal>
  );
};
