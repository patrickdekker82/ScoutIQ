import pino, { type Logger as PinoLogger } from 'pino';
import { getConfig } from '@/lib/config';

/**
 * Structured logging to stdout only: the platform (Docker, systemd, a VPS log
 * shipper) decides where logs end up, so nothing here writes files.
 *
 * Built lazily. Reading the configuration at module scope would make importing
 * ANY module fail on an incomplete environment - including in tests and in
 * tooling that never logs.
 */
let instance: PinoLogger | undefined;

function build(): PinoLogger {
  const config = getConfig();
  return pino({
    level: config.logLevel,
    base: { service: 'scoutiq' },
    ...(config.isProduction ? {} : { transport: { target: 'pino-pretty' } }),
  });
}

export const logger = new Proxy({} as PinoLogger, {
  get(_target, property) {
    instance ??= build();
    return Reflect.get(instance, property, instance);
  },
});

export type Logger = PinoLogger;

/** Test helper: forget the memoised logger after the environment changes. */
export function resetLogger(): void {
  instance = undefined;
}
