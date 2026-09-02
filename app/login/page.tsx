'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      router.push('/');
      router.refresh();
      return;
    }

    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setError(
      body.error === 'too_many_requests'
        ? (body.message ?? 'Too many attempts. Try again shortly.')
        : 'Invalid email or password.',
    );
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Scout<span className="text-brand-600">IQ</span>
          </h1>
          <p className="mt-1 text-sm text-ink-500">Football scouting &amp; analytics</p>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-ink-200 bg-white p-6 shadow-sm">
          <label className="block text-xs font-medium uppercase tracking-wide text-ink-500">
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>

          <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-ink-500">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>

          {error && (
            <p className="mt-4 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-400">
          Self-hosted. No account exists by default - run{' '}
          <code className="rounded bg-ink-200 px-1 py-0.5 text-ink-600">npm run db:seed</code>.
        </p>
      </div>
    </main>
  );
}
