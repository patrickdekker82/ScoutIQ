import { z } from 'zod';
import { getStorage } from '@/lib/storage';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, route } from '@/server/http';
import { parseCsv } from '@/providers/csv-json.provider';

/**
 * File upload for the data import centre (§55).
 *
 * Files land in the raw area's inbox, which is exactly where the CSV/JSON
 * provider reads from - uploading and importing stay two separate steps, so a
 * bad file can be inspected and removed before it ever touches the database.
 */

export const INBOX = 'inbox';
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** A filename is data, not a path: never let one escape the inbox. */
export function safeFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop()?.trim() ?? '';
  if (!base || base.startsWith('.')) return null;
  if (!/^[\w. -]{1,120}$/.test(base)) return null;
  if (!/\.(csv|json)$/i.test(base)) return null;
  return base;
}

/** Preview of what an uploaded file contains, without importing it. */
function describe(name: string, text: string): Record<string, unknown> {
  if (name.toLowerCase().endsWith('.json')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown[]>;
      return {
        format: 'json',
        counts: Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.length : 1,
          ]),
        ),
      };
    } catch (error) {
      return { format: 'json', error: error instanceof Error ? error.message : 'Invalid JSON' };
    }
  }

  const rows = parseCsv(text);
  // The CSV provider decides what a file is by its name, so the preview says
  // out loud which kind this one will be read as.
  const kind = name.replace(/\.csv$/i, '').split('-')[0]?.toLowerCase() ?? '';
  return {
    format: 'csv',
    readAs: ['players', 'teams', 'events'].includes(kind) ? kind : null,
    rows: rows.length,
    columns: Object.keys(rows[0] ?? {}),
    sample: rows.slice(0, 3),
  };
}

export const GET = route(async (request: Request) => {
  await requirePermission('imports:run', request);
  const storage = getStorage();

  const files = await storage.list('raw', INBOX);
  const described = await Promise.all(
    files.map(async (file) => ({
      name: file,
      bytes: await storage.size('raw', `${INBOX}/${file}`),
    })),
  );

  return json({ inbox: INBOX, files: described });
});

export const POST = route(async (request: Request) => {
  const user = await requirePermission('imports:run', request);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return apiError(400, 'bad_request', { message: 'Attach a file in the "file" field.' });
  }

  const name = safeFilename(file.name);
  if (!name) {
    return apiError(400, 'bad_request', {
      message: 'Only .csv and .json files with plain names are accepted.',
    });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return apiError(413, 'payload_too_large', {
      message: `That file is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
    });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const storage = getStorage();
  await storage.write('raw', `${INBOX}/${name}`, bytes);

  await audit({
    actorId: user.id,
    action: 'import.file.upload',
    entityType: 'file',
    entityId: name,
    summary: `Uploaded ${name} (${bytes.length} bytes) to the import inbox`,
    ip: clientIp(request),
  });

  return json(
    { name, bytes: bytes.length, preview: describe(name, bytes.toString('utf8')) },
    { status: 201 },
  );
});

const deleteSchema = z.object({ name: z.string().min(1).max(200) });

export const DELETE = route(async (request: Request) => {
  const user = await requirePermission('imports:run', request);

  const url = new URL(request.url);
  const parsed = deleteSchema.safeParse({ name: url.searchParams.get('name') ?? '' });
  const name = parsed.success ? safeFilename(parsed.data.name) : null;
  if (!name) return apiError(400, 'bad_request', { message: 'Name that file properly.' });

  const storage = getStorage();
  if (!(await storage.exists('raw', `${INBOX}/${name}`))) {
    return apiError(404, 'not_found', { message: 'That file is not in the inbox.' });
  }

  await storage.remove('raw', `${INBOX}/${name}`);

  await audit({
    actorId: user.id,
    action: 'import.file.delete',
    entityType: 'file',
    entityId: name,
    summary: `Removed ${name} from the import inbox`,
    ip: clientIp(request),
  });

  return json({ deleted: true });
});
