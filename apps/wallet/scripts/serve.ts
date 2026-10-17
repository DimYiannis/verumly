// Cross-platform replacement for `PORT=3001 node .output/server/index.mjs` (cmd.exe has no inline env vars).
process.env.PORT ??= '3001';
await import('../.output/server/index.mjs');
