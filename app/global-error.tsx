'use client';

/**
 * Root error boundary.
 *
 * Replaces the framework default, which must render its own <html>/<body>.
 * Kept dependency-free so it still renders when the rest of the app cannot.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0 0 1.25rem' }}>
            ScoutIQ hit an unexpected error. The details are in the server logs
            {error.digest ? ` (digest ${error.digest})` : ''}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#1b5ea0',
              color: '#fff',
              border: 0,
              borderRadius: '0.375rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
