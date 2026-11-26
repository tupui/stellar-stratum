import { ArrowLeftRight, Landmark, type LucideIcon } from 'lucide-react';
import type { ProtocolId } from '@/lib/protocols/registry';

/**
 * Per-protocol identity: the icon it is drawn with. Protocols carry no color of their own
 * (acid keeps color for the primary action, a signature given, warnings and errors), so the
 * accent, ring and tint are plain for every protocol.
 */
export const PROTOCOL_STYLE: Record<
  ProtocolId,
  { icon: LucideIcon; accent: string; ring: string; tint: string }
> = {
  soroswap: {
    icon: ArrowLeftRight,
    accent: 'text-foreground',
    ring: 'border-line-2',
    tint: '',
  },
  defindex: {
    icon: Landmark,
    accent: 'text-foreground',
    ring: 'border-line-2',
    tint: '',
  },
};
