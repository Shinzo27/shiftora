import { zodResolver } from '@hookform/resolvers/zod';
import { addDays, type LocalDate } from '@shiftora/domain';
import type { Employee, JobRole, Shift, ShiftWarning } from '@shiftora/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { FormAlert } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { shiftsApi } from '@/lib/api';
import { apiFieldErrors, errorMessage } from '@/lib/forms';
import { shiftFormSchema, type ShiftFormValues } from '@/lib/shift-form';
import { weekLabel } from '@/lib/week';

const OPEN = 'open';
const NO_ROLE = 'none';

interface ShiftSheetProps {
  orgId: string;
  scheduleId: string;
  weekStart: LocalDate;
  employees: Employee[];
  jobRoles: JobRole[];
  /** null = a new shift. */
  shift: Shift | null;
  /** Where the manager clicked: the date and (optionally) whose row. */
  initial: { date: LocalDate; employeeId: string | null };
  onClose: () => void;
}

/**
 * Create or edit one shift. First react-hook-form screen in the app: the shared Zod field
 * rules drive inline errors, and the API's own field errors (400) land on the same fields.
 * On save the server answers with conflict warnings; those stay on screen until the manager
 * has read them, because a warning is advice, not a failure.
 */
export function ShiftSheet({
  orgId,
  scheduleId,
  weekStart,
  employees,
  jobRoles,
  shift,
  initial,
  onClose,
}: ShiftSheetProps) {
  const queryClient = useQueryClient();
  const [warnings, setWarnings] = useState<ShiftWarning[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ShiftFormValues>({
    resolver: zodResolver(shiftFormSchema),
    defaultValues: shift
      ? {
          employeeId: shift.employeeId,
          date: shift.date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          breakMinutes: shift.breakMinutes,
          jobRoleId: shift.jobRoleId,
          notes: shift.notes ?? '',
        }
      : {
          employeeId: initial.employeeId,
          date: initial.date,
          startTime: '09:00',
          endTime: '17:00',
          breakMinutes: 0,
          jobRoleId: null,
          notes: '',
        },
  });

  const weekEnd = addDays(weekStart, 6);

  function handleSaved(result: { warnings: ShiftWarning[] }) {
    void queryClient.invalidateQueries({ queryKey: ['shifts', orgId, scheduleId] });
    void queryClient.invalidateQueries({ queryKey: ['conflicts'], exact: false });
    if (result.warnings.length > 0) {
      setWarnings(result.warnings);
      toast.warning('Saved — have a look at the warnings', {
        description: result.warnings[0]!.message,
      });
      return;
    }
    toast.success(shift ? 'Shift updated' : 'Shift added');
    onClose();
  }

  function handleFailed(error: unknown) {
    for (const [path, message] of Object.entries(apiFieldErrors(error))) {
      form.setError(path as keyof ShiftFormValues, { message });
    }
    setFormError(errorMessage(error));
  }

  const save = useMutation({
    mutationFn: (values: ShiftFormValues) => {
      const body = { ...values, notes: values.notes.trim() || null };
      return shift
        ? shiftsApi.update(orgId, shift.id, { ...body, version: shift.version })
        : shiftsApi.create(orgId, { scheduleId, ...body });
    },
    onSuccess: handleSaved,
    onError: handleFailed,
  });

  const remove = useMutation({
    mutationFn: () => shiftsApi.remove(orgId, shift!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts', orgId, scheduleId] });
      void queryClient.invalidateQueries({ queryKey: ['conflicts'], exact: false });
      toast.success('Shift removed');
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const employeeError = form.formState.errors.employeeId?.message;
  const dateError = form.formState.errors.date?.message;
  const startError = form.formState.errors.startTime?.message;
  const endError = form.formState.errors.endTime?.message;
  const breakError = form.formState.errors.breakMinutes?.message;
  const notesError = form.formState.errors.notes?.message;

  return (
    <form
      noValidate
      className="flex h-full flex-col"
      onSubmit={(event) =>
        void form.handleSubmit((values) => {
          setFormError(null);
          save.mutate(values);
        })(event)
      }
    >
      <SheetHeader>
        <SheetTitle>{shift ? 'Edit shift' : 'Add a shift'}</SheetTitle>
        <SheetDescription>
          {weekLabel(weekStart)} · times are the location’s local clock.
        </SheetDescription>
      </SheetHeader>

      <FieldGroup className="flex-1 overflow-y-auto px-4">
        <Field data-invalid={employeeError ? true : undefined}>
          <FieldLabel htmlFor="shift-employee">Employee</FieldLabel>
          <Controller
            control={form.control}
            name="employeeId"
            render={({ field }) => (
              <Select
                value={field.value ?? OPEN}
                onValueChange={(value) => field.onChange(value === OPEN ? null : value)}
              >
                <SelectTrigger id="shift-employee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OPEN}>Open shift — nobody assigned</SelectItem>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                  {/* Assigned to someone outside this location's team: keep it selectable so
                      editing other fields cannot silently unassign them. */}
                  {shift?.employeeId && !employees.some((e) => e.id === shift.employeeId) ? (
                    <SelectItem value={shift.employeeId}>
                      Current assignee (not on this team)
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            )}
          />
          {employeeError ? (
            <FieldError>{employeeError}</FieldError>
          ) : (
            <FieldDescription>
              Leave it open for staff to pick up once the marketplace ships.
            </FieldDescription>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={dateError ? true : undefined}>
            <FieldLabel htmlFor="shift-date">Date</FieldLabel>
            <Input
              id="shift-date"
              type="date"
              min={weekStart}
              max={weekEnd}
              aria-invalid={dateError ? true : undefined}
              {...form.register('date')}
            />
            {dateError ? <FieldError>{dateError}</FieldError> : null}
          </Field>
          <Field data-invalid={breakError ? true : undefined}>
            <FieldLabel htmlFor="shift-break">Break (minutes)</FieldLabel>
            <Input
              id="shift-break"
              type="number"
              min={0}
              max={240}
              step={5}
              inputMode="numeric"
              aria-invalid={breakError ? true : undefined}
              {...form.register('breakMinutes', {
                setValueAs: (value: string) => (value === '' ? 0 : Number(value)),
              })}
            />
            {breakError ? <FieldError>{breakError}</FieldError> : null}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={startError ? true : undefined}>
            <FieldLabel htmlFor="shift-start">Starts</FieldLabel>
            <Input
              id="shift-start"
              type="time"
              step={300}
              aria-invalid={startError ? true : undefined}
              {...form.register('startTime')}
            />
            {startError ? <FieldError>{startError}</FieldError> : null}
          </Field>
          <Field data-invalid={endError ? true : undefined}>
            <FieldLabel htmlFor="shift-end">Ends</FieldLabel>
            <Input
              id="shift-end"
              type="time"
              step={300}
              aria-invalid={endError ? true : undefined}
              {...form.register('endTime')}
            />
            {endError ? (
              <FieldError>{endError}</FieldError>
            ) : (
              <FieldDescription>Earlier than the start runs overnight.</FieldDescription>
            )}
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="shift-role">Job role</FieldLabel>
          <Controller
            control={form.control}
            name="jobRoleId"
            render={({ field }) => (
              <Select
                value={field.value ?? NO_ROLE}
                onValueChange={(value) => field.onChange(value === NO_ROLE ? null : value)}
              >
                <SelectTrigger id="shift-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE}>No particular role</SelectItem>
                  {jobRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>Gives the shift its colour on the board.</FieldDescription>
        </Field>

        <Field data-invalid={notesError ? true : undefined}>
          <FieldLabel htmlFor="shift-notes">Notes</FieldLabel>
          <Textarea
            id="shift-notes"
            rows={2}
            placeholder="Clinic room 2, bring the ultrasound key…"
            aria-invalid={notesError ? true : undefined}
            {...form.register('notes')}
          />
          {notesError ? <FieldError>{notesError}</FieldError> : null}
        </Field>

        {warnings.length > 0 ? (
          <div
            role="status"
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Saved, but check this
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>{warning.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <FormAlert message={Object.keys(form.formState.errors).length ? null : formError} />
      </FieldGroup>

      <SheetFooter className="sm:justify-between">
        {shift ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending || save.isPending}
          >
            {remove.isPending ? <Spinner /> : <Trash2 />}
            Delete
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
        {warnings.length > 0 ? (
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : null}
            {shift ? 'Save changes' : 'Add shift'}
          </Button>
        )}
      </SheetFooter>
    </form>
  );
}
