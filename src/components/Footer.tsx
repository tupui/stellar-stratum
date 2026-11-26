import { NavLink, useLocation } from 'react-router-dom';
import { LEGAL_PAGES } from '@/lib/legal';
import { cn } from '@/lib/utils';

/**
 * The operator and the legal pages, at the bottom of every page. Outside the legal pages the
 * links open a new tab: the account and a transaction being signed live in this one.
 */
export const Footer = () => {
  const onLegalPage = useLocation().pathname.startsWith('/legal');

  return (
    <footer className="border-t border-line bg-ink">
      {/* the operator line, then the legal links: on the phone and on desktop alike */}
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-2.5 px-4 pb-7 pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-8 sm:py-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Stellar Stratum is operated by{' '}
          <a
            href="https://consulting-manao.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground underline decoration-line-2 underline-offset-[3px] hover:decoration-current"
          >
            Consulting Manao GmbH
          </a>
          . The Stellar Development Foundation does not operate it.
        </p>
        <nav aria-label="Legal" className="-mx-2 flex shrink-0 gap-2">
          {LEGAL_PAGES.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              target={onLegalPage ? undefined : '_blank'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center px-2 text-xs underline decoration-line-2 underline-offset-[3px] hover:decoration-current',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </footer>
  );
};
