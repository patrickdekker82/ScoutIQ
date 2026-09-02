import { NextResponse } from 'next/server';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { logger } from '@/lib/logger';
import { AuthError } from '@/server/auth';
import { SqlValidationError } from '@/server/services/sql.service';

/**
 * Shared plumbing for route handlers.
 *
 * One place decides how errors become status codes, so a handler can throw and
 * trust the shape of the response - and no handler leaks an internal message
 * to a client by accident.
 */

export interface ApiErrorBody {
  error: string;
  message?: string;
  issues?: unknown;
}

export function apiError(status: number, error: string, extra: Partial<ApiErrorBody> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return apiError(error.status, error.status === 401 ? 'unauthorized' : 'forbidden', {
      message: error.message,
    });
  }

  if (error instanceof ZodError) {
    return apiError(400, 'invalid_request', { issues: error.issues });
  }

  if (error instanceof SqlValidationError) {
    return apiError(400, 'invalid_sql', { message: error.message });
  }

  if (error instanceof Error && error.message.startsWith('Unknown provider')) {
    return apiError(404, 'not_found', { message: error.message });
  }

  logger.error(
    { err: error instanceof Error ? error.message : String(error) },
    'unhandled route error',
  );
  return apiError(500, 'internal_error');
}

/**
 * Wrap a handler so thrown errors become well-formed responses.
 *
 * Returns `Response`, not `NextResponse`: handlers that stream a PDF or serve
 * raw HTML build a plain Response, and both are valid route results.
 */
export function route<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleError(error);
    }
  };
}

/**
 * Parse a JSON body. Generic over the SCHEMA, not its output type: writing
 * `ZodSchema<T>` would unify T with the schema's input as well and turn every
 * defaulted field back into an optional one.
 */
export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  const body = await request.json().catch(() => ({}));
  return schema.parse(body) as z.infer<S>;
}

export function parseQuery<S extends ZodTypeAny>(request: Request, schema: S): z.infer<S> {
  const params = new URL(request.url).searchParams;
  const raw: Record<string, string | string[]> = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    raw[key] = values.length > 1 ? values : (values[0] as string);
  }

  return schema.parse(raw) as z.infer<S>;
}

export const json = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);
