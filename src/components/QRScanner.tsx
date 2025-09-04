import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { QrCode, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsQR from 'jsqr';

interface QRScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

export const QRScanner = ({ isOpen, onClose, onScan }: QRScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && !isScanning) {
      startScanner();
    }
    
    return () => {
      stopScanner();
    };
  }, [isOpen]);

  const startScanner = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // Use back camera on mobile
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        setStream(mediaStream);
        setIsScanning(true);
        scanFrame();
      }
    } catch (error) {
      toast({
        title: "Camera Access Denied",
        description: "Please allow camera access to scan QR codes",
        variant: "destructive",
      });
      onClose();
    }
  };

  const stopScanner = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsScanning(false);
  };

  const scanFrame = () => {
    if (!isScanning || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.height = video.videoHeight;
      canvas.width = video.videoWidth;
      
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
          // QR code detected
          onScan(code.data);
          stopScanner();
          onClose();
          return;
        }
      }
    }

    requestAnimationFrame(scanFrame);
  };

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5" />
            Scan QR Code
          </DialogTitle>
          <DialogDescription>
            Scan a QR code to import a transaction from Refractor
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-64 bg-black rounded-lg object-cover"
            />
            <canvas
              ref={canvasRef}
              className="hidden"
            />
            
            {/* Scanning overlay */}
            <div className="absolute inset-0 border-2 border-primary rounded-lg">
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <div className="w-48 h-48 border-2 border-primary border-dashed rounded-lg animate-pulse">
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary"></div>
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary"></div>
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary"></div>
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary"></div>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Position the QR code within the frame to scan
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};