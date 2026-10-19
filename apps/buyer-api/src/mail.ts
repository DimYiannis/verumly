import nodemailer from 'nodemailer';
import type { Mailer } from './context.ts';

/** SMTP mailer (Mailpit locally). The message body is never logged. */
export function smtpMailer(opts: { host: string; port: number; from: string }): Mailer {
  const transport = nodemailer.createTransport({ host: opts.host, port: opts.port, secure: false, tls: { rejectUnauthorized: false } });
  return {
    async sendCode(to, code) {
      await transport.sendMail({
        from: opts.from,
        to,
        subject: `Your login code: ${code}`,
        text: `Your login code is ${code}. It is valid for 10 minutes.`,
      });
    },
    async sendReceipt(to, m) {
      const nl = m.locale === 'nl';
      await transport.sendMail({
        from: opts.from,
        to,
        subject: nl ? `Je bon van ${m.merchantName}` : `Your receipt from ${m.merchantName}`,
        text: nl
          ? `Hier is je bon van ${m.merchantName}:

${m.url}

Bewaar hem in je wallet om hem altijd bij de hand te hebben. Iedereen met deze link kan de bon openen, deel hem dus niet. De winkel heeft je e-mailadres niet bewaard, en wij ook niet.`
          : `Here is your receipt from ${m.merchantName}:

${m.url}

Save it in your wallet to keep it at hand. Anyone with this link can open the receipt, so do not share it. The shop did not keep your e-mail address, and neither did we.`,
      });
    },
  };
}
