import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertCircle, Camera, Upload, X, RotateCcw } from 'lucide-react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import jsQR from 'jsqr';
import { useToast } from '@/hooks/use-toast';
import { SIGNATURE_SET_UR_TYPE, ENVELOPE_UR_TYPE } from '@/lib/airgap/payloads';
import { encodeSinglePartUR, isMultipartUR, URAssembler } from '@/lib/airgap/ur';

/** Why a scanned code was not used. The scanner shows it and keeps scanning. */
export interface ScanRefusal {
  title: string;
  description: string;
}

interface QRScannerProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The text of the code. An animated QR arrives once complete, as a single-part UR. Return a
   * refusal to keep the scanner open; return nothing and it closes.
   */
  onScan: (data: string) => ScanRefusal | void;
}

const receiving = (type: string) =>
  type === ENVELOPE_UR_TYPE ? 'Receiving transaction' : type === SIGNATURE_SET_UR_TYPE ? 'Receiving signatures' : 'Receiving data';

type CameraStatus = 'idle' | 'waiting' | 'scanning' | 'error';

/** Camera capabilities not yet in the DOM typings (Chrome/Android only). */
type ExtendedCapabilities = MediaTrackCapabilities & { zoom?: { max?: number }; focusMode?: string[] };
type ExtendedConstraintSet = MediaTrackConstraintSet & { zoom?: number; focusMode?: string };

const createReader = () => {
  // Focus on QR only and try harder for partially visible or angled codes
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  // An animated QR changes every 250 ms: read again soon after a success, not after the default 500 ms.
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 75, delayBetweenScanSuccess: 50 });
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
  const [progress, setProgress] = useState<{ type: string; percent: number } | null>(null);
  const [notice, setNotice] = useState<ScanRefusal | null>(null);
  const { toast } = useToast();
  const assembler = useRef(new URAssembler());
  // The camera reads the same code many times a second: act on each text once.
  const lastText = useRef('');
  // An animated QR loops: once refused, it is not offered again when it completes again.
  const refusedText = useRef('');

  // The camera must not restart when the parent re-renders with new callbacks.
  const callbacks = useRef({ onScan, onClose });
  useEffect(() => {
    callbacks.current = { onScan, onClose };
  });

  /** Handle one decoded code. True when the scan is over and the camera can stop. */
  const handle = useCallback((raw: string): boolean => {
    let text = raw.trim();
    if (!text || text === lastText.current) return false;
    lastText.current = text;

    if (isMultipartUR(text)) {
      const state = assembler.current.receive(text);
      if (state.status === 'collecting') {
        // A notice stays up: the code it explains keeps looping past the camera.
        setProgress({ type: state.type, percent: state.percent });
        return false;
      }
      setProgress(null);
      if (state.status === 'failed') {
        setNotice({ title: 'Animated QR code not read', description: state.reason });
        return false;
      }
      text = encodeSinglePartUR(state.payload);
      if (text === refusedText.current) return false;
    }

    const refusal = callbacks.current.onScan(text);
    if (refusal) {
      refusedText.current = text;
      setNotice(refusal);
      return false;
    }
    // No toast of our own: the toaster shows one at a time, and the caller says what the code did.
    callbacks.current.onClose();
    return true;
  }, []);

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
          if (handle(result.getText())) {
            done = true;
            stop();
          }
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
      // The next scan starts from nothing: no parts of this animated QR, no notice.
      assembler.current = new URAssembler();
      lastText.current = '';
      refusedText.current = '';
      setProgress(null);
      setNotice(null);
    };
  }, [isOpen, deviceIndex, handle, toast]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    setIsProcessingImage(true);
    const fileReader = new FileReader(); // FileReader rather than blob URLs: Safari
    fileReader.onload = async () => {
      const text = typeof fileReader.result === 'string' ? await decodeImage(fileReader.result) : null;
      setIsProcessingImage(false);
      lastText.current = '';
      if (text) handle(text);
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
                {status === 'scanning' && (
                  <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">{progress ? 'Reading animated QR...' : 'Scanning...'}</div>
                )}
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

          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{receiving(progress.type)}</span>
                <span className="text-muted-foreground">{progress.percent}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="Animated QR received"
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 rounded-full bg-muted overflow-hidden"
              >
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">Keep the camera on the code. Parts can be read in any order.</p>
            </div>
          )}

          {notice && (
            <div role="alert" className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
              <div className="space-y-1">
                <p className="font-medium text-destructive">{notice.title}</p>
                <p className="text-foreground/80">{notice.description}</p>
              </div>
            </div>
          )}

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
