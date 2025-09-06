import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AnimatedQRProps {
  data: string;
  type: 'xdr' | 'signature';
  title: string;
  description?: string;
}

export const AnimatedQR = ({ data, type, title, description }: AnimatedQRProps) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

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
            value={data}
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