import type { PipeTransform } from '@nestjs/common';
import { errorCodes } from '@shiftora/shared';
import type { z } from 'zod';

import { AppException } from './app-exception.js';

/**
 * Validates and parses a value with a shared Zod schema. Use per parameter:
 *   @Body(new ZodValidationPipe(signupRequest)) body: SignupRequest
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        400,
        errorCodes.validationFailed,
        'The request is invalid.',
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
