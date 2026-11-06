import { errorCodes } from '@shiftora/shared';

import { AppException } from './app-exception.js';

/**
 * Keyset pagination: the cursor is the sort key of the last item returned (here
 * name + id), base64url-encoded. The next page asks for rows *after* that key, which stays
 * fast and stable on large tables, unlike OFFSET (which rescans and skips/duplicates rows
 * when data changes between pages).
 */
export function encodeCursor(values: string[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(cursor: string, length: number): string[] {
  try {
    const values: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(values) &&
      values.length === length &&
      values.every((v): v is string => typeof v === 'string')
    ) {
      return values;
    }
  } catch {
    // fall through
  }
  throw new AppException(400, errorCodes.validationFailed, 'Invalid cursor.', [
    { path: 'cursor', message: 'Use the nextCursor value from the previous page' },
  ]);
}
