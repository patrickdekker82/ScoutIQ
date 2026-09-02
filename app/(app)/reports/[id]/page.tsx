import { notFound } from 'next/navigation';
import { prisma } from '@/db/client';
import { Card, Empty, Table, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** One report and its versions, each reproducible from its snapshot (§52). */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      author: { select: { displayName: true } },
      player: { select: { id: true, fullName: true } },
      versions: {
        orderBy: { version: 'desc' },
        include: { blocks: { orderBy: { order: 'asc' }, select: { id: true, type: true, title: true } } },
      },
    },
  });

  if (!report) notFound();

  const latest = report.versions[0];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{report.title}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {report.type} · {report.status} · {report.author?.displayName ?? 'ScoutIQ'}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/v1/reports/${report.id}/document?format=html`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Open HTML
          </a>
          {latest?.pdfPath && (
            <a
              href={`/api/v1/reports/${report.id}/document?format=pdf`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Open PDF
            </a>
          )}
        </div>
      </header>

      <Card title="Versions" subtitle="Every version froze the data it was built from">
        {report.versions.length === 0 ? (
          <Empty>No versions.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th align="right">Version</Th>
                <Th>Generated</Th>
                <Th>Analytics version</Th>
                <Th>Data snapshot</Th>
                <Th align="right">Blocks</Th>
                <Th>Files</Th>
              </tr>
            </thead>
            <tbody>
              {report.versions.map((version) => (
                <tr key={version.id}>
                  <Td align="right">{version.version}</Td>
                  <Td>{version.generatedAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
                  <Td>
                    <code className="rounded bg-ink-100 px-1 py-0.5 text-[11px]">
                      {version.analyticsVersion}
                    </code>
                  </Td>
                  <Td>
                    <code className="text-[11px] text-ink-500">
                      {version.dataSnapshotId.slice(0, 12)}
                    </code>
                  </Td>
                  <Td align="right">{version.blocks.length}</Td>
                  <Td className="text-xs text-ink-500">
                    {[version.htmlPath && 'HTML', version.pdfPath && 'PDF']
                      .filter(Boolean)
                      .join(' · ') || '-'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {latest && (
        <Card title="Contents" subtitle={`${latest.blocks.length} blocks`}>
          <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {latest.blocks.map((block) => (
              <li key={block.id} className="text-sm text-ink-700">
                <span className="text-ink-400">{block.type}</span>
                {block.title && <span> — {block.title}</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
