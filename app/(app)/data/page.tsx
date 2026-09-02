import { prisma } from '@/db/client';
import { describeProviders } from '@/providers';
import { getSessionUser, can } from '@/server/auth';
import { Card, Empty, Table, Td, Th } from '@/components/ui';
import { ImportPanel } from '@/components/import-panel';
import { ExportPanel } from '@/components/export-panel';

export const dynamic = 'force-dynamic';

/** Data import centre (§55) with the provider registry and its licensing (§13). */
export default async function DataPage() {
  const user = await getSessionUser();
  const providers = describeProviders();

  const [rows, imports, errors] = await Promise.all([
    prisma.provider.findMany({
      include: { _count: { select: { imports: true } }, imports: { orderBy: { startedAt: 'desc' }, take: 1 } },
    }),
    prisma.dataImport.findMany({
      include: {
        provider: { select: { name: true } },
        requestedBy: { select: { displayName: true } },
        _count: { select: { errors: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
    }),
    prisma.dataImportError.findMany({
      include: { import: { include: { provider: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const byKey = new Map(rows.map((row) => [row.key, row]));

  return (
    <div className="space-y-5">
      {user && can(user.role, 'imports:run') && <ImportPanel providers={providers} />}

      <Card
        title="Provider registry"
        subtitle="Licensing is part of the registry - open access is not a commercial licence"
      >
        <Table>
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th>Kind</Th>
              <Th>Status</Th>
              <Th>Licence</Th>
              <Th>Commercial</Th>
              <Th>Redistribution</Th>
              <Th align="right">Imports</Th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => {
              const row = byKey.get(provider.key);
              return (
                <tr key={provider.key} className="hover:bg-ink-50">
                  <Td>
                    <span className="font-medium text-ink-800">{provider.name}</span>
                    <div className="text-[11px] text-ink-400">{provider.key}</div>
                  </Td>
                  <Td className="text-xs">{provider.kind.replace(/_/g, ' ')}</Td>
                  <Td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        provider.configured ? 'bg-good/10 text-good' : 'bg-ink-100 text-ink-500'
                      }`}
                    >
                      {provider.configured ? 'available' : 'not configured'}
                    </span>
                  </Td>
                  <Td className="text-xs" >
                    <span title={provider.licence.notes ?? ''}>{provider.licence.name}</span>
                  </Td>
                  <Td className="text-xs">
                    {provider.licence.commercialUseAllowed ? 'allowed' : 'not granted'}
                  </Td>
                  <Td className="text-xs">
                    {provider.licence.redistributionAllowed ? 'allowed' : 'not granted'}
                  </Td>
                  <Td align="right">{row?._count.imports ?? 0}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="mt-3 text-[11px] text-ink-400">
          ScoutIQ never assumes that public availability implies a right to redistribute. Check the
          licence before exporting or sharing provider data.
        </p>
      </Card>

      {user && can(user.role, 'exports:create') && <ExportPanel />}

      <Card title="Import history" subtitle="Every row in the database traces back to one of these">
        {imports.length === 0 ? (
          <Empty>No imports yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Provider</Th>
                <Th>Status</Th>
                <Th align="right">Read</Th>
                <Th align="right">Written</Th>
                <Th align="right">Errors</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {imports.map((entry) => (
                <tr key={entry.id} className="hover:bg-ink-50">
                  <Td>{entry.startedAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
                  <Td>{entry.provider.name}</Td>
                  <Td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        entry.status === 'COMPLETED'
                          ? 'bg-good/10 text-good'
                          : entry.status === 'FAILED'
                            ? 'bg-bad/10 text-bad'
                            : 'bg-ink-100 text-ink-500'
                      }`}
                    >
                      {entry.status}
                    </span>
                  </Td>
                  <Td align="right">{entry.recordsRead.toLocaleString()}</Td>
                  <Td align="right">{entry.recordsWritten.toLocaleString()}</Td>
                  <Td align="right">{entry._count.errors}</Td>
                  <Td>{entry.requestedBy?.displayName ?? 'scheduler'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {errors.length > 0 && (
        <Card title="Recent import issues">
          <ul className="space-y-2 text-sm">
            {errors.map((issue) => (
              <li key={issue.id} className="border-l-2 border-bad/40 pl-3">
                <div className="text-xs text-ink-400">
                  {issue.import.provider.name} · {issue.stage} · {issue.severity}
                </div>
                <p className="text-ink-700">{issue.message}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
