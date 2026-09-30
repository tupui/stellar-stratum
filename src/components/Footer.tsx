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
    <footer className="border-t border-border bg-background/80 backdrop-blur-sm">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2 flex flex-col-reverse gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="pb-2 sm:pb-0 text-center sm:text-left text-xs sm:text-sm text-muted-foreground">
          Stellar Stratum is operated by{' '}
          <a
            href="https://consulting-manao.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-stellar-yellow font-medium hover:underline"
          >
            Consulting Manao GmbH
          </a>
          . The Stellar Development Foundation does not operate it.
        </p>
        <nav aria-label="Legal" className="grid grid-cols-3 shrink-0 sm:flex sm:gap-1">
          {LEGAL_PAGES.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              target={onLegalPage ? undefined : '_blank'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center justify-center px-2 text-sm transition-colors hover:text-foreground',
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
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
