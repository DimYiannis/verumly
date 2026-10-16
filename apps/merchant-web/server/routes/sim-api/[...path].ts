// Same-origin proxy for the browser simulator → merchant-api, so merchant-api needs no CORS. Only /v1/** is
// forwarded, with an allowlist of headers: the dashboard cookie never reaches merchant-api.
const FORWARD = ['content-type', 'authorization', 'x-terminal-id', 'x-signature', 'idempotency-key', 'accept'];

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') ?? '';
  if (!/^v1\/[A-Za-z0-9/:_-]*$/.test(path)) throw createError({ statusCode: 404 });
  const headers = new Headers();
  for (const h of FORWARD) {
    const v = getRequestHeader(event, h);
    if (v) headers.set(h, v);
  }
  const hasBody = !['GET', 'HEAD'].includes(event.method);
  let res: Response;
  try {
    res = await fetch(`${useEnv().MERCHANT_API_URL}/${path}${getRequestURL(event).search}`, {
      method: event.method,
      headers,
      body: hasBody ? new Uint8Array((await readRawBody(event, false)) ?? []) : undefined,
    });
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'merchant-api unreachable' });
  }
  setResponseStatus(event, res.status);
  setResponseHeader(event, 'content-type', res.headers.get('content-type') ?? 'application/json');
  setResponseHeader(event, 'cache-control', 'no-store');
  return Buffer.from(await res.arrayBuffer());
});
