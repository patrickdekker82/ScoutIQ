'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * User administration UI (§63).
 *
 * The server is the authority on every rule here - the last-admin guard, the
 * session revocation, the audit trail. This component only makes those rules
 * visible; it never assumes a request succeeded.
 */

const ROLES = ['ADMIN', 'ANALYST', 'SCOUT', 'VIEWER'] as const;
type Role = (typeof ROLES)[number];

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  counts: { reports: number; notes: number; shortlists: number };
}

const ROLE_HINT: Record<Role, string> = {
  ADMIN: 'Everything, including users, providers, imports and backups',
  ANALYST: 'Analytics runs, SQL console, exports, reports and shortlists',
  SCOUT: 'Reports, shortlists and notes - no SQL, no exports',
  VIEWER: 'Read-only',
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

const inputClass =
  'mt-1 block rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500';

function CreateUser({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('SCOUT');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const response = await fetch('/api/v1/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, displayName, role, password }),
        });
        setBusy(false);
        if (!response.ok) {
          setError(await readError(response));
          return;
        }
        setEmail('');
        setDisplayName('');
        setPassword('');
        onDone();
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={`${inputClass} w-64`}
          />
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Name
          <input
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={`${inputClass} w-56`}
          />
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className={`${inputClass} w-40`}
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Password
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            className={`${inputClass} w-56`}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Creating...' : 'Create account'}
        </button>
      </div>

      <p className="text-xs text-ink-500">{ROLE_HINT[role]}</p>
      {error && <p className="text-xs font-medium text-bad">{error}</p>}
    </form>
  );
}

function UserRow({
  user,
  selfId,
  onChanged,
}: {
  user: AdminUserRow;
  selfId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');

  const patch = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/v1/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await readError(response));
      return false;
    }
    setNotice(message);
    onChanged();
    return true;
  };

  const isSelf = user.id === selfId;

  return (
    <tr className={user.active ? '' : 'bg-ink-50/70 text-ink-400'}>
      <td className="px-3 py-2 align-top">
        <div className="text-sm font-medium text-ink-900">
          {user.displayName}
          {isSelf && <span className="ml-2 text-[11px] uppercase text-ink-400">you</span>}
        </div>
        <div className="text-xs text-ink-500">{user.email}</div>
        {error && <div className="mt-1 text-xs font-medium text-bad">{error}</div>}
        {notice && <div className="mt-1 text-xs font-medium text-good">{notice}</div>}
      </td>

      <td className="px-3 py-2 align-top">
        <select
          value={user.role}
          disabled={busy}
          onChange={(event) => void patch({ role: event.target.value }, 'Role updated.')}
          className="rounded-md border border-ink-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </td>

      <td className="px-3 py-2 align-top text-xs text-ink-500">
        {user.active ? 'Active' : 'Deactivated'}
      </td>

      <td className="tabular px-3 py-2 align-top text-right text-xs text-ink-500">
        {user.counts.reports} / {user.counts.shortlists} / {user.counts.notes}
      </td>

      <td className="px-3 py-2 align-top text-xs text-ink-500">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
      </td>

      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setResetting((value) => !value);
              setPassword('');
            }}
            className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60"
          >
            {resetting ? 'Cancel' : 'Reset password'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void patch(
                { active: !user.active },
                user.active ? 'Account deactivated; sessions revoked.' : 'Account reactivated.',
              )
            }
            className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60"
          >
            {user.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>

        {resetting && (
          <form
            className="mt-2 flex items-center justify-end gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await patch({ password }, 'Password reset; sessions revoked.');
              if (ok) {
                setResetting(false);
                setPassword('');
              }
            }}
          >
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              className="w-44 rounded-md border border-ink-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Save
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

export function UserAdmin({ users, selfId }: { users: AdminUserRow[]; selfId: string }) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      <CreateUser onDone={refresh} />

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-ink-200">
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Account
              </th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Role
              </th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Status
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Reports / lists / notes
              </th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Last sign-in
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {users.map((user) => (
              <UserRow key={user.id} user={user} selfId={selfId} onChanged={refresh} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-500">
        Deactivating an account or changing its password revokes every session it holds
        immediately. The last active admin cannot be demoted or deactivated - promote a replacement
        first.
      </p>
    </div>
  );
}
