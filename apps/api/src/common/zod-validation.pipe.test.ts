import { signupRequest } from '@shiftora/shared';
import { describe, expect, it } from 'vitest';

import { AppException } from './app-exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const pipe = new ZodValidationPipe(signupRequest);

describe('ZodValidationPipe', () => {
  it('returns the parsed value', () => {
    expect(pipe.transform({ name: ' Asha ', email: 'a@b.co', password: '12345678' })).toEqual({
      name: 'Asha',
      email: 'a@b.co',
      password: '12345678',
    });
  });

  it('throws a 400 AppException listing every invalid field', () => {
    let caught: unknown;
    try {
      pipe.transform({ name: '', email: 'nope', password: '1' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppException);
    const exception = caught as AppException;
    expect(exception.getStatus()).toBe(400);
    expect(exception.code).toBe('validation_failed');
    expect(exception.errors?.map((e) => e.path).sort()).toEqual(['email', 'name', 'password']);
  });
});
