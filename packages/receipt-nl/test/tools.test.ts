import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QIANFAN_PROMPTS } from '../src/index.ts';

const dir = join(import.meta.dirname, '..', '..', '..', 'tools', 'qianfan');

describe('tools/qianfan use the fixed Appendix A prompts', () => {
  it('colab_extract.ipynb is a valid notebook that carries both prompts and greedy decoding', () => {
    const raw = readFileSync(join(dir, 'colab_extract.ipynb'), 'utf8');
    const nb: { nbformat: number; cells: { cell_type: string; source: string[] }[] } = JSON.parse(raw);
    expect(nb.nbformat).toBe(4);
    const code = nb.cells.filter((c) => c.cell_type === 'code').map((c) => c.source.join('')).join('\n');
    expect(code).toContain(JSON.stringify(QIANFAN_PROMPTS.markdown));
    expect(code).toContain(JSON.stringify(QIANFAN_PROMPTS.kie));
    expect(code).toContain('do_sample=False');
    expect(code).toContain('.qianfan.json');
    expect(code).toContain('hashlib.sha256');
  });

  it('serve.md documents vllm serve baidu/Qianfan-OCR and both prompts', () => {
    const md = readFileSync(join(dir, 'serve.md'), 'utf8');
    expect(md).toContain('vllm serve baidu/Qianfan-OCR');
    expect(md).toContain(QIANFAN_PROMPTS.markdown);
    expect(md).toContain(QIANFAN_PROMPTS.kie);
  });
});
