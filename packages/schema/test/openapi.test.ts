import { describe, expect, it } from 'vitest';
import { buyerOpenApi, merchantOpenApi } from '../src/index.ts';

describe('generated OpenAPI documents', () => {
  it('merchant API lists the five v2 §9 endpoints with a bearer scheme and a CRF body', () => {
    const doc = merchantOpenApi();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual(['/v1/receipts', '/v1/receipts/{id}', '/v1/receipts/{id}/versions', '/v1/receipts:batch', '/v1/terminals/me']);
    expect(doc.components?.securitySchemes).toHaveProperty('bearerAuth');
    expect(JSON.stringify(doc.paths?.['/v1/receipts'])).toContain('claimSecretHash');
  });
  it('buyer API lists the public resolver and wallet routes, and the resolver is unauthenticated', () => {
    const doc = buyerOpenApi();
    expect(doc.paths).toHaveProperty(['/v1/resolve/secret', 'post']);
    expect(doc.paths).toHaveProperty(['/v1/me/claims', 'post']);
    expect(JSON.stringify(doc.paths?.['/v1/resolve/secret'])).not.toContain('bearerAuth');
  });
});
