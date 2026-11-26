import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AppHeader, Wrap } from '@/components/brand/Shell';
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
      <AppHeader />

      <Wrap className="flex-1 pb-8 pt-4 sm:pb-12 sm:pt-8">
        <main className="flex max-w-3xl flex-col gap-6">
          <nav aria-label="Legal pages" className="flex border-b border-line">
            {LEGAL_PAGES.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-12 items-center px-[18px] text-sm font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                    isActive
                      ? 'text-foreground shadow-[inset_0_-2px_0_hsl(var(--foreground))]'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <article className="space-y-6">
            <Outlet />
          </article>
        </main>
      </Wrap>

      <Footer />
    </div>
  );
};

export default Legal;
