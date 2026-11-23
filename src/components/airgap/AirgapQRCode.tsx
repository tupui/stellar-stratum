import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { FRAGMENT_BYTES, FRAME_MS, type QrPlan } from '@/lib/airgap/qr';
import { createFrameEncoder } from '@/lib/airgap/ur';

const RENDER = { width: 320, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } } as const;

interface AirgapQRCodeProps {
  plan: QrPlan;
  /** What the code holds, for screen readers. */
  label: string;
  className?: string;
}

/**
 * One QR code, or an animated one that loops through the parts of a multipart UR until the
 * other device has read enough of them. Parts can be read in any order.
 */
export const AirgapQRCode = ({ plan, label, className = 'w-64 h-64' }: AirgapQRCodeProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (plan.kind !== 'static') return;
    let cancelled = false;
    QRCode.toDataURL(plan.text, RENDER)
      .then((url) => !cancelled && setDataUrl(url))
      .catch(() => !cancelled && setDataUrl(''));
    return () => {
      cancelled = true;
    };
  }, [plan]);

  useEffect(() => {
    if (plan.kind !== 'animated' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const encoder = createFrameEncoder(plan.payload, FRAGMENT_BYTES);
    const draw = () => QRCode.toCanvas(canvas, encoder.next(), RENDER).catch(() => undefined);
    draw();
    const timer = window.setInterval(draw, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [plan]);

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <div className="p-3 rounded-xl border border-border/60 bg-background">
          {plan.kind === 'static' ? (
            dataUrl && <img src={dataUrl} alt={label} className={className} />
          ) : (
            <canvas ref={canvasRef} role="img" aria-label={label} className={className} />
          )}
        </div>
      </div>
      {plan.kind === 'animated' && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Animated QR</span>
          <span>·</span>
          <span>{plan.parts} parts, read in any order</span>
        </div>
      )}
    </div>
  );
};
