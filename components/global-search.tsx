'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface Results {
  players: { id: string; fullName: string; primaryPosition: string; isDemo: boolean }[];
  teams: { id: string; name: string; isDemo: boolean }[];
  matches: {
    id: string;
    kickoffAt: string;
    homeTeam: { name: string };
    awayTeam: { name: string };
  }[];
  competitions: { id: string; name: string }[];
  shortlists: { id: string; name: string }[];
  reports: { id: string; title: string; type: string }[];
}

/** Global search (§46) with fuzzy matching across every entity type. */
export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }

    const controller = new AbortController();
    // Debounced so typing does not fire a request per keystroke.
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      }).catch(() => null);
      if (response?.ok) setResults((await response.json()) as Results);
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const groups: { label: string; items: { href: string; primary: string; secondary?: string }[] }[] =
    results
      ? [
          {
            label: 'Players',
            items: results.players.map((player) => ({
              href: `/players/${player.id}`,
              primary: player.fullName,
              secondary: player.primaryPosition,
            })),
          },
          {
            label: 'Clubs',
            items: results.teams.map((team) => ({ href: `/teams/${team.id}`, primary: team.name })),
          },
          {
            label: 'Matches',
            items: results.matches.map((match) => ({
              href: `/matches/${match.id}`,
              primary: `${match.homeTeam.name} v ${match.awayTeam.name}`,
              secondary: new Date(match.kickoffAt).toISOString().slice(0, 10),
            })),
          },
          {
            label: 'Shortlists',
            items: results.shortlists.map((entry) => ({
              href: `/shortlists/${entry.id}`,
              primary: entry.name,
            })),
          },
          {
            label: 'Reports',
            items: results.reports.map((report) => ({
              href: `/reports/${report.id}`,
              primary: report.title,
              secondary: report.type,
            })),
          },
        ].filter((group) => group.items.length > 0)
      : [];

  return (
    <div ref={container} className="relative hidden md:block">
      <input
        type="search"
        value={query}
        placeholder="Search players, clubs, matches..."
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-64 rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />

      {open && groups.length > 0 && (
        <div className="absolute right-0 top-full z-30 mt-1 max-h-96 w-96 overflow-y-auto rounded-lg border border-ink-200 bg-white shadow-lg">
          {groups.map((group) => (
            <div key={group.label} className="border-b border-ink-100 last:border-0">
              <div className="bg-ink-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                {group.label}
              </div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-brand-50"
                >
                  <span className="text-ink-800">{item.primary}</span>
                  {item.secondary && (
                    <span className="text-xs text-ink-400">{item.secondary}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
