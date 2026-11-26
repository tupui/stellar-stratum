import { cn } from '@/lib/utils';
import { MARK_CELLS, MARK_COLORS } from './markCells';

interface MarkProps {
  /** Rendered size in px. 23 draws one pixel per cell, the crispest at 1x. */
  size?: number;
  /** The nine bracts brighten in turn while something loads; the heart stays lit. */
  waiting?: boolean;
  /** Draw every cell in the current text color: the mark on an acid button. */
  mono?: boolean;
  className?: string;
  label?: string;
}

/**
 * The Stratum edelweiss, exactly as settled on the design canvas. Each cell carries its lobe so the
 * waiting animation can turn the bracts (see `.mark-wait` in index.css).
 */
export const Mark = ({ size = 23, waiting = false, mono = false, className, label }: MarkProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 23 23"
    shapeRendering="crispEdges"
    className={cn('shrink-0', waiting && 'mark-wait', className)}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    {MARK_CELLS.map(([x, y, color, , lobe, heart]) => (
      <rect
        key={`${x}-${y}`}
        x={x}
        y={y}
        width={1.02}
        height={1.02}
        fill={mono ? 'currentColor' : MARK_COLORS[color]}
        className={heart ? 'h' : `l${lobe}`}
      />
    ))}
  </svg>
);

/** The mark and the STRATUM wordmark, as in every header. */
export const Wordmark = ({ className }: { className?: string }) => (
  <span className={cn('brand-flicker inline-flex items-center gap-2 text-foreground', className)}>
    <Mark />
    <b className="font-pix text-[26px] font-normal leading-none tracking-[0.02em]">STRATUM</b>
  </span>
);

/** In place of a spinner: the mark with its bracts turning. */
export const Spinner = ({ size = 16, className, mono }: { size?: number; className?: string; mono?: boolean }) => (
  <Mark size={size} waiting mono={mono} className={className} label="Loading" />
);
