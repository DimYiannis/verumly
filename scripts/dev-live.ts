import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Starts the whole stack with photo reading done by the live Qianfan server (the Colab notebook).
 * Reads QIANFAN_URL, QIANFAN_API_KEY and QIANFAN_REVISION from the git-ignored `.env.qianfan` (or from the environment).
 * The tunnel address changes every Colab run: update QIANFAN_URL in that file each time.
 */
const FILE = '.env.qianfan';
if (existsSync(FILE)) process.loadEnvFile(FILE);

if (!process.env.QIANFAN_URL) {
  console.error(
    `QIANFAN_URL is not set. Put these lines in ${FILE} (it is git-ignored), using the values printed by the last cell of tools/qianfan/colab_serve.ipynb:\n` +
      '  QIANFAN_URL=https://<name>.trycloudflare.com\n  QIANFAN_REVISION=<revision>\n  QIANFAN_API_KEY=<the key you typed into the notebook>',
  );
  process.exit(1);
}

const child = spawn('pnpm', ['dev', '--env-mode=loose'], { stdio: 'inherit', env: { ...process.env, EXTRACTOR: 'http' } });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
