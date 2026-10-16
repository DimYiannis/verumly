import { defineConfig } from 'vitest/config';

// The server tests build the Nuxt app and start the real Nitro server against a fresh migrated Postgres.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 240_000, fileParallelism: false } });
