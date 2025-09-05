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
  const animationFrameRef = useRef<number | null>(null);
  const scanTimeoutRef = useRef<number | null>(null);
  const detectorRef = useRef<any>(null);
  const hasStartedRef = useRef(false);
  const [isScanning, setIsScanning] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const stopScanner = useCallback(() => {
    // Cancel any ongoing animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    // Clear scanning timeout
    if (scanTimeoutRef.current) {
      window.clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    
    // Stop all video tracks
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }

    // Reset video element
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
      videoRef.current.srcObject = null;
      videoRef.current.onloadedmetadata = null;
    }
    
    hasStartedRef.current = false;
    detectorRef.current = null;
    setIsScanning(false);
    setError(null);
  }, [stream]);

  const startScanner = useCallback(async () => {
    try {
      setError(null);
      
      // Check if camera API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available');
      }

      // Prefer back camera but allow fallback
      let mediaStream: MediaStream | null = null;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
      } catch (e) {
        // Fallback to any available camera
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      if (videoRef.current && mediaStream) {
        // Setup native detector if available
        const BD = (window as any).BarcodeDetector;
        if (BD) {
          try {
            detectorRef.current = new BD({ formats: ['qr_code'] });
          } catch {}
        }

        videoRef.current.srcObject = mediaStream;
        videoRef.current.muted = true; // Required for autoplay on iOS
        videoRef.current.setAttribute('muted', '');
        setStream(mediaStream);
        setIsScanning(true);
        
        // Ensure playback begins
        const startIfReady = () => {
          if (!hasStartedRef.current) {
            hasStartedRef.current = true;
            scanFrame();
          }
        };

        videoRef.current.onloadedmetadata = async () => {
          try { await videoRef.current?.play(); } catch {}
          startIfReady();
        };
        videoRef.current.addEventListener('canplay', startIfReady, { once: true });
      }
    } catch (error) {
      console.error('Camera access error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setError(errorMessage);
      toast({
        title: "Camera Access Error",
        description: errorMessage.includes('Permission denied') 
          ? "Please allow camera access to scan QR codes"
          : "Camera not available. Please check your device settings.",
        variant: "destructive",
      });
      onClose();
    }
  }, [toast, onClose]);

  function scanFrame() {
    if (!isScanning || !videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;
    
    // Try native BarcodeDetector first if available
    if (detector) {
      detector
        .detect(video)
        .then((codes: any[]) => {
          const value = codes && codes.length > 0 ? (codes[0].rawValue || codes[0].raw || codes[0].data) : undefined;
          if (value) {
            stopScanner();
            onScan(String(value));
            onClose();
            return;
          }
        })
        .catch((err: any) => {
          console.error('Native detector error:', err);
        })
        .finally(() => {
          if (isScanning) {
            scanTimeoutRef.current = window.setTimeout(scanFrame, 80);
          }
        });
      return;
    }

    try {
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        // Downscale for faster decoding
        const maxW = 640;
        const scale = Math.min(1, maxW / video.videoWidth);
        const targetW = Math.floor(video.videoWidth * scale);
        const targetH = Math.floor(video.videoHeight * scale);
        canvas.width = targetW;
        canvas.height = targetH;
        
        const context = canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
        if (context) {
          context.imageSmoothingEnabled = false;
          context.drawImage(video, 0, 0, targetW, targetH);
          const imageData = context.getImageData(0, 0, targetW, targetH);
          const code = jsQR(imageData.data, imageData.width, imageData.height);

          if (code && code.data) {
            // QR code detected
            stopScanner();
            onScan(code.data);
            onClose();
            return;
          }
        }
      }
    } catch (error) {
      console.error('Scanning error:', error);
    }

    // Continue scanning
    if (isScanning) {
      scanTimeoutRef.current = window.setTimeout(scanFrame, 80);
    }
  }

  useEffect(() => {
    if (isOpen && !isScanning && !stream) {
      startScanner();
    } else if (!isOpen && isScanning) {
      stopScanner();
    }
    
    return () => {
      stopScanner();
    };
  }, [isOpen, isScanning, stream, startScanner, stopScanner]);

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