import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppException } from './app-exception.js';
import { toProblem } from './problem-details.filter.js';

describe('toProblem', () => {
  it('renders an AppException with its code and field errors', () => {
    const problem = toProblem(
      new AppException(400, 'validation_failed', 'The request is invalid.', [
        { path: 'email', message: 'Invalid email' },
      ]),
    );
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      code: 'validation_failed',
      detail: 'The request is invalid.',
      errors: [{ path: 'email', message: 'Invalid email' }],
    });
  });

  it('maps Nest HTTP exceptions to a code by status', () => {
    expect(toProblem(new NotFoundException('Cannot GET /x'))).toMatchObject({
      status: 404,
      code: 'not_found',
      title: 'Not Found',
    });
  });

  it('hides unexpected errors behind a generic 500', () => {
    const problem = toProblem(new Error('connection string postgres://user:secret@db leaked'));
    expect(problem).toMatchObject({ status: 500, code: 'internal_error' });
    expect(JSON.stringify(problem)).not.toContain('secret');
  });
});
