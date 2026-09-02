'use client';

import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/v1/auth/logout', { method: 'POST' });
        router.push('/login');
        router.refresh();
      }}
      className="rounded-md border border-ink-300 px-2.5 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-100"
    >
      Sign out
    </button>
  );
}
