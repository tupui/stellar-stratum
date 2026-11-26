import { Building2, FileText, Lock, type LucideIcon } from 'lucide-react';

/** The legal pages, in the order every list of them follows. */
export const LEGAL_PAGES: readonly { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/legal/impressum', label: 'Impressum', icon: Building2 },
  { to: '/legal/privacy', label: 'Privacy', icon: Lock },
  { to: '/legal/terms', label: 'Terms', icon: FileText },
];

export const LEGAL_EMAIL = 'legal@consulting-manao.com';

/** A link in running text. */
export const TEXT_LINK = 'text-foreground underline decoration-line-2 underline-offset-[3px] hover:decoration-current';
