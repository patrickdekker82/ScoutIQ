import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-ink-900">Not found</h1>
        <p className="mt-2 text-sm text-ink-500">
          That player, club, match or report does not exist - or was removed by a re-import.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Back to the overview
        </Link>
      </div>
    </main>
  );
}
