import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { QrCode, X } from 'lucide-react';
import { QRScanner, type ScanRefusal } from '@/components/QRScanner';
import { isRefusal, parseTransactionPayload, type TransactionPayload } from '@/lib/sep7';

interface TransactionScannerProps {
  onTransaction: (payload: TransactionPayload) => void;
}

/** Scan a transaction QR code (SEP-7 URI or base64 XDR) with the camera. */
export const TransactionScanner = ({ onTransaction }: TransactionScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);

  const handleQRScan = (data: string): ScanRefusal | void => {
    const payload = parseTransactionPayload(data);
    if (isRefusal(payload)) return { title: 'Transaction refused', description: payload.refused };
    if (!payload) return { title: 'Unrecognized QR code', description: 'Expected a transaction: a SEP-7 QR, an animated QR or XDR.' };
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
