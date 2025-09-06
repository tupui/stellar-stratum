import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Camera, Upload, X } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import jsQR from 'jsqr';
import { useToast } from '@/hooks/use-toast';

interface QRScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

export const QRScanner = ({ isOpen, onClose, onScan }: QRScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      startScanner();
    } else {
      stopScanner();
    }
    
    return () => {
      stopScanner();
    };
  }, [isOpen]);

  const startScanner = async () => {
    try {
      console.log('Starting QR scanner...');
      setIsScanning(true);
      
      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
      }

      const reader = readerRef.current;
      
      // Get available video devices
      const videoDevices = await BrowserMultiFormatReader.listVideoInputDevices();
      console.log(`Found ${videoDevices.length} video devices`);
      
      // Prefer back camera
      const selectedDevice = videoDevices.find(device => 
        device.label.toLowerCase().includes('back') || 
        device.label.toLowerCase().includes('rear')
      ) || videoDevices[0];
      
      if (!selectedDevice) {
        throw new Error('No camera found');
      }
      
      console.log(`Using device: ${selectedDevice.label}`);
      
      // Start decoding from video device
      await reader.decodeFromVideoDevice(
        selectedDevice.deviceId,
        videoRef.current!,
          (result, error) => {
            if (result) {
              console.log('QR code detected:', result.getText());
              onScan(result.getText());
              stopScanner();
              onClose();
              toast({
                title: 'QR Code Scanned',
                description: 'Successfully scanned QR code',
              });
            }
            // Don't log errors as they're expected while scanning
          }
      );
      
      console.log('Scanner started successfully');
    } catch (error) {
      console.error('Error starting scanner:', error);
      setIsScanning(false);
      toast({
        title: 'Camera Error',
        description: 'Could not access camera for scanning',
        variant: 'destructive',
      });
    }
  };

  const stopScanner = () => {
    console.log('Stopping QR scanner...');
    
    if (readerRef.current) {
      try {
        // ZXing doesn't have a reset method, just set to null to clean up
        readerRef.current = null;
      } catch (error) {
        console.warn('Error cleaning up reader:', error);
      }
    }
    
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
      });
      setStream(null);
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsScanning(false);
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsProcessingImage(true);
    
    try {
      console.log('Processing uploaded image...');
      
      // Create an image element and wait for it to load
      const img = new Image();
      const imageUrl = URL.createObjectURL(file);
      
      img.onload = async () => {
        try {
          let result = null;
          
          // Try ZXing first
          if (!readerRef.current) {
            readerRef.current = new BrowserMultiFormatReader();
          }
          
          try {
            result = await readerRef.current!.decodeFromImageElement(img);
          } catch (zxingError) {
            console.log('ZXing failed, trying jsQR fallback...');
            
            // Try jsQR as fallback
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d')!;
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const jsQRResult = jsQR(imageData.data, imageData.width, imageData.height);
            
            if (jsQRResult) {
              result = { getText: () => jsQRResult.data };
            }
          }
          
          if (result) {
            console.log('QR code detected from image:', result.getText());
            onScan(result.getText());
            onClose();
            toast({
              title: 'QR Code Scanned',
              description: 'Successfully read QR code from image',
            });
          } else {
            throw new Error('No QR code found in image');
          }
          
          URL.revokeObjectURL(imageUrl);
        } catch (error) {
          console.error('Error reading QR code from image:', error);
          URL.revokeObjectURL(imageUrl);
          toast({
            title: 'Scan Failed',
            description: 'No valid QR code found in the uploaded image',
            variant: 'destructive',
          });
        } finally {
          setIsProcessingImage(false);
        }
      };
      
      img.onerror = () => {
        console.error('Error loading image');
        URL.revokeObjectURL(imageUrl);
        setIsProcessingImage(false);
        toast({
          title: 'Upload Failed',
          description: 'Could not load the uploaded image',
          variant: 'destructive',
        });
      };
      
      img.src = imageUrl;
    } catch (error) {
      console.error('Error processing image upload:', error);
      setIsProcessingImage(false);
      toast({
        title: 'Upload Failed',
        description: 'Error processing the uploaded image',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Scan QR Code
          </DialogTitle>
          <DialogDescription>
            Position the QR code within the camera frame to scan it
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Video Container */}
          <div className="relative aspect-square bg-muted rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay
              muted
              playsInline
            />
            
            {/* Scanning overlay */}
            <div className="absolute inset-4 border-2 border-dashed border-primary/50 rounded-lg pointer-events-none">
              <div className="absolute inset-0 flex items-center justify-center">
                {isScanning && (
                  <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                    Scanning...
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Upload Alternative */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Or upload an image containing a QR code
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingImage}
            >
              <Upload className="w-4 h-4 mr-2" />
              {isProcessingImage ? 'Processing...' : 'Upload Image'}
            </Button>
          </div>
          
          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};