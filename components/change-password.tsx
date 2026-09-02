'use client';

import { useState } from 'react';

/** Self-service password change (§63). Any signed-in account can do this. */
export function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const inputClass =
    'mt-1 block w-64 rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500';

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setDone(false);

        if (newPassword !== confirm) {
          setError('The two new passwords do not match.');
          return;
        }

        setBusy(true);
        const response = await fetch('/api/v1/account/password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        setBusy(false);

        if (!response.ok) {
          let message = `Request failed (${response.status})`;
          try {
            const body = (await response.json()) as { message?: string; error?: string };
            message = body.message ?? body.error ?? message;
          } catch {
            /* keep the status message */
          }
          setError(message);
          return;
        }

        setCurrentPassword('');
        setNewPassword('');
        setConfirm('');
        setDone(true);
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Current password
          <input
            required
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          New password
          <input
            required
            type="password"
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Repeat new password
          <input
            required
            type="password"
            minLength={8}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className={inputClass}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Saving...' : 'Change password'}
        </button>
      </div>

      {error && <p className="text-xs font-medium text-bad">{error}</p>}
      {done && (
        <p className="text-xs font-medium text-good">
          Password changed. Every other session for this account has been signed out; this browser
          stays signed in.
        </p>
      )}
    </form>
  );
}
