import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Camera, Upload, X, RotateCcw } from 'lucide-react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
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
  const [waitingForCamera, setWaitingForCamera] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState(0);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const { toast } = useToast();

  const startScanner = useCallback(async () => {
    try {
      setIsScanning(true);
      setWaitingForCamera(true);
      
      if (!readerRef.current) {
        // ZXing hints: focus on QR only and try harder for partially visible/angled codes
        const hints = new Map<DecodeHintType, unknown>();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = readerRef.current = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 75 });
      }

      const reader = readerRef.current;
      
      // Enumerate video devices first
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        setAvailableDevices(devices);
        
        // Use specific device if available, otherwise fallback to constraints
        if (devices.length > 0) {
          const selectedDevice = devices[currentDeviceIndex] || devices[0];
          
          // High-quality constraints for better small QR detection
          const constraints: MediaStreamConstraints = {
            video: {
              deviceId: selectedDevice.deviceId,
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              frameRate: { ideal: 60, min: 24 },
              facingMode: { ideal: 'environment' },
              advanced: [
                // Best-effort continuous focus for sharper frames
                { focusMode: 'continuous' } as MediaTrackConstraintSet,
                { focusMode: 'auto' } as MediaTrackConstraintSet,
              ]
            }
          };
          
          const controls = await reader.decodeFromConstraints(
            constraints,
            videoRef.current!,
            (result) => {
              if (result) {
                onScan(result.getText());
                stopScanner();
                onClose();
                toast({
                  title: 'QR Code Scanned',
                  description: 'Successfully scanned QR code',
                });
              }
            }
          );
          
          controlsRef.current = controls;
          
          // Try to apply zoom if supported (best effort)
          try {
            if (videoRef.current && videoRef.current.srcObject) {
              const stream = videoRef.current.srcObject as MediaStream;
              const track = stream.getVideoTracks()[0];
              if (track && 'getCapabilities' in track) {
                const capabilities = (track.getCapabilities?.() || {}) as MediaTrackCapabilities;
                const advanced: MediaTrackConstraintSet[] = [];
                if (capabilities.zoom && capabilities.zoom.max) {
                  const suggestedZoom = Math.min(capabilities.zoom.max, 2);
                  advanced.push({ zoom: suggestedZoom } as MediaTrackConstraintSet);
                }
                if (capabilities.focusMode && capabilities.focusMode.length) {
                  advanced.push({ focusMode: 'continuous' } as MediaTrackConstraintSet);
                }
                if (advanced.length) {
                  await track.applyConstraints({ advanced });
                }
              }
            }
          } catch (capError) {
            // Ignore advanced camera constraints errors
          }
        } else {
          // Fallback to constraints if no devices found
        const constraints: MediaStreamConstraints = {
          video: { 
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 60, min: 24 },
            advanced: [
              { focusMode: 'continuous' } as MediaTrackConstraintSet,
              { focusMode: 'auto' } as MediaTrackConstraintSet,
            ]
          }
        };
          
          const controls = await reader.decodeFromConstraints(
            constraints,
            videoRef.current!,
            (result) => {
              if (result) {
                onScan(result.getText());
                stopScanner();
                onClose();
                toast({
                  title: 'QR Code Scanned',
                  description: 'Successfully scanned QR code',
                });
              }
            }
          );
          
          controlsRef.current = controls;
        }
        
        // Wait for video to load
        if (videoRef.current) {
          videoRef.current.addEventListener('loadedmetadata', () => {
            setWaitingForCamera(false);
          }, { once: true });
        }
        
      } catch (deviceError) {
        
        // Fallback to constraints with high quality
        const constraints: MediaStreamConstraints = {
          video: { 
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 60, min: 24 },
            advanced: [
              { focusMode: 'continuous' } as MediaTrackConstraintSet,
              { focusMode: 'auto' } as MediaTrackConstraintSet,
            ]
          }
        };
        
        const controls = await reader.decodeFromConstraints(
          constraints,
          videoRef.current!,
          (result) => {
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
          }
        );
        
        controlsRef.current = controls;
        setWaitingForCamera(false);
      }
    } catch (error) {
      setIsScanning(false);
      setWaitingForCamera(false);
      toast({
        title: 'Camera Error',
        description: 'Camera access denied or unavailable. Try switching camera or upload an image.',
        variant: 'destructive',
      });
    }
  }, [onScan, onClose, toast, currentDeviceIndex]);

  const stopScanner = () => {
    
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
        controlsRef.current = null;
      } catch (error) {
        // Ignore scanner stop errors
      }
    }
    
    // Clean up reader
    if (readerRef.current) {
      readerRef.current = null;
    }
    
    setIsScanning(false);
    setWaitingForCamera(false);
  };

  useEffect(() => {
    if (isOpen) {
      startScanner();
    } else {
      stopScanner();
    }

    return () => {
      stopScanner();
    };
  }, [isOpen, startScanner]);

  const switchCamera = () => {
    if (availableDevices.length > 1) {
      const nextIndex = (currentDeviceIndex + 1) % availableDevices.length;
      setCurrentDeviceIndex(nextIndex);
      stopScanner();
      // Restart scanner with new device
      setTimeout(startScanner, 100);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsProcessingImage(true);
    
    try {
      
      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
      }
      
      // Use FileReader to avoid Safari blob URL issues
      const fileReader = new FileReader();
      
      fileReader.onload = async (e) => {
        try {
          const dataUrl = e.target?.result as string;
          if (!dataUrl) throw new Error('Could not read image data');
          
          let result = null;
          
          // Try ZXing first with decodeFromImageUrl
          try {
            result = await readerRef.current!.decodeFromImageUrl(dataUrl);
          } catch (zxingError) {
            
            // Try jsQR as fallback with 2x upsampling
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d')!;
              
              // Try 2x upsampling for small QR codes
              const scale = 2;
              canvas.width = img.width * scale;
              canvas.height = img.height * scale;
              
              // Use image smoothing for better quality
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              let jsQRResult = jsQR(imageData.data, imageData.width, imageData.height);
              
              // If 2x failed, try original size
              if (!jsQRResult) {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                jsQRResult = jsQR(originalImageData.data, originalImageData.width, originalImageData.height);
              }
              
              if (jsQRResult) {
                onScan(jsQRResult.data);
                onClose();
                toast({
                  title: 'QR Code Scanned',
                  description: 'Successfully read QR code from image',
                });
              } else {
                toast({
                  title: 'Scan Failed',
                  description: 'No valid QR code found in the uploaded image',
                  variant: 'destructive',
                });
              }
              
              setIsProcessingImage(false);
            };
            
            img.onerror = () => {
              toast({
                title: 'Upload Failed',
                description: 'Could not load the uploaded image',
                variant: 'destructive',
              });
              setIsProcessingImage(false);
            };
            
            img.src = dataUrl;
            return; // Exit early for jsQR async processing
          }
          
          if (result) {
            onScan(result.getText());
            onClose();
            toast({
              title: 'QR Code Scanned',
              description: 'Successfully read QR code from image',
            });
          }
          
          setIsProcessingImage(false);
        } catch (error) {
          setIsProcessingImage(false);
          toast({
            title: 'Scan Failed',
            description: 'No valid QR code found in the uploaded image',
            variant: 'destructive',
          });
        }
      };
      
      fileReader.onerror = () => {
        setIsProcessingImage(false);
        toast({
          title: 'Upload Failed',
          description: 'Could not read the uploaded image file',
          variant: 'destructive',
        });
      };
      
      fileReader.readAsDataURL(file);
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
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
                {waitingForCamera && (
                  <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                    Waiting for camera permission...
                  </div>
                )}
                {isScanning && !waitingForCamera && (
                  <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                    Scanning...
                  </div>
                )}
              </div>
            </div>
            
            {/* Camera switch button */}
            {availableDevices.length > 1 && isScanning && (
              <div className="absolute top-2 right-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={switchCamera}
                  className="bg-black/50 text-white hover:bg-black/70"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
          
          {/* Upload Alternative */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Or upload an image containing a QR code
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
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