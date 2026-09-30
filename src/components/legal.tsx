import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** The title of a legal page, beside its icon. */
export const LegalHeader = ({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) => (
  <div className="flex items-start gap-4">
    <div className="p-2 bg-stellar-yellow/10 rounded-xl shrink-0">
      <Icon className="w-6 h-6 text-stellar-yellow" />
    </div>
    <div className="space-y-2 min-w-0">
      <h1 className="text-2xl sm:text-3xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </div>
  </div>
);

/** The points of a page that matter most, above its text. */
export const Summary = ({ points }: { points: { icon: LucideIcon; title: string; text: string }[] }) => (
  <ul className="grid gap-3 sm:grid-cols-2">
    {points.map(({ icon: Icon, title, text }) => (
      <li key={title} className="flex gap-3 rounded-xl border border-border bg-card p-4">
        <Icon className="w-5 h-5 mt-0.5 shrink-0 text-stellar-yellow" />
        <div className="space-y-1 min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
      </li>
    ))}
  </ul>
);

export const Section = ({ id, title, children }: { id?: string; title: string; children: ReactNode }) => (
  <section id={id} className="space-y-3 leading-7 scroll-mt-6">
    <h2 className="text-xl font-semibold">{title}</h2>
    {children}
  </section>
);

/** A list of what is processed, who receives it or what is kept: what, what for, and where. */
export const Entries = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-xl border border-border bg-card leading-normal">
    <h3 className="border-b border-border px-4 py-3 text-sm font-medium">{title}</h3>
    <ul className="divide-y divide-border">{children}</ul>
  </section>
);

export const Entry = ({ name, where, children }: { name: ReactNode; where: string; children: ReactNode }) => (
  <li className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_minmax(0,1fr)_9rem] sm:items-baseline sm:gap-4">
    <span className="text-sm font-medium break-words">{name}</span>
    <span className="text-sm text-muted-foreground">{children}</span>
    <span className="text-xs text-muted-foreground sm:text-right">{where}</span>
  </li>
);

/** A host name or a storage key, as the browser shows it. */
export const Code = ({ children }: { children: string }) => (
  <code className="font-mono text-[13px] font-normal break-all">{children}</code>
);
