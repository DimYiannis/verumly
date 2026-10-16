import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { sha256Hex } from '@lr/crypto';
import { QIANFAN_PROMPTS } from '@lr/receipt-nl';

export interface Extraction {
  markdown: string;
  /** raw string as returned by the model for the KIE prompt (usually JSON) */
  kie: string;
  modelRevision: string;
}

/** Qianfan-OCR behind one interface (v2 §11). There is deliberately no fake implementation. */
export interface Extractor {
  extract(bytes: Uint8Array): Promise<Extraction>;
}

/** The input can never be extracted by this extractor: retrying will not help. */
export class PermanentExtractionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const recordedFile = z.object({ modelRevision: z.string().min(1), markdown: z.string(), kie: z.string() });

/**
 * Reads outputs recorded from a real Qianfan run: `<dir>/<sha256(bytes)>.qianfan.json`, then `<dir>/mock/<sha>.qianfan.json`.
 * Used in tests and the seed; a file with no recording is a permanent failure, not an empty extraction.
 */
export function recordedExtractor(fixturesDir: string): Extractor {
  return {
    async extract(bytes) {
      const sha = sha256Hex(bytes);
      for (const path of [join(fixturesDir, `${sha}.qianfan.json`), join(fixturesDir, 'mock', `${sha}.qianfan.json`)]) {
        let text: string;
        try {
          text = await readFile(path, 'utf8');
        } catch (e) {
          if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT') continue;
          throw e;
        }
        return recordedFile.parse(JSON.parse(text));
      }
      throw new PermanentExtractionError('no_recorded_extraction', `no recorded extraction for sha256 ${sha}`);
    },
  };
}

/** Magic-byte sniffing: the S3 content type is client-supplied, the model needs the real one. */
export function sniffMime(bytes: Uint8Array): string | null {
  const starts = (...b: number[]) => b.every((v, i) => bytes[i] === v);
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  return null;
}

const chatResponse = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export interface HttpExtractorOptions {
  /** OpenAI-compatible chat completions endpoint, e.g. http://gpu-box:8000/v1/chat/completions */
  url: string;
  model: string;
  /** recorded in `modelRevision` when the server does not report one */
  revision?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** POSTs the image to a vLLM-served `baidu/Qianfan-OCR` twice (markdown prompt, KIE prompt), greedy decoding. */
export function httpExtractor(opts: HttpExtractorOptions): Extractor {
  const f = opts.fetch ?? fetch;
  const ask = async (dataUrl: string, prompt: string) => {
    const res = await f(opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        max_tokens: 4096,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text: prompt }] }],
      }),
    });
    // 4xx = the model server rejected this input; 5xx / network errors throw and are retried
    if (res.status >= 400 && res.status < 500) throw new PermanentExtractionError('extractor_rejected', `extractor returned ${res.status}`);
    if (!res.ok) throw new Error(`extractor returned ${res.status}`);
    return chatResponse.parse(await res.json());
  };
  return {
    async extract(bytes) {
      const mime = sniffMime(bytes);
      if (!mime) throw new PermanentExtractionError('unsupported_file', 'file is not a JPEG, PNG, WebP or PDF');
      if (mime === 'application/pdf') {
        // vLLM's chat endpoint takes images; PDF rasterisation is not implemented (see docs/decisions/worker.md)
        throw new PermanentExtractionError('pdf_unsupported', 'PDF extraction needs page rasterisation, which is not implemented');
      }
      const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
      const markdown = await ask(dataUrl, QIANFAN_PROMPTS.markdown);
      const kie = await ask(dataUrl, QIANFAN_PROMPTS.kie);
      return {
        markdown: markdown.choices[0]!.message.content,
        kie: kie.choices[0]!.message.content,
        modelRevision: opts.revision ?? markdown.model ?? opts.model,
      };
    },
  };
}
