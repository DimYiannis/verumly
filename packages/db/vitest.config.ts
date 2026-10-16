import { defineConfig } from 'vitest/config';

// Integration tests talk to real Postgres from docker compose; creating a migrated database takes a few seconds.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 120_000 } });
