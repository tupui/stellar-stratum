import { ShieldAlert, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProtocolMatch } from '@/lib/protocols/detect';
import { PROTOCOL_LABELS, type ProtocolId } from '@/lib/protocols/registry';
import { PROTOCOL_STYLE } from './protocolStyle';

interface ProtocolBadgeProps {
  protocol: ProtocolId;
  role?: string;
  confidence?: ProtocolMatch['confidence'];
  /** Kept for callers; every tag is the same size now. */
  size?: 'sm' | 'md';
  className?: string;
}

const TAG = 'inline-flex h-[22px] items-center gap-1 whitespace-nowrap border border-line-2 px-[7px] text-xs';

/**
 * "Which protocol is this?" as a plain tag. Only the shield says something: amber when the
 * address is not a known deployment, red when signing authorizes more than the call shows.
 */
export const ProtocolBadge = ({ protocol, role, confidence = 'verified', className }: ProtocolBadgeProps) => {
  const Icon = PROTOCOL_STYLE[protocol].icon;
  // A known address whose authorization reaches further than the call: never dress it as safe.
  const unsafe = confidence === 'unsafe';

  return (
    <span
      className={cn(TAG, 'text-foreground', unsafe && 'border-destructive', className)}
      title={unsafe ? 'Signing authorizes more than this call shows' : undefined}
    >
      <Icon className="h-3 w-3 text-muted-foreground" aria-hidden />
      <span>{PROTOCOL_LABELS[protocol]}</span>
      {role && <span className="text-muted-foreground">{role}</span>}
      {confidence === 'verified' && <ShieldCheck className="h-3 w-3" aria-label="Address matches a known deployment" />}
      {confidence === 'likely' && (
        <ShieldAlert className="h-3 w-3 text-warning" aria-label="Interface matches, address unrecognized" />
      )}
      {unsafe && <ShieldX className="h-3 w-3 text-destructive" aria-label="Signing authorizes more than this call shows" />}
    </span>
  );
};

/** Shown when a contract call belongs to no protocol we ship. */
export const UnknownContractBadge = (_props: { size?: 'sm' | 'md' }) => (
  <span className={cn(TAG, 'text-foreground')}>
    <TriangleAlert className="h-3 w-3 text-warning" aria-hidden />
    Unrecognized contract
  </span>
);
