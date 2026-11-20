import { formatMinutes } from '@shiftora/domain';
import { createShiftTemplateRequest, type ShiftTemplate } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { jobRolesApi, shiftTemplatesApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';

const NO_ROLE = 'none';

interface Draft {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  jobRoleId: string;
}

const blank: Draft = {
  name: '',
  startTime: '09:00',
  endTime: '17:00',
  breakMinutes: '30',
  jobRoleId: NO_ROLE,
};

/**
 * A branch's shift templates (W7½ UI2): named shapes such as "Morning 08:00–14:00, 30 min break,
 * Nurse". The form checks the same rules as the API (start ≠ end, break shorter than the shift),
 * so the message lands under the field before anything is sent.
 */
export function TemplatesDialog({
  orgId,
  location,
  onClose,
}: {
  orgId: string;
  location: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ['shift-templates', orgId, location?.id];
  const templates = useQuery({
    queryKey: key,
    queryFn: () => shiftTemplatesApi.list(orgId, location!.id),
    enabled: location !== null,
  });
  const roles = useQuery({
    queryKey: ['job-roles', orgId],
    queryFn: () => jobRolesApi.list(orgId),
    enabled: location !== null,
  });
  const [draft, setDraft] = useState<Draft>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [removing, setRemoving] = useState<ShiftTemplate | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const reset = () => {
    setDraft(blank);
    setEditingId(null);
    setErrors({});
  };

  const save = useMutation({
    mutationFn: (body: {
      name: string;
      startTime: string;
      endTime: string;
      breakMinutes: number;
      jobRoleId: string | null;
    }) =>
      editingId
        ? shiftTemplatesApi.update(orgId, editingId, body)
        : shiftTemplatesApi.create(orgId, { locationId: location!.id, ...body }),
    onSuccess: () => {
      toast.success(editingId ? 'Template updated' : 'Template added');
      reset();
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not save it'),
  });
  const remove = useMutation({
    mutationFn: (template: ShiftTemplate) => shiftTemplatesApi.remove(orgId, template.id),
    onSuccess: () => {
      toast.success('Template deleted');
      setRemoving(null);
      if (removing?.id === editingId) reset();
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not delete it'),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = {
      name: draft.name.trim(),
      startTime: draft.startTime,
      endTime: draft.endTime,
      breakMinutes: draft.breakMinutes === '' ? 0 : Number(draft.breakMinutes),
      jobRoleId: draft.jobRoleId === NO_ROLE ? null : draft.jobRoleId,
    };
    const parsed = createShiftTemplateRequest.safeParse({ locationId: location!.id, ...body });
    if (!parsed.success) {
      const next: Partial<Record<keyof Draft, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && field in blank)
          next[field as keyof Draft] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const roleName = new Map((roles.data ?? []).map((role) => [role.id, role.name]));
  const rows = templates.data ?? [];

  return (
    <Dialog
      open={location !== null}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Shift templates at {location?.name}</DialogTitle>
          <DialogDescription>
            The shifts this branch usually runs, on its local clock. An end earlier than the start
            runs overnight.
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={onSubmit} className="space-y-3 rounded-xl border p-4">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {editingId ? 'Edit template' : 'Add a template'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="template-name">Name</FieldLabel>
              <Input
                id="template-name"
                placeholder="e.g. Morning"
                maxLength={100}
                value={draft.name}
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => set({ name: event.target.value })}
              />
              {errors.name ? <FieldError>{errors.name}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="template-role">Job role</FieldLabel>
              <Select value={draft.jobRoleId} onValueChange={(value) => set({ jobRoleId: value })}>
                <SelectTrigger id="template-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE}>No particular role</SelectItem>
                  {(roles.data ?? []).map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={errors.startTime ? true : undefined}>
                <FieldLabel htmlFor="template-start">Starts</FieldLabel>
                <Input
                  id="template-start"
                  type="time"
                  value={draft.startTime}
                  aria-invalid={errors.startTime ? true : undefined}
                  onChange={(event) => set({ startTime: event.target.value })}
                />
                {errors.startTime ? <FieldError>{errors.startTime}</FieldError> : null}
              </Field>
              <Field data-invalid={errors.endTime ? true : undefined}>
                <FieldLabel htmlFor="template-end">Ends</FieldLabel>
                <Input
                  id="template-end"
                  type="time"
                  value={draft.endTime}
                  aria-invalid={errors.endTime ? true : undefined}
                  onChange={(event) => set({ endTime: event.target.value })}
                />
                {errors.endTime ? <FieldError>{errors.endTime}</FieldError> : null}
              </Field>
            </div>
            <Field data-invalid={errors.breakMinutes ? true : undefined}>
              <FieldLabel htmlFor="template-break">Break (minutes)</FieldLabel>
              <Input
                id="template-break"
                type="number"
                min={0}
                max={240}
                step={5}
                inputMode="numeric"
                value={draft.breakMinutes}
                aria-invalid={errors.breakMinutes ? true : undefined}
                onChange={(event) => set({ breakMinutes: event.target.value })}
              />
              {errors.breakMinutes ? <FieldError>{errors.breakMinutes}</FieldError> : null}
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              {editingId ? 'Save changes' : 'Add template'}
            </Button>
            {editingId ? (
              <Button type="button" variant="ghost" onClick={reset}>
                Cancel editing
              </Button>
            ) : null}
          </div>
        </form>

        {templates.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(templates.error)}
          </p>
        ) : templates.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            <LayoutTemplate className="size-4" aria-hidden="true" /> No templates yet.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {rows.map((template) => (
              <li key={template.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {template.name} · {template.startTime}–{template.endTime}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatMinutes(template.paidMinutes)} paid
                    {template.breakMinutes > 0 ? `, ${template.breakMinutes} min break` : ''}
                    {template.jobRoleId
                      ? ` · ${roleName.get(template.jobRoleId) ?? 'a role'}`
                      : ' · any role'}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Edit ${template.name}`}
                  onClick={() => {
                    setEditingId(template.id);
                    setErrors({});
                    setDraft({
                      name: template.name,
                      startTime: template.startTime,
                      endTime: template.endTime,
                      breakMinutes: String(template.breakMinutes),
                      jobRoleId: template.jobRoleId ?? NO_ROLE,
                    });
                  }}
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${template.name}`}
                  onClick={() => setRemoving(template)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={removing !== null}
          title={`Delete “${removing?.name ?? ''}”?`}
          description="Shifts already on the rota are not touched. This cannot be undone."
          confirmLabel="Delete template"
          cancelLabel="Keep it"
          pending={remove.isPending}
          onConfirm={() => removing && remove.mutate(removing)}
          onCancel={() => setRemoving(null)}
        />
      </DialogContent>
    </Dialog>
  );
}
