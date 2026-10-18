import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { crf, uuidV7String } from './crf.ts';
import { addVersionBody, batchBody, claimBody, createReceiptBody, emailStartBody, emailVerifyBody, receiptPreview, resolveBody, writeResult } from './api.ts';

const body = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const json = (description: string, schema?: z.ZodType) => ({ description, ...(schema ? body(schema) : {}) });
const idParam = z.object({ id: uuidV7String });
const idem = z.object({ 'Idempotency-Key': z.string().min(8).max(200) });
const bearer = [{ bearerAuth: [] }];

function generate(title: string, description: string, register: (r: OpenAPIRegistry) => void) {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer' });
  register(registry);
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({ openapi: '3.1.0', info: { title, version: '1', description } });
}

/** OpenAPI for merchant-api (terminals). Generated from the shared Zod schemas; served at GET /docs. */
export function merchantOpenApi() {
  return generate(
    'Merchant API',
    'Terminal ingest. Every request carries `Authorization: Bearer <terminal key>` and `X-Terminal-Id`; POSTs also carry `X-Signature` (Ed25519 over the raw body).',
    (r) => {
      r.registerPath({ method: 'post', path: '/v1/receipts', security: bearer, request: { headers: idem, body: body(createReceiptBody) }, responses: { 201: json('created', writeResult), 200: json('replayed', writeResult), 409: json('idempotency_conflict | version_gap'), 422: json('invalid_receipt') } });
      r.registerPath({ method: 'post', path: '/v1/receipts/{id}/versions', security: bearer, request: { params: idParam, headers: idem, body: body(addVersionBody) }, responses: { 201: json('created', writeResult), 200: json('replayed', writeResult), 409: json('version_gap | bad_transition | idempotency_conflict'), 422: json('invalid_receipt') } });
      r.registerPath({ method: 'post', path: '/v1/receipts:batch', security: bearer, request: { body: body(batchBody) }, responses: { 200: json('per-item results (partial success allowed)') } });
      r.registerPath({ method: 'get', path: '/v1/receipts/{id}', security: bearer, request: { params: idParam }, responses: { 200: json('own org only', z.object({ versions: z.array(crf) }).partial()), 404: json('not found') } });
      r.registerPath({ method: 'get', path: '/v1/terminals/me', security: bearer, responses: { 200: json('terminal config and server time') } });
    },
  );
}

/** OpenAPI for buyer-api (public resolver + authenticated buyer routes). */
export function buyerOpenApi() {
  return generate(
    'Buyer API',
    'Public resolver (no login; 30 requests/min per IP, 10 failed secrets per receipt per hour) and the buyer API (Bearer session token).',
    (r) => {
      r.registerPath({ method: 'post', path: '/v1/resolve/secret', request: { body: body(resolveBody) }, responses: { 200: json('pending, or ok with preview', z.object({ status: z.enum(['pending', 'ok']), preview: receiptPreview.optional() })), 404: json('wrong secret'), 429: json('rate limited') } });
      r.registerPath({ method: 'post', path: '/v1/resolve/view', request: { body: body(resolveBody) }, responses: { 200: json('full latest CRF and versions'), 404: json('wrong secret'), 429: json('rate limited') } });
      r.registerPath({ method: 'post', path: '/v1/auth/email/start', request: { body: body(emailStartBody) }, responses: { 202: json('code sent') } });
      r.registerPath({ method: 'post', path: '/v1/auth/email/verify', request: { body: body(emailVerifyBody) }, responses: { 200: json('session token') } });
      r.registerPath({ method: 'post', path: '/v1/me/claims', security: bearer, request: { body: body(claimBody) }, responses: { 201: json('claimed'), 200: json('already yours'), 409: json('already_claimed'), 410: json('claim_expired') } });
      r.registerPath({ method: 'get', path: '/v1/me/receipts', security: bearer, responses: { 200: json('cursor-paginated wallet list') } });
      r.registerPath({ method: 'get', path: '/v1/me/receipts/{id}', security: bearer, request: { params: idParam }, responses: { 200: json('latest CRF and versions'), 404: json('not yours') } });
      r.registerPath({ method: 'get', path: '/v1/me/receipts/{id}/pdf', security: bearer, request: { params: idParam }, responses: { 200: json('application/pdf') } });
      r.registerPath({ method: 'get', path: '/v1/me/insights', security: bearer, responses: { 200: json('spend per month, per category, top merchants; refunds apart'), 403: json('consent_required: the analytics consent is off') } });
    },
  );
}
