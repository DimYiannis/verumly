import { httpExtractor, recordedExtractor, type Extractor } from './extractor.ts';
import type { WorkerEnv } from './env.ts';
import { withPdfSupport } from './pdf-extractor.ts';

/** The configured extractor for images, wrapped so that PDFs are read too (their text, or their first page when scanned). */
export function createExtractor(env: WorkerEnv): Extractor {
  return withPdfSupport(createImageExtractor(env));
}

function createImageExtractor(env: WorkerEnv): Extractor {
  if (env.EXTRACTOR === 'http') return httpExtractor({ url: env.QIANFAN_URL, model: env.QIANFAN_MODEL, revision: env.QIANFAN_REVISION, apiKey: env.QIANFAN_API_KEY });
  return recordedExtractor(env.FIXTURES_DIR);
}
