import { httpExtractor, recordedExtractor, type Extractor } from './extractor.ts';
import type { WorkerEnv } from './env.ts';

export function createExtractor(env: WorkerEnv): Extractor {
  if (env.EXTRACTOR === 'http') return httpExtractor({ url: env.QIANFAN_URL, model: env.QIANFAN_MODEL, revision: env.QIANFAN_REVISION });
  return recordedExtractor(env.FIXTURES_DIR);
}
