import { z } from 'zod';
import { getStorage } from '@/lib/storage';
import { requirePermission } from '@/server/auth';
import { apiError, json, parseQuery, route } from '@/server/http';
import { parseCsv } from '@/providers/csv-json.provider';
import { INBOX, safeFilename } from '@/app/api/v1/imports/files/route';

const querySchema = z.object({ name: z.string().min(1).max(200) });

/** Inspect an uploaded file before importing it (§55). */
export const GET = route(async (request: Request) => {
  await requirePermission('imports:run', request);
  const query = parseQuery(request, querySchema);

  const name = safeFilename(query.name);
  if (!name) return apiError(400, 'bad_request', { message: 'Name that file properly.' });

  const storage = getStorage();
  if (!(await storage.exists('raw', `${INBOX}/${name}`))) {
    return apiError(404, 'not_found', { message: 'That file is not in the inbox.' });
  }

  const text = (await storage.read('raw', `${INBOX}/${name}`)).toString('utf8');

  if (name.toLowerCase().endsWith('.json')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return json({
        name,
        format: 'json',
        counts: Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.length : 1,
          ]),
        ),
        sample: Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.slice(0, 3) : value,
          ]),
        ),
      });
    } catch (error) {
      return json({
        name,
        format: 'json',
        error: error instanceof Error ? error.message : 'Invalid JSON',
      });
    }
  }

  const rows = parseCsv(text);
  const kind = name.replace(/\.csv$/i, '').split('-')[0]?.toLowerCase() ?? '';
  const columns = Object.keys(rows[0] ?? {});

  // Duplicate detection at the file level (§55): the same external id twice in
  // one file is a mistake worth seeing before the importer resolves entities.
  const idColumn = columns.find((column) =>
    ['external_id', 'id', 'player_external_id', 'match_external_id'].includes(column),
  );
  const seen = new Map<string, number>();
  if (idColumn) {
    for (const row of rows) {
      const value = row[idColumn];
      if (value) seen.set(value, (seen.get(value) ?? 0) + 1);
    }
  }
  const duplicates = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }))
    .slice(0, 20);

  const blankColumns = columns.filter((column) =>
    rows.every((row) => (row[column] ?? '').trim() === ''),
  );

  return json({
    name,
    format: 'csv',
    readAs: ['players', 'teams', 'events'].includes(kind) ? kind : null,
    rows: rows.length,
    columns,
    sample: rows.slice(0, 8),
    idColumn: idColumn ?? null,
    duplicates,
    blankColumns,
  });
});
