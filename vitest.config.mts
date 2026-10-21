import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Integration tests hit the local Supabase stack: allow slow auth/DB calls.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Test files run one at a time so they do not compete for the same local DB.
    fileParallelism: false,
  },
})
