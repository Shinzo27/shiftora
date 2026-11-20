import {
  setAvailabilityRequest,
  type Employee,
  type TimeOff,
  type WeeklySlotDto,
} from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState, FormAlert } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { employeesApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useOrg } from '@/lib/org-context';
import { dayRange, timeOffLabel, WEEKDAY_NAMES } from '@/lib/time-off';

/**
 * A manager's view of one person's week (W7½ UI2): when they can work (a weekly pattern on the
 * branch's clock, which the scheduler and the conflict badges read) and the days they are off.
 * Staff see the same time off in their app; only managers enter it.
 */
export function AvailabilitySheet({
  employee,
  onClose,
}: {
  employee: Employee | null;
  onClose: () => void;
}) {
  const { locations } = useOrg();
  // Their branch's calendar; the browser's when they have none yet.
  const zone =
    locations.find((location) => employee?.locationIds.includes(location.id))?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Sheet open={employee !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{employee?.name}: availability and time off</SheetTitle>
          <SheetDescription>Times are the branch’s local clock ({zone}).</SheetDescription>
        </SheetHeader>
        {employee ? (
          <div className="space-y-8 px-4 pb-6">
            {/* Keyed by person, so opening someone else starts from their saved pattern. */}
            <WeeklyPattern key={employee.id} employeeId={employee.id} />
            <TimeOffSection employeeId={employee.id} zone={zone} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function WeeklyPattern({ employeeId }: { employeeId: string }) {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const saved = useQuery({
    queryKey: ['availability', orgId, employeeId],
    queryFn: () => employeesApi.availability(orgId, employeeId),
  });
  // null = untouched: show what is saved; an array = the manager's edits, not yet saved.
  const [draft, setDraft] = useState<WeeklySlotDto[] | null>(null);
  const [slotErrors, setSlotErrors] = useState<Record<number, string>>({});
  const slots = draft ?? saved.data?.slots ?? [];

  const save = useMutation({
    mutationFn: (next: WeeklySlotDto[]) =>
      employeesApi.setAvailability(orgId, employeeId, { slots: next }),
    onSuccess: (result) => {
      queryClient.setQueryData(['availability', orgId, employeeId], result);
      setDraft(null);
      toast.success('Availability saved');
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not save it'),
  });

  const change = (index: number, patch: Partial<WeeklySlotDto>) => {
    setDraft(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
    setSlotErrors({});
  };

  function onSave() {
    // The API's own rule (no overlaps, valid times), checked here so the error sits on its row.
    const parsed = setAvailabilityRequest.safeParse({ slots });
    if (!parsed.success) {
      const errors: Record<number, string> = {};
      for (const issue of parsed.error.issues) {
        const index = issue.path[1];
        if (typeof index === 'number') errors[index] ??= issue.message;
      }
      setSlotErrors(errors);
      return;
    }
    save.mutate(parsed.data.slots);
  }

  return (
    <section aria-labelledby="pattern-heading" className="space-y-3">
      <div>
        <h3 id="pattern-heading" className="font-medium">
          Weekly availability
        </h3>
        <p className="text-sm text-muted-foreground">
          When they can be rostered. An end earlier than the start runs overnight. No rows means no
          preference.
        </p>
      </div>

      {saved.isError ? (
        <ErrorState error={saved.error} onRetry={() => void saved.refetch()} />
      ) : saved.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          {slots.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No weekly pattern: they can be rostered any time.
            </p>
          ) : (
            <ul className="space-y-2">
              {slots.map((slot, index) => (
                <li key={index} className="space-y-1">
                  <div className="flex items-end gap-1.5">
                    <Field className="w-20 shrink-0">
                      <FieldLabel htmlFor={`slot-day-${index}`} className="sr-only">
                        Day, time {index + 1}
                      </FieldLabel>
                      <Select
                        value={String(slot.weekday)}
                        onValueChange={(value) => change(index, { weekday: Number(value) })}
                      >
                        <SelectTrigger id={`slot-day-${index}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAY_NAMES.map((name, day) => (
                            <SelectItem key={name} value={String(day + 1)}>
                              {name.slice(0, 3)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field className="min-w-0 flex-1">
                      <FieldLabel htmlFor={`slot-start-${index}`} className="sr-only">
                        From, time {index + 1}
                      </FieldLabel>
                      <Input
                        id={`slot-start-${index}`}
                        type="time"
                        className="px-2"
                        value={slot.start}
                        aria-invalid={slotErrors[index] ? true : undefined}
                        onChange={(event) => change(index, { start: event.target.value })}
                      />
                    </Field>
                    <Field className="min-w-0 flex-1">
                      <FieldLabel htmlFor={`slot-end-${index}`} className="sr-only">
                        To, time {index + 1}
                      </FieldLabel>
                      <Input
                        id={`slot-end-${index}`}
                        type="time"
                        className="px-2"
                        value={slot.end}
                        aria-invalid={slotErrors[index] ? true : undefined}
                        onChange={(event) => change(index, { end: event.target.value })}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${WEEKDAY_NAMES[slot.weekday - 1] ?? ''} ${slot.start}–${slot.end}`}
                      onClick={() => {
                        setDraft(slots.filter((_, i) => i !== index));
                        setSlotErrors({});
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {slotErrors[index] ? <FieldError>{slotErrors[index]}</FieldError> : null}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft([...slots, { weekday: 1, start: '09:00', end: '17:00' }])}
            >
              <Plus /> Add a time
            </Button>
            {draft !== null ? (
              <>
                <Button type="button" size="sm" disabled={save.isPending} onClick={onSave}>
                  {save.isPending ? <Spinner /> : null}
                  Save availability
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(null);
                    setSlotErrors({});
                  }}
                >
                  Discard changes
                </Button>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function TimeOffSection({ employeeId, zone }: { employeeId: string; zone: string }) {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const [firstDay, setFirstDay] = useState('');
  const [lastDay, setLastDay] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TimeOff | null>(null);

  const key = ['employee-time-off', orgId, employeeId];
  const list = useQuery({
    queryKey: key,
    // Current and coming time off: anything ending after now ("now" is read in the fetch).
    queryFn: () => employeesApi.timeOff(orgId, employeeId, new Date().toISOString()),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () =>
      employeesApi.addTimeOff(orgId, employeeId, {
        ...dayRange(firstDay, lastDay || firstDay, zone),
        reason: reason.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Time off added');
      setFirstDay('');
      setLastDay('');
      setReason('');
      refresh();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (item: TimeOff) => employeesApi.removeTimeOff(orgId, item.id),
    onSuccess: () => {
      toast.success('Time off removed');
      setRemoving(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not remove it'),
  });

  const lastBeforeFirst = lastDay !== '' && firstDay !== '' && lastDay < firstDay;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!firstDay || lastBeforeFirst) return;
    add.mutate();
  }

  return (
    <section aria-labelledby="time-off-heading" className="space-y-3">
      <div>
        <h3 id="time-off-heading" className="font-medium">
          Time off
        </h3>
        <p className="text-sm text-muted-foreground">
          Whole days. Shifts on these days show a warning, and the auto-scheduler leaves them free.
        </p>
      </div>

      <form noValidate onSubmit={onSubmit} className="space-y-3 rounded-lg border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="off-first">First day off</FieldLabel>
            <Input
              id="off-first"
              type="date"
              value={firstDay}
              onChange={(event) => setFirstDay(event.target.value)}
            />
          </Field>
          <Field data-invalid={lastBeforeFirst ? true : undefined}>
            <FieldLabel htmlFor="off-last">Last day off</FieldLabel>
            <Input
              id="off-last"
              type="date"
              min={firstDay || undefined}
              value={lastDay}
              aria-invalid={lastBeforeFirst ? true : undefined}
              aria-describedby={lastBeforeFirst ? 'off-last-error' : undefined}
              onChange={(event) => setLastDay(event.target.value)}
            />
            {lastBeforeFirst ? (
              <FieldError id="off-last-error">Must be on or after the first day.</FieldError>
            ) : null}
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="off-reason">Reason (optional)</FieldLabel>
          <Input
            id="off-reason"
            maxLength={200}
            placeholder="Annual leave, conference…"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <FormAlert message={formError} />
        <Button type="submit" size="sm" disabled={!firstDay || lastBeforeFirst || add.isPending}>
          {add.isPending ? <Spinner /> : <Plus />}
          Add time off
        </Button>
      </form>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : list.data.length === 0 ? (
        <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <CalendarOff className="size-4" aria-hidden="true" /> No time off coming up.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {list.data.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{timeOffLabel(item, zone)}</p>
                {item.reason ? <p className="text-muted-foreground">{item.reason}</p> : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove time off ${timeOffLabel(item, zone)}`}
                onClick={() => setRemoving(item)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remove this time off?"
        description={
          removing ? `${timeOffLabel(removing, zone)} becomes a normal working period again.` : ''
        }
        confirmLabel="Remove"
        cancelLabel="Keep it"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
