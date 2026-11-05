import { STATUS_CODES } from 'node:http';

import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { errorCodes, type ErrorCode, type ProblemDetails } from '@shiftora/shared';
import type { FastifyReply } from 'fastify';

import { AppException } from './app-exception.js';

const codeForStatus: Record<number, ErrorCode> = {
  400: errorCodes.validationFailed,
  401: errorCodes.unauthenticated,
  404: errorCodes.notFound,
  429: errorCodes.rateLimited,
};

/** Maps any thrown value to an RFC 7807 problem. Unexpected errors never leak details. */
export function toProblem(exception: unknown): ProblemDetails {
  if (exception instanceof AppException) {
    const status = exception.getStatus();
    return {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      code: exception.code,
      detail: exception.message,
      ...(exception.errors ? { errors: exception.errors } : {}),
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      code: codeForStatus[status] ?? `http_${status}`,
      detail: exception.message,
    };
  }
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    code: errorCodes.internal,
    detail: 'Something went wrong. Please try again.',
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const problem = toProblem(exception);
    if (problem.status >= 500) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : exception,
      );
    }
    void host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(problem.status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .send(problem);
  }
}
