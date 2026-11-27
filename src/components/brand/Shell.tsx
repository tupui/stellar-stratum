import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Wordmark } from './Mark';

/** The content column: 1120 px wide on desktop, 16 px gutters on the phone. */
export const Wrap = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn('mx-auto w-full max-w-[1120px] px-4 sm:px-8', className)}>{children}</div>
);

/**
 * Every page's header: the logo and wordmark at left, the page's own controls at right.
 * `brand` replaces the wordmark (the air-gapped signer shows its own title beside the mark).
 */
export const AppHeader = ({
  right,
  nav,
  brand,
  homeHref = '/',
}: {
  right?: ReactNode;
  /** Shown after the brand from md up, stretched to the bar's height (the dashboard's tabs). */
  nav?: ReactNode;
  brand?: ReactNode;
  homeHref?: string;
}) => (
  <header className="border-b border-line bg-ink">
    <Wrap className="flex min-h-[69px] items-center gap-3 sm:min-h-[77px]">
      {brand ?? (
        <Link to={homeHref} aria-label="Stratum home" className="no-underline">
          <Wordmark />
        </Link>
      )}
      {nav && <div className="ml-2 hidden self-stretch md:flex lg:ml-5">{nav}</div>}
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </Wrap>
  </header>
);

/** The way back, in the header's right slot: a 44 px outlined button with a chevron. */
export const BackButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap border border-line-2 px-2.5 text-[13px] font-semibold text-foreground hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring sm:gap-2 sm:px-3.5 sm:text-sm"
  >
    <ChevronLeft className="h-4 w-4" />
    {label}
  </button>
);

type Level = 'info' | 'warning' | 'error' | 'signed';

/** A notice: white text; the border, a faint tint and the icon carry the level. */
export const Notice = ({
  level = 'info',
  title,
  children,
  icon,
  className,
}: {
  level?: Level;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) => {
  const variant = { info: '', warning: 'amber', error: 'red', signed: 'acid' }[level];
  const Icon = { info: Info, warning: AlertTriangle, error: AlertTriangle, signed: CheckCircle2 }[level];
  return (
    <div role={level === 'error' ? 'alert' : undefined} className={cn('notice', variant, className)}>
      {icon ?? <Icon className="mt-0.5 h-4 w-4" aria-hidden="true" />}
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
};

/**
 * Signature weight: one cell per unit, lit acid when signed, dashed while still needed.
 * Above 12 units the cells would be too thin: one cell per unit is then drawn as a proportional bar.
 */
export const SignatureStrip = ({ signed, required, label }: { signed: number; required: number; label?: string }) => {
  const total = Math.max(required, signed, 1);
  const name = label ?? `Weight ${signed} of ${required}`;
  if (total > 12) {
    const pct = Math.min(100, (signed / total) * 100);
    return (
      <div role="img" aria-label={name} className="relative h-2.5 border border-line-2 bg-ink-3">
        <div className="h-full bg-acid" style={{ width: `${pct}%` }} />
      </div>
    );
  }
  return (
    <div role="img" aria-label={name} className="strip">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < signed ? 'on' : i < required ? 'need' : ''} />
      ))}
    </div>
  );
};

/** A signer's status: a square cell, acid when signed. */
export const SignerCell = ({ signed }: { signed: boolean }) => (
  <span className={cn('cell', signed && 'on')} role="img" aria-label={signed ? 'Signed' : 'Not signed'} />
);

/**
 * The main action of a phone screen, in a bar at the bottom. From sm up it sits in the page as an
 * ordinary row of buttons, right-aligned. Side by side, the primary is always the last button.
 */
export const Dock = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('dock sm:static sm:z-auto sm:justify-end sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 [&>*]:flex-1 sm:[&>*]:flex-none', className)}>
    {children}
  </div>
);
