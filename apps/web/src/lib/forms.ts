import type { z } from 'zod';

import { ApiError } from './api-client.js';

export type FieldErrors = Record<string, string>;

/** First error message per field, from a failed Zod parse. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'form';
    errors[path] ??= issue.message;
  }
  return errors;
}

/** Field errors from an API 400, so server and client errors show in the same place. */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  const errors: FieldErrors = {};
  for (const fieldError of error.fieldErrors) errors[fieldError.path] ??= fieldError.message;
  return errors;
}

/** A text field from a form (FormData values can also be files). */
export function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** Rupees as typed by a person ("250.50") → paise (25050). */
export function rupeesToPaise(value: string): number {
  return Math.round(Number(value || '0') * 100);
}

export function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}
