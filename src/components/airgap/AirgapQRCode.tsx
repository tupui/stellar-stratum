import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { FRAGMENT_BYTES, FRAME_MS, type QrPlan } from '@/lib/airgap/qr';
import { createFrameEncoder } from '@/lib/airgap/ur';

const LEVEL = 'M' as const;
/** The quiet zone, in modules: 4 is the minimum the QR standard asks for. */
const QUIET = 4;
/** The largest a code is drawn, in CSS px: it fits a 390 px phone with its gutters. */
const MAX_PX = 300;
const COLOR = { dark: '#000000', light: '#ffffff' } as const;

/** Whole CSS pixels per module (6 when it fits), so every module has the same size. */
const moduleSize = (text: string) => {
  const modules = QRCode.create(text, { errorCorrectionLevel: LEVEL }).modules.size + QUIET * 2;
  return { modules, px: Math.max(2, Math.min(6, Math.floor(MAX_PX / modules))) };
};

const deviceScale = () => Math.max(1, Math.ceil(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));

/** One QR code on its white quiet zone, drawn at whole pixels per module. */
export const QrCode = ({ text, label }: { text: string; label: string }) => {
  const [image, setImage] = useState<{ url: string; size: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(async () => {
        const { modules, px } = moduleSize(text);
        const url = await QRCode.toDataURL(text, { errorCorrectionLevel: LEVEL, margin: QUIET, scale: px * deviceScale(), color: COLOR });
        if (!cancelled) setImage({ url, size: modules * px });
      })
      .catch(() => !cancelled && setImage(null));
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!image) return null;
  return (
    <div className="flex justify-center">
      <img
        src={image.url}
        alt={label}
        width={image.size}
        height={image.size}
        className="block max-w-none bg-white [image-rendering:pixelated]"
        style={{ width: image.size, height: image.size }}
      />
    </div>
  );
};

interface AirgapQRCodeProps {
  plan: QrPlan;
  /** What the code holds, for screen readers. */
  label: string;
}

/**
 * One QR code, or an animated one that loops through the parts of a multipart UR until the
 * other device has read enough of them. Parts can be read in any order.
 */
export const AirgapQRCode = ({ plan, label }: AirgapQRCodeProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (plan.kind !== 'animated' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const encoder = createFrameEncoder(plan.payload, FRAGMENT_BYTES);
    const scale = deviceScale();
    let px = 0;
    const draw = () => {
      const text = encoder.next();
      // The frames are the same length: the size of the first one holds for all of them.
      if (!px) px = moduleSize(text).px;
      QRCode.toCanvas(canvas, text, { errorCorrectionLevel: LEVEL, margin: QUIET, scale: px * scale, color: COLOR })
        .then(() => {
          canvas.style.width = `${canvas.width / scale}px`;
          canvas.style.height = `${canvas.height / scale}px`;
        })
        .catch(() => undefined);
    };
    draw();
    const timer = window.setInterval(draw, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [plan]);

  if (plan.kind === 'static') return <QrCode text={plan.text} label={label} />;

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={canvasRef} role="img" aria-label={label} className="block max-w-none bg-white [image-rendering:pixelated]" />
      <p className="flex items-center justify-center gap-2 text-[13px]">
        <b className="font-semibold">Animated QR</b>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{plan.parts} parts, read in any order</span>
      </p>
    </div>
  );
};
