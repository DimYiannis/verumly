import { defineConfig } from 'vitest/config';

// Each test file creates (and drops) its own migrated database; running files one at a time avoids the
// `ALTER ROLE ... tuple concurrently updated` race when several migrations set the shared role passwords at once.
export default defineConfig({ test: { fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 } });
