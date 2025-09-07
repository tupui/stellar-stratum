import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, X } from 'lucide-react';
import { QRScanner } from '@/components/QRScanner';
import { extractXdrFromData } from '@/lib/sep7';
import { tryParseTransaction } from '@/lib/xdr/parse';
import { useToast } from '@/hooks/use-toast';

interface AnimatedQRScannerProps {
  onDataReceived: (data: string, type: 'xdr' | 'signature') => void;
  expectedType?: 'xdr' | 'signature';
  title?: string;
  description?: string;
  embedded?: boolean;
}

export const AnimatedQRScanner = ({ 
  onDataReceived, 
  expectedType = 'xdr',
  title, 
  description,
  embedded = false
}: AnimatedQRScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const { toast } = useToast();

  const handleQRScan = (data: string) => {
    console.log('QR scanned:', data);
    
    // Extract XDR from SEP-7 URI or use raw data
    const xdr = extractXdrFromData(data);
    if (!xdr) {
      toast({
        title: 'Invalid QR Code',
        description: 'The QR code does not contain valid transaction data.',
        variant: 'destructive',
      });
      return;
    }

    // Validate XDR can be parsed
    const parsed = tryParseTransaction(xdr);
    if (!parsed) {
      toast({
        title: 'Invalid Transaction',
        description: 'Invalid transaction payload. Expecting a SEP-7 transaction QR or base64-encoded XDR.',
        variant: 'destructive',
      });
      return;
    }

    onDataReceived(xdr, expectedType);
    setIsScanning(false);
  };

  if (embedded) {
    return (
      <div className="space-y-4">
        {!isScanning ? (
          <Button
            className="w-full"
            onClick={() => setIsScanning(true)}
          >
            <QrCode className="w-4 h-4 mr-2" />
            Start Scanning
          </Button>
        ) : (
          <div className="space-y-4">
            <QRScanner
              isOpen={isScanning}
              onScan={handleQRScan}
              onClose={() => setIsScanning(false)}
            />
            
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setIsScanning(false)}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel Scan
            </Button>
          </div>
        )}
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
        {!isScanning ? (
          <Button
            className="w-full"
            onClick={() => setIsScanning(true)}
          >
            <QrCode className="w-4 h-4 mr-2" />
            Start Scanning
          </Button>
        ) : (
          <div className="space-y-4">
            <QRScanner
              isOpen={isScanning}
              onScan={handleQRScan}
              onClose={() => setIsScanning(false)}
            />
            
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setIsScanning(false)}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel Scan
            </Button>
          </div>
        )}

        <div className="text-xs text-muted-foreground text-center">
          <p>Scan QR codes from your signing device</p>
        </div>
      </CardContent>
    </Card>
  );
};