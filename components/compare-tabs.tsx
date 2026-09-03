'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Switch between the player (§43) and club (§44) comparison pages. */
export function CompareTabs() {
  const pathname = usePathname();

  const tabs = [
    { href: '/players/compare', label: 'Players' },
    { href: '/teams/compare', label: 'Clubs' },
  ];

  return (
    <nav className="flex items-center gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? 'page' : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            pathname === tab.href
              ? 'bg-brand-600 text-white'
              : 'border border-ink-300 text-ink-700 hover:bg-ink-100'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
