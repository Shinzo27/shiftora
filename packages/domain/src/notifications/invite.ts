import type { RenderedMessage } from './templates.js';

export interface InviteContext {
  /** The address the invite was sent to — the person may not have an account yet. */
  email: string;
  orgName: string;
  /** `manager`, `employee`… the word the UI uses. */
  role: string;
  /** The one-time code. It is the link, so it is also the secret. */
  code: string;
  /** Where the accept page lives, e.g. https://app.example.com. */
  appUrl: string;
  expiresInDays: number;
}

/**
 * The invite email.
 *
 * The link carries the code, so this message is a credential: it says what it is for, who sent
 * it, and how long it lasts — and nothing else, so a forwarded copy leaks one invite rather than
 * a picture of the clinic.
 */
export function renderInvite(context: InviteContext): RenderedMessage {
  const { orgName, role, code, appUrl, expiresInDays } = context;
  const link = acceptUrl(appUrl, code);

  return {
    subject: `You are invited to ${orgName} on Shiftora`,
    body: [
      `You have been invited to join ${orgName} on Shiftora as ${article(role)}.`,
      '',
      `Accept the invite: ${link}`,
      '',
      `The link works for ${expiresInDays} day${expiresInDays === 1 ? '' : 's'} and can be used once.`,
      'If you were not expecting this, ignore it — nothing happens until the link is opened.',
    ].join('\n'),
  };
}

/** `https://app.example.com/` + `abc-123` → `https://app.example.com/invite/abc-123`. */
export function acceptUrl(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/+$/, '')}/invite/${encodeURIComponent(code)}`;
}

function article(role: string): string {
  // "a manager", "an employee", "an owner" — the indefinite article is the only grammar here.
  return `${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}`;
}
