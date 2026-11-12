import { describe, expect, it } from 'vitest';

import { acceptUrl, renderInvite } from './invite.js';

const base = {
  email: 'rohan@example.test',
  orgName: 'Sunrise Clinic',
  role: 'manager',
  code: 'SC-abc123',
  appUrl: 'http://localhost:5173',
  expiresInDays: 7,
};

describe('renderInvite', () => {
  it('names the clinic, the role and the link', () => {
    const message = renderInvite(base);
    expect(message.subject).toBe('You are invited to Sunrise Clinic on Shiftora');
    expect(message.body).toContain(
      'You have been invited to join Sunrise Clinic on Shiftora as a manager.',
    );
    expect(message.body).toContain('Accept the invite: http://localhost:5173/invite/SC-abc123');
  });

  it('says how long the link lasts, and that it is single use', () => {
    const message = renderInvite(base);
    expect(message.body).toContain('The link works for 7 days and can be used once.');
  });

  it('gets the article right', () => {
    expect(renderInvite({ ...base, role: 'employee' }).body).toContain('as an employee.');
    expect(renderInvite({ ...base, role: 'owner' }).body).toContain('as an owner.');
  });

  it('never includes anything about the clinic beyond its name', () => {
    // A forwarded invite should leak one invitation, not a picture of the business.
    const message = renderInvite(base);
    expect(message.body).not.toContain('branch');
    expect(message.body).not.toContain('shift');
  });

  it('builds the accept link without doubling the slash', () => {
    expect(acceptUrl('https://app.example.com/', 'abc')).toBe('https://app.example.com/invite/abc');
    expect(acceptUrl('https://app.example.com', 'abc')).toBe('https://app.example.com/invite/abc');
  });
});
