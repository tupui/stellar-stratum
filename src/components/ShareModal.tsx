import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Copy, Mail, MessageCircle, Send, Share2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { QrCode } from '@/components/airgap/AirgapQRCode';
import { cn, openExternal } from '@/lib/utils';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  refractorId: string;
  network: 'mainnet' | 'testnet';
}

export const ShareModal = ({ isOpen, onClose, refractorId }: ShareModalProps) => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}?r=${refractorId}`;
  const canShare = typeof navigator !== 'undefined' && Boolean(navigator.share);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: 'Copied to clipboard',
      description: 'Share link has been copied',
      duration: 3000,
    });
  };

  const handleWebShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Sign Transaction on Stellar Stratum',
          text: `Please sign this transaction: ${refractorId}`,
          url: shareUrl,
        });
      } catch {
        // Share cancelled or failed
      }
    } else {
      // Fallback to copy
      copyToClipboard();
    }
  };

  const openEmailClient = () => {
    const subject = encodeURIComponent('Sign Transaction on Stellar Stratum');
    const body = encodeURIComponent(`Please sign this transaction using Stellar Stratum:\n\nTransaction ID: ${refractorId}\nLink: ${shareUrl}`);
    openExternal(`mailto:?subject=${subject}&body=${body}`);
  };

  const openWhatsApp = () => {
    const text = encodeURIComponent(`Please sign this transaction on Stellar Stratum: ${shareUrl}`);
    openExternal(`https://wa.me/?text=${text}`);
  };

  const openTelegram = () => {
    const text = encodeURIComponent(`Please sign this transaction on Stellar Stratum: ${shareUrl}`);
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${text}`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle className="[text-wrap:balance]">Share Transaction for Signature</DialogTitle>
          <DialogDescription>Share this link with other signers to collect signatures via Refractor</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {isOpen && refractorId && (
            <div className="flex flex-col gap-2">
              <span className="field-label">QR code</span>
              <QrCode text={shareUrl} label="QR code" />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="field-label">Refractor transaction ID</span>
            <p className="break-all border border-line bg-ink-3 px-3 py-2 font-address text-[13px] leading-[1.55] text-muted-foreground">
              {refractorId}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="share-link" className="field-label">
              Share link
            </label>
            <div className="flex gap-2">
              <Input id="share-link" value={shareUrl} readOnly className="min-w-0 font-address text-[13px]" />
              <Button size="icon" className="h-12 w-12 shrink-0" aria-label="Copy share link" onClick={copyToClipboard}>
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="field-label">Share options</span>
            <div className={cn('grid gap-2', canShare ? 'grid-cols-2' : 'grid-cols-3')}>
              {canShare && (
                <Button variant="outline" size="sm" className="px-2" onClick={handleWebShare}>
                  <Share2 />
                  Share
                </Button>
              )}
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
          </div>

          <p className="notice block leading-relaxed">
            <b className="font-semibold">How it works:</b>{' '}
            <span className="text-muted-foreground">
              Other signers can use this link to load the transaction directly, sign it, and submit back to the network when
              enough signatures are collected.
            </span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
