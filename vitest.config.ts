import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // Integration tests share one real Postgres test database (no per-file
    // schema isolation yet), so run test files sequentially to avoid
    // concurrent resetDb() calls racing against each other.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
