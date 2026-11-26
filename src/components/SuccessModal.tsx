import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, Copy, ExternalLink, Mail, MessageCircle, Send } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { HashField } from '@/components/HashField';
import { QrCode } from '@/components/airgap/AirgapQRCode';
import { copyText, openExternal } from '@/lib/utils';

interface SuccessModalProps {
  refractorId: string;
  onClose: () => void;
}

/**
 * A transaction sent to Refractor for the other signers. (A transaction sent to the network is
 * followed in the SendSheet.)
 */
export const SuccessModal = ({ refractorId, onClose }: SuccessModalProps) => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const shareUrl = refractorId ? `${window.location.origin}${import.meta.env.BASE_URL}?r=${refractorId}` : '';

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
    if (refractorId) openExternal(`https://refractor.space/tx/${refractorId}`);
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle className="[text-wrap:balance]">Send for Signature</DialogTitle>
          <DialogDescription>Send this transaction to other signers for approval</DialogDescription>
        </DialogHeader>

        <>
            {shareUrl && <QrCode text={shareUrl} label="QR code for signature request" />}
            <HashField
              label={
                <span className="inline-flex items-center gap-1">
                  <a
                    href="https://refractor.space"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline decoration-line-2 underline-offset-4 hover:decoration-current"
                  >
                    Refractor.Space
                  </a>
                  {' ID'}
                </span>
              }
              copyLabel="Transaction ID"
              value={refractorId ?? ''}
              action={
                <button
                  type="button"
                  onClick={openExplorer}
                  aria-label="Open on Refractor"
                  className="-my-3 inline-grid size-11 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              }
            />
            {refractorId && (
              <>
                <Button className="w-full" onClick={copyShareLink}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" className="px-2" onClick={openEmailClient}>
                    <Mail />
                    Email
                  </Button>
                  <Button variant="outline" size="sm" className="px-2" onClick={openWhatsApp}>
                    <MessageCircle />
                    WhatsApp
                  </Button>
                  <Button variant="outline" size="sm" className="px-2" onClick={openTelegram}>
                    <Send />
                    Telegram
                  </Button>
                </div>
              </>
            )}
        </>
      </DialogContent>
    </Dialog>
  );
};
