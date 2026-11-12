import { createTransport, type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. The templates are written for a phone; HTML would only add ways to render badly. */
  body: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<{ messageId: string }>;
  close(): void;
}

/**
 * SMTP, which locally means Mailpit (`:1025`, UI on `:8025`) and in production means whatever
 * the deployment points at. No SDK, no API key: one dependency, and the same code path in both.
 */
export function createMailer(options: {
  host: string;
  port: number;
  from: string;
  secure?: boolean;
  user?: string;
  pass?: string;
}): Mailer {
  const transport: Transporter = createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure ?? false,
    ...(options.user ? { auth: { user: options.user, pass: options.pass ?? '' } } : {}),
  });

  return {
    async send(message) {
      const info = await transport.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
      return { messageId: info.messageId };
    },
    close() {
      transport.close();
    },
  };
}
