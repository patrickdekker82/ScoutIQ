import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests must never depend on machine-specific state: no shared globals,
    // no reliance on a database being present on the host.
    restoreMocks: true,
  },
});
