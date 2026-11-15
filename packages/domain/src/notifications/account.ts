import type { RenderedMessage } from './templates.js';

export interface VerifyEmailContext {
  name: string;
  /** The raw token: it is the link, so this message is a credential. */
  token: string;
  appUrl: string;
  expiresInHours: number;
}

/**
 * "Is this really your address?" — the first thing a new account should be asked, and the only
 * way the product can later promise that a shift reminder reached the person it named.
 */
export function renderVerifyEmail(context: VerifyEmailContext): RenderedMessage {
  const { name, token, appUrl, expiresInHours } = context;

  return {
    subject: 'Confirm your email address',
    body: [
      `Hi ${firstName(name)}, welcome to Shiftora.`,
      '',
      `Confirm your address: ${link(appUrl, 'verify-email', token)}`,
      '',
      `The link works for ${expiresInHours} hours and can be used once.`,
      'If you did not create an account, ignore this message — nothing was confirmed.',
    ].join('\n'),
  };
}

export interface ResetPasswordContext {
  name: string;
  token: string;
  appUrl: string;
  expiresInHours: number;
}

/**
 * A reset link. Deliberately says nothing about the account beyond the fact of the request:
 * an email that leaks into the wrong inbox should not describe the clinic.
 */
export function renderResetPassword(context: ResetPasswordContext): RenderedMessage {
  const { name, token, appUrl, expiresInHours } = context;

  return {
    subject: 'Choose a new password',
    body: [
      `Hi ${firstName(name)}, we received a request to choose a new password for your Shiftora account.`,
      '',
      `Choose one here: ${link(appUrl, 'reset-password', token)}`,
      '',
      `The link works for ${expiresInHours} hour${expiresInHours === 1 ? '' : 's'} and can be used once.`,
      'If this was not you, ignore it — your password has not changed.',
    ].join('\n'),
  };
}

function link(appUrl: string, path: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/${path}?token=${encodeURIComponent(token)}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
