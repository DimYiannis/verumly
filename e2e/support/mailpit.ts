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
