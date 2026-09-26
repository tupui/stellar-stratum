import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, Upload, X, RotateCcw } from 'lucide-react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import jsQR from 'jsqr';
import { useToast } from '@/hooks/use-toast';

interface QRScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

type CameraStatus = 'idle' | 'waiting' | 'scanning' | 'error';

/** Camera capabilities not yet in the DOM typings (Chrome/Android only). */
type ExtendedCapabilities = MediaTrackCapabilities & { zoom?: { max?: number }; focusMode?: string[] };
type ExtendedConstraintSet = MediaTrackConstraintSet & { zoom?: number; focusMode?: string };

const createReader = () => {
  // Focus on QR only and try harder for partially visible or angled codes
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 75 });
};

/** Best effort: a little zoom and continuous focus make small, dense QR codes readable. */
const tuneCamera = async (video: HTMLVideoElement | null) => {
  const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities() as ExtendedCapabilities;
  const advanced: ExtendedConstraintSet[] = [];
  if (typeof caps.zoom?.max === 'number') advanced.push({ zoom: Math.min(caps.zoom.max, 2) });
  if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
  if (advanced.length) await track.applyConstraints({ advanced }).catch(() => undefined);
};

/** Read a QR code from an image, upsampling small codes when the first pass finds nothing. */
const decodeImage = (dataUrl: string) =>
  new Promise<string | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      for (const scale of [1, 2]) {
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(data.data, data.width, data.height);
        if (found) return resolve(found.data);
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

export const QRScanner = ({ isOpen, onClose, onScan }: QRScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const { toast } = useToast();

  // The camera must not restart when the parent re-renders with new callbacks.
  const callbacks = useRef({ onScan, onClose });
  useEffect(() => {
    callbacks.current = { onScan, onClose };
  });

  const deliver = useCallback((text: string) => {
    callbacks.current.onScan(text);
    callbacks.current.onClose();
    toast({ title: 'QR Code Scanned', description: 'Successfully scanned QR code' });
  }, [toast]);

  // One camera session per open dialog (and per selected camera). Every exit path stops the
  // stream, including a close that happens while the permission prompt is still showing.
  useEffect(() => {
    if (!isOpen) return;
    let done = false;
    let controls: IScannerControls | null = null;
    const stop = () => {
      try {
        controls?.stop();
      } catch {
        // Already stopped
      }
    };

    setStatus('waiting');
    (async () => {
      try {
        const list = await BrowserMultiFormatReader.listVideoInputDevices().catch(() => [] as MediaDeviceInfo[]);
        if (done) return;
        setDevices(list);
        const device = list.length ? list[deviceIndex % list.length] : undefined;
        const constraints: MediaStreamConstraints = {
          video: {
            ...(device ? { deviceId: { exact: device.deviceId } } : { facingMode: { ideal: 'environment' } }),
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        };
        const started = await createReader().decodeFromConstraints(constraints, videoRef.current!, (result) => {
          if (!result || done) return;
          done = true;
          stop();
          deliver(result.getText());
        });
        controls = started;
        if (done) {
          stop();
          return;
        }
        setStatus('scanning');
        await tuneCamera(videoRef.current);
      } catch {
        if (done) return;
        setStatus('error');
        toast({
          title: 'Camera Error',
          description: 'Camera access denied or unavailable. Try switching camera or upload an image.',
          variant: 'destructive',
        });
      }
    })();

    return () => {
      done = true;
      stop();
      setStatus('idle');
    };
  }, [isOpen, deviceIndex, deliver, toast]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    setIsProcessingImage(true);
    const fileReader = new FileReader(); // FileReader rather than blob URLs: Safari
    fileReader.onload = async () => {
      const text = typeof fileReader.result === 'string' ? await decodeImage(fileReader.result) : null;
      setIsProcessingImage(false);
      if (text) deliver(text);
      else toast({ title: 'Scan Failed', description: 'No valid QR code found in the uploaded image', variant: 'destructive' });
    };
    fileReader.onerror = () => {
      setIsProcessingImage(false);
      toast({ title: 'Upload Failed', description: 'Could not read the uploaded image file', variant: 'destructive' });
    };
    fileReader.readAsDataURL(file);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Scan QR Code
          </DialogTitle>
          <DialogDescription>Position the QR code within the camera frame to scan it</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative aspect-square bg-muted rounded-lg overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />

            <div className="absolute inset-4 border-2 border-dashed border-primary/50 rounded-lg pointer-events-none">
              <div className="absolute inset-0 flex items-center justify-center">
                {status === 'waiting' && (
                  <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">Waiting for camera permission...</div>
                )}
                {status === 'scanning' && <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">Scanning...</div>}
                {status === 'error' && <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">No camera available</div>}
              </div>
            </div>

            {devices.length > 1 && (
              <div className="absolute top-2 right-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDeviceIndex((i) => (i + 1) % devices.length)}
                  className="bg-black/50 text-white hover:bg-black/70"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Or upload an image containing a QR code</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleImageUpload}
              className="hidden"
            />
            <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()} disabled={isProcessingImage}>
              <Upload className="w-4 h-4 mr-2" />
              {isProcessingImage ? 'Processing...' : 'Upload Image'}
            </Button>
          </div>

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
