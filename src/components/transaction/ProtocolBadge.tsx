import { ShieldCheck, ShieldAlert, ShieldX, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProtocolMatch } from '@/lib/protocols/detect';
import { PROTOCOL_LABELS, type ProtocolId } from '@/lib/protocols/registry';
import { PROTOCOL_STYLE } from './protocolStyle';

interface ProtocolBadgeProps {
  protocol: ProtocolId;
  role?: string;
  confidence?: ProtocolMatch['confidence'];
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Compact "which protocol is this?" chip. Small enough for the card header and
 * for a row in the operations list.
 */
export const ProtocolBadge = ({
  protocol,
  role,
  confidence = 'verified',
  size = 'md',
  className,
}: ProtocolBadgeProps) => {
  const style = PROTOCOL_STYLE[protocol];
  const Icon = style.icon;
  // A known address whose authorization reaches further than the call: never dress it as safe.
  const unsafe = confidence === 'unsafe';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full ring-1 font-semibold whitespace-nowrap',
        unsafe ? 'bg-destructive/10 ring-destructive/40' : [style.tint, style.ring],
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className,
      )}
      title={unsafe ? 'Signing authorises more than this call shows' : undefined}
    >
      <Icon className={cn(size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5', style.accent)} />
      <span className={style.accent}>{PROTOCOL_LABELS[protocol]}</span>
      {role && <span className="text-muted-foreground font-normal">{role}</span>}
      {confidence === 'verified' && (
        <ShieldCheck className="w-3 h-3 text-success" aria-label="Address matches a known deployment" />
      )}
      {confidence === 'likely' && (
        <ShieldAlert className="w-3 h-3 text-warning" aria-label="Interface matches, address unrecognized" />
      )}
      {unsafe && (
        <ShieldX className="w-3 h-3 text-destructive" aria-label="Signing authorises more than this call shows" />
      )}
    </span>
  );
};

/** Shown when a contract call belongs to no protocol we ship. */
export const UnknownContractBadge = ({ size = 'md' }: { size?: 'sm' | 'md' }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full ring-1 ring-warning/30 bg-warning/10 font-semibold whitespace-nowrap text-warning',
      size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
    )}
  >
    <TriangleAlert className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
    Unrecognized contract
  </span>
);
