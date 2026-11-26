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
        <QrCode aria-hidden="true" />
        Start Scanning
      </Button>
    );
  }

  // The scanner is a sheet of its own; in the page, Start Scanning turns into the way to stop.
  return (
    <>
      <QRScanner isOpen={isScanning} onScan={handleQRScan} onClose={() => setIsScanning(false)} />
      <Button variant="outline" className="w-full" onClick={() => setIsScanning(false)}>
        <X aria-hidden="true" />
        Cancel Scan
      </Button>
    </>
  );
};
