import type { NextConfig } from 'next';

/**
 * ScoutIQ runs behind a reverse proxy inside a Debian VM (or on a VPS), never
 * on a managed platform, so the build target is a self-contained standalone
 * server that the Docker image can copy out.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep native/heavy modules out of the bundle: they are used by route
  // handlers at runtime, not by the client.
  serverExternalPackages: ['@prisma/client', 'bullmq', 'ioredis', 'pino', 'playwright'],
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
