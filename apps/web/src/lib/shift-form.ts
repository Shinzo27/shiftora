import { localDate, localTime, shiftTemplateIssue } from '@shiftora/shared';
import { z } from 'zod';

/**
 * The shift editor's fields. Same rules as the API (`localDate`, `localTime`, start ≠ end,
 * break shorter than the shift) so the form and the server agree; the server still validates
 * the real request with `createShiftRequest`, which also carries the schedule id.
 *
 * `employeeId` / `jobRoleId` are null for "open shift" / "no particular role". Keeping the
 * break a plain number (the input converts it with `setValueAs`) means the parsed value and
 * the form's values are the same type.
 */
export const shiftFormSchema = z
  .object({
    employeeId: z.uuid().nullable(),
    date: localDate,
    startTime: localTime,
    endTime: localTime,
    breakMinutes: z
      .number({ error: 'Enter a number of minutes' })
      .int('Use whole minutes')
      .min(0, 'Cannot be negative')
      .max(240, 'At most 240 minutes'),
    jobRoleId: z.uuid().nullable(),
    notes: z.string().max(500, 'At most 500 characters'),
  })
  .superRefine((values, ctx) => {
    const issue = shiftTemplateIssue(values.startTime, values.endTime, values.breakMinutes);
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  });

export type ShiftFormValues = z.output<typeof shiftFormSchema>;
