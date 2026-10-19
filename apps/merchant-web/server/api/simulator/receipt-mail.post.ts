import { receiptMailBody } from '@lr/schema';

/**
 * "Send it to my e-mail" on the till's customer screen, forwarded to buyer-api (the customer side), which sends the mail.
 * The address is only passed through: nothing is stored or logged here, and the receipt data stays with the merchant.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store');
  const parsed = receiptMailBody.safeParse(await readBody(event).catch(() => null));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid request' });
  let res: Response;
  try {
    res = await fetch(`${useEnv().BUYER_API_URL}/v1/receipts/mail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'mail service unreachable' });
  }
  setResponseStatus(event, res.status);
  return { ok: res.ok };
});
