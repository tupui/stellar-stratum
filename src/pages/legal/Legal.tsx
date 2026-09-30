import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { LEGAL_PAGES } from '@/lib/legal';
import { cn } from '@/lib/utils';

/** The legal pages, one at a time under the links to all three. */
const Legal = () => {
  const { pathname, hash } = useLocation();

  // The router keeps the scroll position of the previous page, and the browser looks for a
  // #section before the page renders: open each page at its section, or at its top.
  useEffect(() => {
    const section = hash && document.getElementById(hash.slice(1));
    if (section) section.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <Link to="/" className="inline-flex min-h-14 items-center text-2xl font-bold text-stellar-yellow text-glow-yellow">
            Stratum
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 sm:px-6 sm:py-10 space-y-8">
        <nav aria-label="Legal pages" className="grid grid-cols-3 gap-2 sm:flex">
          {LEGAL_PAGES.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-stellar-yellow/40 bg-stellar-yellow/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )
              }
            >
              <Icon className="hidden sm:block w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <article className="space-y-8">
          <Outlet />
        </article>
      </main>

      <Footer />
    </div>
  );
};

export default Legal;
