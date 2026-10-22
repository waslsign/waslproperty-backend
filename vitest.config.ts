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
    // resetDb()'s multi-table delete transaction (test/helpers/db.ts) can
    // occasionally exceed Vitest's 10s default hook timeout under full-suite
    // load, even though each file passes quickly in isolation — give it
    // headroom rather than let an otherwise-passing suite flake.
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
