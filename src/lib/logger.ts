import pino from 'pino';
import { getConfig } from '../config/env.js';

const config = getConfig();

export const logger = pino({
  level: config.logLevel,
  base: { service: 'scoutiq' },
  // No file transports: containers log to stdout so the platform (Docker,
  // systemd, a VPS log shipper) decides where logs end up.
  ...(config.isProduction ? {} : { transport: { target: 'pino-pretty' } }),
});

export type Logger = typeof logger;
