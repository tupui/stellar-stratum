import { useState, useRef, useEffect, useCallback } from 'react';
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
  const scanIntervalRef = useRef<number | null>(null);
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

  const startScanner = useCallback(async () => {
    if (import.meta.env.DEV) console.log('Starting QR scanner...');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available');
      }

      // Try back camera first, fallback to any camera
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        if (import.meta.env.DEV) console.log('Got back camera stream');
      } catch (e) {
        if (import.meta.env.DEV) console.log('Back camera failed, trying any camera');
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 }, 
            height: { ideal: 720 } 
          } 
        });
        if (import.meta.env.DEV) console.log('Got camera stream');
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Ensure inline autoplay for iOS
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;

        setStream(mediaStream);
        setIsScanning(true);

        // Try enabling continuous autofocus if supported
        try {
          const [track] = mediaStream.getVideoTracks();
          if (track && 'applyConstraints' in track) {
            // @ts-expect-error - browser specific advanced constraints
            track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {
              // Continuous focus not supported, ignore
            });
          }
        } catch {
          // Advanced camera constraints not supported
        }
        
        // Wait for video to be ready and start scanning
        const startScanning = () => {
          if (import.meta.env.DEV) console.log('Video ready, starting scan loop');
          scanIntervalRef.current = window.setInterval(scanFrame, 120); // Scan every ~120ms
        };
        
        videoRef.current.onloadedmetadata = () => {
          if (import.meta.env.DEV) console.log('Video metadata loaded');
          videoRef.current?.play().then(() => {
            if (import.meta.env.DEV) console.log('Video playing');
            startScanning();
          }).catch((error) => {
            console.error('Play failed:', error);
            startScanning(); // Try scanning anyway
          });
        };
      }
    } catch (error) {
      console.error('Camera access error:', error);
      toast({
        title: "Camera Access Error",
        description: "Please allow camera access to scan QR codes",
        variant: "destructive",
      });
      onClose();
    }
  }, [toast, onClose]);

  const stopScanner = useCallback(() => {
    if (import.meta.env.DEV) console.log('Stopping QR scanner...');
    
    // Clear scan interval
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    
    // Stop video stream
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    
    // Reset video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.onloadedmetadata = null;
    }
    
    setIsScanning(false);
  }, [stream]);

  const scanFrame = useCallback(() => {
    if (!isScanning || !videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    try {
      // Check if video has data and dimensions
      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // Use a more aggressive scan area - full center region
        const side = Math.floor(Math.min(vw, vh) * 0.8); // Increased to 80%
        const sx = Math.floor((vw - side) / 2);
        const sy = Math.floor((vh - side) / 2);

        // Use higher resolution for better detection
        const target = Math.min(800, side); // Increased to 800px
        canvas.width = target;
        canvas.height = target;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Enable smoothing for better image quality
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(video, sx, sy, side, side, 0, 0, target, target);

          const imageData = ctx.getImageData(0, 0, target, target);
          
          // Try multiple detection configurations
          const configs = [
            { inversionAttempts: 'attemptBoth' as const },
            { inversionAttempts: 'onlyInvert' as const },
            { inversionAttempts: 'dontInvert' as const }
          ];

          for (const config of configs) {
            const qrCode = jsQR(imageData.data, imageData.width, imageData.height, config);
            if (qrCode && qrCode.data) {
              if (import.meta.env.DEV) console.log('QR detected with config:', config, 'Data:', qrCode.data);
              stopScanner();
              onScan(qrCode.data);
              onClose();
              return;
            }
          }
        }
      } else {
        // Occasional debug log when video not ready
        if (Math.random() < 0.01) { // ~1% chance
          if (import.meta.env.DEV) console.log('Video not ready:', {
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight
          });
        }
      }
    } catch (error) {
      console.error('QR scanning error:', error);
    }
  }, [isScanning, stopScanner, onScan, onClose]);

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
              muted
              playsInline
              className="w-full h-64 bg-black rounded-lg object-cover"
            />
            <canvas
              ref={canvasRef}
              className="hidden"
            />
            
            {/* Scanning overlay with QR code frame */}
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