import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { buildSEP7TxUri } from '@/lib/sep7';
import { useNetwork } from '@/contexts/NetworkContext';
import { getNetworkPassphrase } from '@/lib/stellar';

interface AnimatedQRProps {
  data: string;
  type: 'xdr' | 'signature';
  title?: string;
  description?: string;
  embedded?: boolean;
}

export const AnimatedQR = ({ data, type, title, description, embedded = false }: AnimatedQRProps) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const { network } = useNetwork();

  // Generate proper SEP-7 URI for XDR data, raw data for signatures
  const qrData = type === 'xdr' ? buildSEP7TxUri({
    xdr: data,
    network: network === 'testnet' ? 'testnet' : 'public'
  }) : data;

  const handleCopyData = async () => {
    await navigator.clipboard.writeText(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: 'Copied to clipboard',
      description: `${type.toUpperCase()} data has been copied`,
    });
  };

  if (!data) {
    return null;
  }

  if (embedded) {
    return (
      <div className="space-y-4">
        {/* QR Code Display */}
        <div className="flex justify-center p-4 bg-white rounded-lg border">
          <QRCodeSVG
            value={qrData}
            size={200}
            level="M"
            includeMargin={true}
          />
        </div>

        {/* Copy Original Data */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleCopyData}
        >
          {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
          Copy Original Data
        </Button>
      </div>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* QR Code Display */}
        <div className="flex justify-center p-4 bg-white rounded-lg">
          <QRCodeSVG
            value={qrData}
            size={200}
            level="M"
            includeMargin={true}
          />
        </div>

        {/* Copy Original Data */}
        <div className="pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleCopyData}
          >
            {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
            Copy Original Data
          </Button>
        </div>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground text-center">
          <p>Scan this QR code with your signing device</p>
        </div>
      </CardContent>
    </Card>
  );
};