import { HttpException } from '@nestjs/common';
import type { ErrorCode, FieldError } from '@shiftora/shared';

/** An error with a stable `code` for clients, rendered as RFC 7807 problem details. */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    detail: string,
    readonly errors?: FieldError[],
  ) {
    super(detail, status);
  }
}
