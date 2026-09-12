import { ArrowLeftRight, Landmark, type LucideIcon } from 'lucide-react';
import type { ProtocolId } from '@/lib/protocols/registry';

/** Per-protocol identity: icon plus the accent it is drawn in across the summary. */
export const PROTOCOL_STYLE: Record<
  ProtocolId,
  { icon: LucideIcon; accent: string; ring: string; tint: string }
> = {
  soroswap: {
    icon: ArrowLeftRight,
    accent: 'text-info',
    ring: 'ring-info/30',
    tint: 'bg-info/10',
  },
  defindex: {
    icon: Landmark,
    accent: 'text-success',
    ring: 'ring-success/30',
    tint: 'bg-success/10',
  },
};
