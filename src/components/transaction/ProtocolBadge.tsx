import { ShieldCheck, ShieldAlert, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROTOCOL_LABELS, type ProtocolId } from '@/lib/protocols/registry';
import { PROTOCOL_STYLE } from './protocolStyle';

interface ProtocolBadgeProps {
  protocol: ProtocolId;
  role?: string;
  confidence?: 'verified' | 'likely';
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
  const verified = confidence === 'verified';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full ring-1 font-semibold whitespace-nowrap',
        style.tint,
        style.ring,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className,
      )}
    >
      <Icon className={cn(size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5', style.accent)} />
      <span className={style.accent}>{PROTOCOL_LABELS[protocol]}</span>
      {role && <span className="text-muted-foreground font-normal">{role}</span>}
      {verified ? (
        <ShieldCheck className="w-3 h-3 text-success" aria-label="Address matches a known deployment" />
      ) : (
        <ShieldAlert className="w-3 h-3 text-warning" aria-label="Interface matches, address unrecognized" />
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
