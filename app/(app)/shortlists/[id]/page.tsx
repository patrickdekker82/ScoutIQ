import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { Card } from '@/components/ui';
import { ShortlistPlayers } from '@/components/shortlist-players';
import { ExportButton } from '@/components/export-button';
import { GenerateReportButton } from '@/components/generate-report';
import { can, getSessionUser } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();

  const shortlist = await prisma.shortlist.findUnique({
    where: { id },
    include: {
      owner: { select: { displayName: true } },
      players: {
        include: {
          player: {
            select: {
              id: true,
              fullName: true,
              primaryPosition: true,
              dateOfBirth: true,
              seasonMetrics: {
                where: { analyticsVersion: ANALYTICS_VERSION },
                orderBy: { minutes: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ priority: 'asc' }, { addedAt: 'desc' }],
      },
    },
  });

  if (!shortlist) notFound();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{shortlist.name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {shortlist.description ?? 'No description'} · owned by {shortlist.owner.displayName}
        </p>
      </header>

      <Card
        title="Players"
        subtitle={`${shortlist.players.length} on the list`}
        actions={
          <div className="flex items-center gap-2">
            {user && can(user.role, 'exports:create') && (
              <ExportButton dataset="shortlists" format="csv" label="Export CSV" />
            )}
            {/* A comparison report takes two to five players (§43). */}
            {user && can(user.role, 'reports:create') && shortlist.players.length >= 2 && (
              <GenerateReportButton
                playerIds={shortlist.players.slice(0, 5).map((entry) => entry.playerId)}
                label={
                  shortlist.players.length > 5
                    ? 'Comparison PDF (top 5)'
                    : 'Comparison PDF'
                }
              />
            )}
          </div>
        }
      >
        <ShortlistPlayers
          shortlistId={shortlist.id}
          canEdit={Boolean(user && can(user.role, 'shortlists:write'))}
          entries={shortlist.players.map((entry) => {
            const metrics = entry.player.seasonMetrics[0];
            return {
              id: entry.id,
              playerId: entry.playerId,
              playerName: entry.player.fullName,
              position: entry.player.primaryPosition,
              age: entry.player.dateOfBirth
                ? Math.floor(
                    (Date.now() - entry.player.dateOfBirth.getTime()) / (365.25 * 864e5),
                  )
                : null,
              status: entry.status,
              priority: entry.priority,
              scoutRating: entry.scoutRating,
              notes: entry.notes,
              minutes: metrics?.minutes ?? null,
              confidence: metrics?.confidence ?? null,
            };
          })}
        />
      </Card>
    </div>
  );
}
