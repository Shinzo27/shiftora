import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { FormAlert } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { attendanceApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { readableDate } from '@/lib/week';

interface FormValues {
  clockInTime: string;
  clockOutTime: string;
  reason: string;
}

/**
 * Correcting a punch, with the reason that makes it defensible.
 *
 * Times are typed the way they are read off a wall clock — the server converts them with the
 * location's zone, exactly like a shift. The history underneath is the audit trail for this
 * row, so the manager sees what it was before, which is also what the employee would be shown
 * if they ever asked.
 */
export function EditPunchSheet({
  orgId,
  entryId,
  timezone,
  onClose,
}: {
  orgId: string;
  entryId: string;
  /** The location's zone: the history is shown in the wall clock the punch happened in. */
  timezone: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['time-entry', orgId, entryId],
    queryFn: () => attendanceApi.detail(orgId, entryId),
  });

  const form = useForm<FormValues>({
    defaultValues: { clockInTime: '', clockOutTime: '', reason: '' },
  });

  // Fill the form once the punch arrives; resetting on refetch would fight the typist.
  useEffect(() => {
    if (!detail.data) return;
    form.reset({
      clockInTime: detail.data.entry.clockInTime,
      clockOutTime: detail.data.entry.clockOutTime ?? '',
      reason: '',
    });
  }, [detail.data, form]);

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      attendanceApi.edit(orgId, entryId, {
        clockInTime: values.clockInTime,
        clockOutTime: values.clockOutTime === '' ? null : values.clockOutTime,
        reason: values.reason.trim(),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['attendance', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['time-entry', orgId, entryId] });
      toast.success('Punch corrected', {
        description: `${result.entry.clockInTime}–${result.entry.clockOutTime ?? '…'}, with the reason on record.`,
      });
      onClose();
    },
  });

  const entry = detail.data?.entry;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Correct this punch</SheetTitle>
          <SheetDescription>
            {entry ? (
              <>
                {entry.employeeName} · {readableDate(entry.date)} · {entry.locationName}
              </>
            ) : (
              'Loading the punch…'
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
          {detail.isPending ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : detail.isError ? (
            <FormAlert message={errorMessage(detail.error)} />
          ) : (
            <form
              id="correct-punch"
              className="space-y-4"
              onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
              noValidate
            >
              <FieldGroup>
                <Field data-invalid={Boolean(form.formState.errors.clockInTime)}>
                  <FieldLabel htmlFor="clock-in">Clock in</FieldLabel>
                  <Input
                    id="clock-in"
                    type="time"
                    step="60"
                    className="w-32 tabular-nums"
                    aria-invalid={Boolean(form.formState.errors.clockInTime)}
                    {...form.register('clockInTime', { required: 'Needs a clock-in time' })}
                  />
                  {form.formState.errors.clockInTime ? (
                    <FieldError>{form.formState.errors.clockInTime.message}</FieldError>
                  ) : null}
                </Field>

                <Field data-invalid={Boolean(form.formState.errors.clockOutTime)}>
                  <FieldLabel htmlFor="clock-out">Clock out</FieldLabel>
                  <Input
                    id="clock-out"
                    type="time"
                    step="60"
                    className="w-32 tabular-nums"
                    aria-invalid={Boolean(form.formState.errors.clockOutTime)}
                    {...form.register('clockOutTime', {
                      validate: (value) =>
                        value === '' ||
                        value > form.getValues('clockInTime') ||
                        'Earlier than the clock-in — that reads as the next morning',
                    })}
                  />
                  <FieldDescription>
                    Leave it empty to reopen a punch someone forgot to close.
                  </FieldDescription>
                  {form.formState.errors.clockOutTime ? (
                    <FieldError>{form.formState.errors.clockOutTime.message}</FieldError>
                  ) : null}
                </Field>

                <Field data-invalid={Boolean(form.formState.errors.reason)}>
                  <FieldLabel htmlFor="reason">Why</FieldLabel>
                  <Textarea
                    id="reason"
                    rows={3}
                    placeholder="He was on a house call until 09:45."
                    aria-invalid={Boolean(form.formState.errors.reason)}
                    {...form.register('reason', {
                      validate: (value) =>
                        value.trim().length >= 3 || 'A few words, so this stands up later',
                    })}
                  />
                  <FieldDescription>
                    Kept with the before and after, against your name.
                  </FieldDescription>
                  {form.formState.errors.reason ? (
                    <FieldError>{form.formState.errors.reason.message}</FieldError>
                  ) : null}
                </Field>
              </FieldGroup>

              {save.isError ? <FormAlert message={errorMessage(save.error)} /> : null}
            </form>
          )}

          {detail.data && detail.data.edits.length > 0 ? (
            <section aria-labelledby="history-heading" className="mt-6 border-t pt-4 pb-6">
              <h3 id="history-heading" className="text-sm font-semibold">
                What changed before
              </h3>
              <ol className="mt-2 space-y-3">
                {[...detail.data.edits].reverse().map((edit) => (
                  <li key={edit.at} className="text-sm">
                    <p className="text-muted-foreground tabular-nums">
                      {timeOf(edit.before.clockInAt, timezone)}–
                      {timeOf(edit.before.clockOutAt, timezone)} →{' '}
                      {timeOf(edit.after.clockInAt, timezone)}–
                      {timeOf(edit.after.clockOutAt, timezone)}
                    </p>
                    <p>{edit.reason ?? 'No reason recorded'}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>

        <SheetFooter className="border-t">
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="correct-punch" disabled={save.isPending || !entry}>
            {save.isPending ? 'Saving…' : 'Save correction'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** An instant to `HH:MM` at the location, so a manager abroad reads their own branch's clock. */
function timeOf(instant: string | null, timezone: string): string {
  if (!instant) return '…';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(new Date(instant));
}
