import { describe, expect, it } from 'vitest';

import { renderResetPassword, renderVerifyEmail } from './account.js';

describe('renderVerifyEmail', () => {
  it('carries the token in a link and says how long it lasts', () => {
    const message = renderVerifyEmail({
      name: 'Asha Mehta',
      token: 'abc123',
      appUrl: 'http://localhost:5173',
      expiresInHours: 24,
    });
    expect(message.subject).toBe('Confirm your email address');
    expect(message.body).toContain('Hi Asha, welcome to Shiftora.');
    expect(message.body).toContain('http://localhost:5173/verify-email?token=abc123');
    expect(message.body).toContain('The link works for 24 hours and can be used once.');
  });

  it('does not double the slash when the app URL ends with one', () => {
    const message = renderVerifyEmail({
      name: 'Asha Mehta',
      token: 'abc',
      appUrl: 'https://app.example.com/',
      expiresInHours: 24,
    });
    expect(message.body).toContain('https://app.example.com/verify-email?token=abc');
    expect(message.body).not.toContain('//verify-email');
  });
});

describe('renderResetPassword', () => {
  it('says what to do and what happens if it was not you', () => {
    const message = renderResetPassword({
      name: 'Rohan Desai',
      token: 'r3set',
      appUrl: 'http://localhost:5173',
      expiresInHours: 1,
    });
    expect(message.subject).toBe('Choose a new password');
    expect(message.body).toContain('http://localhost:5173/reset-password?token=r3set');
    expect(message.body).toContain('The link works for 1 hour and can be used once.');
    expect(message.body).toContain('your password has not changed');
  });

  it('describes nothing about the account', () => {
    // An email that lands in the wrong inbox should not describe the business.
    const message = renderResetPassword({
      name: 'Rohan Desai',
      token: 'x',
      appUrl: 'http://localhost:5173',
      expiresInHours: 1,
    });
    expect(message.body.toLowerCase()).not.toContain('clinic');
    expect(message.body).not.toContain('shift');
  });

  it('escapes a token that would otherwise break the query string', () => {
    const message = renderResetPassword({
      name: 'A B',
      token: 'a+b/c=',
      appUrl: 'http://localhost:5173',
      expiresInHours: 1,
    });
    expect(message.body).toContain('token=a%2Bb%2Fc%3D');
  });
});
