import { z } from 'zod';
import { getFiscalSpec, missingFiscalKeys } from './specs.ts';
import type { FiscalContext, FiscalResult, StateIntegration } from './types.ts';

export interface GatewayOptions {
  country: string;
  /** where the receipt is POSTed: a certified fiscal provider, or a service on the till that drives the device */
  url: string;
  /** sent as `Authorization: Bearer <key>`; never logged */
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const answer = z.object({
  documentNumber: z.string().max(60).nullable().optional(),
  registerSerial: z.string().max(60).nullable().optional(),
  extra: z.record(z.string(), z.string().max(200)),
});

/**
 * The live integration: POST `{ country, receipt, settings }` to the gateway and use what comes back. The gateway is
 * the part that talks to the device or the authority (TSE driver, Fiskaly-like provider, a national API client); this
 * file only fixes the contract:
 *
 *   request  { country, receipt: Crf (state "paid"), settings: { <the business's country settings> } }
 *   answer   { documentNumber?, registerSerial?, extra: { <the country's FiscalField keys>: string } }
 *
 * 5xx, 408, 429 and network errors are retryable (the receipt stays `paid` and can be fiscalised later); any other
 * refusal, or an answer without the fields the country needs, is permanent.
 */
export function gatewayIntegration(opts: GatewayOptions): StateIntegration {
  const country = opts.country.toUpperCase();
  const spec = getFiscalSpec(country);
  const f = opts.fetch ?? fetch;
  return {
    country,
    spec,
    mode: spec ? 'live' : 'none',
    async submit(c: FiscalContext): Promise<FiscalResult> {
      if (!spec) return { ok: false, retryable: false, code: 'no_fiscal_step' };
      let res: Response;
      try {
        res = await f(opts.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
          body: JSON.stringify({ country, receipt: c.receipt, settings: c.settings }),
        });
      } catch {
        return { ok: false, retryable: true, code: 'gateway_unreachable' };
      }
      if (res.status >= 500 || res.status === 408 || res.status === 429) return { ok: false, retryable: true, code: `gateway_${res.status}` };
      if (!res.ok) return { ok: false, retryable: false, code: `gateway_rejected_${res.status}` };
      const parsed = answer.safeParse(await res.json().catch(() => null));
      if (!parsed.success) return { ok: false, retryable: false, code: 'gateway_bad_answer' };
      const extra = parsed.data.extra;
      if (missingFiscalKeys(country, extra).length > 0) return { ok: false, retryable: false, code: 'gateway_incomplete' };
      return {
        ok: true,
        mode: 'live',
        documentNumber: parsed.data.documentNumber ?? null,
        registerSerial: parsed.data.registerSerial ?? null,
        extra,
      };
    },
  };
}
