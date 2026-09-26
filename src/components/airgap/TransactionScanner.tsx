import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { QrCode, X } from 'lucide-react';
import { QRScanner } from '@/components/QRScanner';
import { parseTransactionPayload, type TransactionPayload } from '@/lib/sep7';
import { useToast } from '@/hooks/use-toast';

interface TransactionScannerProps {
  onTransaction: (payload: TransactionPayload) => void;
}

/** Scan a transaction QR code (SEP-7 URI or base64 XDR) with the camera. */
export const TransactionScanner = ({ onTransaction }: TransactionScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const { toast } = useToast();

  const handleQRScan = (data: string) => {
    const payload = parseTransactionPayload(data);
    if (!payload) {
      toast({
        title: 'Invalid QR Code',
        description: 'Expected a SEP-7 transaction URI or base64 XDR. Got: ' + (data.length > 50 ? data.substring(0, 50) + '...' : data),
        variant: 'destructive',
      });
      return;
    }
    onTransaction(payload);
    setIsScanning(false);
  };

  if (!isScanning) {
    return (
      <Button className="w-full" onClick={() => setIsScanning(true)}>
        <QrCode className="w-4 h-4 mr-2" />
        Start Scanning
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <QRScanner isOpen={isScanning} onScan={handleQRScan} onClose={() => setIsScanning(false)} />
      <Button variant="outline" className="w-full" onClick={() => setIsScanning(false)}>
        <X className="w-4 h-4 mr-2" />
        Cancel Scan
      </Button>
    </div>
  );
};
