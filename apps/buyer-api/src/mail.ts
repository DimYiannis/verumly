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
        subject: `Je inlogcode / Your login code: ${code}`,
        text: `Je inlogcode is ${code}. Deze is 10 minuten geldig.\nYour login code is ${code}. It is valid for 10 minutes.`,
      });
    },
  };
}
