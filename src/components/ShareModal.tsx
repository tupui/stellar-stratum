import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Share2, Mail, MessageCircle, QrCode, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  refractorId: string;
  network: 'mainnet' | 'testnet';
}

export const ShareModal = ({ isOpen, onClose, refractorId, network }: ShareModalProps) => {
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const { toast } = useToast();

  const shareUrl = `${window.location.origin}?r=${refractorId}`;

  useEffect(() => {
    if (isOpen && refractorId) {
      // Generate QR code
      QRCode.toDataURL(shareUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).then(setQrCodeDataUrl);
    }
  }, [isOpen, refractorId, shareUrl]);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Copied to clipboard",
      description: "Share link has been copied",
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
      } catch (error) {
        // User cancelled or share failed
        console.log('Share cancelled or failed');
      }
    } else {
      // Fallback to copy
      copyToClipboard();
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5" />
            Share Transaction for Signature
          </DialogTitle>
          <DialogDescription>
            Share this link with other signers to collect signatures via Refractor
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Transaction ID */}
          <div className="space-y-2">
            <Label>Refractor Transaction ID</Label>
            <div className="p-3 bg-secondary/50 rounded-lg">
              <p className="font-mono text-sm text-muted-foreground break-all">
                {refractorId}
              </p>
            </div>
          </div>

          {/* Share URL */}
          <div className="space-y-2">
            <Label>Share Link</Label>
            <div className="flex gap-2">
              <Input
                value={shareUrl}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={copyToClipboard}
              >
                {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* QR Code */}
          {qrCodeDataUrl && (
            <div className="space-y-2">
              <Label>QR Code</Label>
              <div className="flex justify-center p-4 bg-white rounded-lg">
                <img src={qrCodeDataUrl} alt="QR Code" className="w-48 h-48" />
              </div>
            </div>
          )}

          {/* Share Options */}
          <div className="space-y-2">
            <Label>Share Options</Label>
            <div className="grid grid-cols-2 gap-2">
              {navigator.share && (
                <Button
                  variant="outline"
                  onClick={handleWebShare}
                  className="flex items-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </Button>
              )}
              <Button
                variant="outline"
                onClick={openEmailClient}
                className="flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                Email
              </Button>
              <Button
                variant="outline"
                onClick={openWhatsApp}
                className="flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </Button>
              <Button
                variant="outline"
                onClick={openTelegram}
                className="flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                Telegram
              </Button>
            </div>
          </div>

          <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
            <p className="text-sm text-primary">
              <strong>How it works:</strong> Other signers can use this link to load the transaction directly, 
              sign it, and submit back to the network when enough signatures are collected.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};