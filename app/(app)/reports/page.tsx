import Link from 'next/link';
import { prisma } from '@/db/client';
import { Card, Empty, Table, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Report library (§50). Each row shows the analytics version it froze (§52). */
export default async function ReportsPage() {
  const reports = await prisma.report.findMany({
    include: {
      author: { select: { displayName: true } },
      player: { select: { id: true, fullName: true } },
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <Card title="Reports" subtitle={`${reports.length} generated`}>
      {reports.length === 0 ? (
        <Empty>
          No reports yet. Open a player and choose <strong>Generate PDF report</strong>.
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Title</Th>
              <Th>Subject</Th>
              <Th>Author</Th>
              <Th>Generated</Th>
              <Th>Analytics version</Th>
              <Th>Document</Th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const version = report.versions[0];
              return (
                <tr key={report.id} className="hover:bg-ink-50">
                  <Td>
                    <Link
                      href={`/reports/${report.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {report.title}
                    </Link>
                  </Td>
                  <Td>
                    {report.player ? (
                      <Link
                        href={`/players/${report.player.id}`}
                        className="text-brand-600 hover:underline"
                      >
                        {report.player.fullName}
                      </Link>
                    ) : (
                      '-'
                    )}
                  </Td>
                  <Td>{report.author?.displayName ?? '-'}</Td>
                  <Td>{version?.generatedAt.toISOString().slice(0, 16).replace('T', ' ') ?? '-'}</Td>
                  <Td>
                    <code className="rounded bg-ink-100 px-1 py-0.5 text-[11px]">
                      {version?.analyticsVersion ?? '-'}
                    </code>
                  </Td>
                  <Td>
                    <div className="flex gap-2 text-xs">
                      <a
                        href={`/api/v1/reports/${report.id}/document?format=html`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-600 hover:underline"
                      >
                        HTML
                      </a>
                      {version?.pdfPath && (
                        <a
                          href={`/api/v1/reports/${report.id}/document?format=pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-600 hover:underline"
                        >
                          PDF
                        </a>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
