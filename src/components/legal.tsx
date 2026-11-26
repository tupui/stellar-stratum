import type { ReactNode } from 'react';

/** The title of a legal page, and what it is about. */
export const LegalHeader = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <h1 className="sec">{title}</h1>
    <p className="mt-2 text-[13px] text-muted-foreground">{children}</p>
  </div>
);

/** A panel of label-and-value rows. */
export const Rows = ({ children, className }: { children: ReactNode; className?: string }) => (
  <dl className={`m-0 divide-y divide-line border border-line bg-ink-2 ${className ?? ''}`}>{children}</dl>
);

/** One row: a muted label above its value. */
export const Row = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <div className="px-4 py-3">
    <dt className="field-label break-words">{label}</dt>
    <dd className="m-0 mt-1 break-words text-[15px]">{children}</dd>
  </div>
);

/** The points of a page that matter most, above its text. */
export const Summary = ({ points }: { points: { title: string; text: string }[] }) => (
  <Rows>
    {points.map(({ title, text }) => (
      <Row key={title} label={title}>
        {text}
      </Row>
    ))}
  </Rows>
);

export const Section = ({ id, title, children }: { id?: string; title: string; children: ReactNode }) => (
  <section id={id} className="space-y-3 text-[15px] leading-7 scroll-mt-6">
    <h2 className="sub">{title}</h2>
    {children}
  </section>
);

/** A list of what is processed, who receives it or what is kept: what, what for, and where. */
export const Entries = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border border-line bg-ink-2 leading-normal">
    <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">{title}</h3>
    <dl className="m-0 divide-y divide-line">{children}</dl>
  </section>
);

export const Entry = ({ name, where, children }: { name: ReactNode; where: string; children: ReactNode }) => (
  <div className="px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-x-4">
    <dt className="field-label break-words sm:col-start-1 sm:row-start-1">{name}</dt>
    <dd className="m-0 mt-1 text-[15px] sm:col-start-1 sm:row-start-2">{children}</dd>
    <dd className="m-0 mt-1 text-xs text-muted-foreground sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:text-right">{where}</dd>
  </div>
);

/** A host name or a storage key, as the browser shows it. */
export const Code = ({ children }: { children: string }) => (
  <code className="font-mono text-[13px] font-normal break-all">{children}</code>
);
