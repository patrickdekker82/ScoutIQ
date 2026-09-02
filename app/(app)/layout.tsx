import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getConfig } from '@/lib/config';
import { can, getSessionUser } from '@/server/auth';
import { GlobalSearch } from '@/components/global-search';
import { SignOutButton } from '@/components/sign-out';

/**
 * Authenticated shell.
 *
 * Navigation is filtered by role (§63), so a Viewer never sees an action they
 * cannot take and an accidental click cannot reach an admin endpoint.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const config = getConfig();

  const nav = [
    { href: '/', label: 'Overview', show: true },
    { href: '/players', label: 'Players', show: true },
    { href: '/teams', label: 'Clubs', show: true },
    { href: '/matches', label: 'Matches', show: true },
    { href: '/shortlists', label: 'Shortlists', show: can(user.role, 'shortlists:write') },
    { href: '/reports', label: 'Reports', show: true },
    { href: '/data', label: 'Data', show: true },
    { href: '/data/sql', label: 'SQL', show: can(user.role, 'sql:read') },
    { href: '/data/jobs', label: 'Jobs', show: can(user.role, 'data:read') },
  ].filter((entry) => entry.show);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-5 py-2.5">
          <Link href="/" className="text-base font-bold tracking-tight text-ink-900">
            Scout<span className="text-brand-600">IQ</span>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {nav.map((entry) => (
              <Link
                key={entry.href}
                href={entry.href}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
              >
                {entry.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <GlobalSearch />
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium text-ink-800">{user.displayName}</div>
              <div className="text-[11px] uppercase tracking-wide text-ink-400">{user.role}</div>
            </div>
            <SignOutButton />
          </div>
        </div>

        {config.demoMode && (
          <div className="border-t border-warn/30 bg-warn/10 px-5 py-1 text-center text-[11px] font-medium text-warn">
            Demo mode is enabled - content labelled DEMO DATA is fabricated and describes no real
            player, team or match.
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-6">{children}</main>

      <footer className="mx-auto max-w-[1400px] px-5 pb-8 pt-2 text-[11px] text-ink-400">
        Self-hosted ScoutIQ &middot; analytics are transparent models, not objective truth &middot;
        every score shows its inputs and sample size.
      </footer>
    </div>
  );
}
