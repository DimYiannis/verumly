import { URLS } from './env.ts';

const search = (email: string) => `${URLS.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`;

export async function clearMailFor(email: string): Promise<void> {
  await fetch(search(email), { method: 'DELETE' });
}

/** The 6-digit login code in the newest mail sent to `email` (the subject carries it). */
export async function mailpitCode(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const json: unknown = await (await fetch(search(email))).json();
    const messages = typeof json === 'object' && json !== null && 'messages' in json && Array.isArray(json.messages) ? json.messages : [];
    const subject: unknown = messages[0]?.Subject;
    const code = typeof subject === 'string' ? /(\d{6})/.exec(subject)?.[1] : undefined;
    if (code) return code;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no login mail for ${email} within ${timeoutMs} ms`);
}

/** The receipt link (`.../r/<id>#<secret>`) in the newest mail sent to `email`. */
export async function mailpitReceiptLink(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const json: unknown = await (await fetch(search(email))).json();
    const messages = typeof json === 'object' && json !== null && 'messages' in json && Array.isArray(json.messages) ? json.messages : [];
    const id: unknown = messages[0]?.ID;
    if (typeof id === 'string') {
      const full: unknown = await (await fetch(`${URLS.mailpit}/api/v1/message/${id}`)).json();
      const text = typeof full === 'object' && full !== null && 'Text' in full && typeof full.Text === 'string' ? full.Text : '';
      const link = /https?:\/\/\S+\/r\/[0-9a-f-]{36}#[A-Za-z0-9_-]{43}/.exec(text)?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no receipt mail for ${email} within ${timeoutMs} ms`);
}
