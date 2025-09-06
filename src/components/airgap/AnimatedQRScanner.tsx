import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, X } from 'lucide-react';
import { QRScanner } from '@/components/QRScanner';
import { extractXdrFromData } from '@/lib/sep7';

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

  const handleQRScan = (data: string) => {
    // Extract XDR from SEP-7 URI or use raw data
    const xdr = extractXdrFromData(data);
    if (xdr) {
      onDataReceived(xdr, expectedType);
      setIsScanning(false);
    }
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