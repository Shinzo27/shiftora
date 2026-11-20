import type { JobRole } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Tags, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { jobRolesApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useOrg } from '@/lib/org-context';

/**
 * Job roles (W7½ UI2): what staff *are* — Nurse, Receptionist — shared by every branch. Added,
 * renamed in place, and deleted with a warning that says what goes with them, because deleting a
 * role also removes it from people and drops coverage that asked for it.
 */
export function JobRolesSection({ canEdit }: { canEdit: boolean }) {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const roles = useQuery({
    queryKey: ['job-roles', orgId],
    queryFn: () => jobRolesApi.list(orgId),
  });
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<JobRole | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['job-roles', orgId] });

  const create = useMutation({
    mutationFn: () => jobRolesApi.create(orgId, name.trim()),
    onSuccess: () => {
      toast.success('Job role added');
      setName('');
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not add it'),
  });
  const rename = useMutation({
    mutationFn: (role: { id: string; name: string }) =>
      jobRolesApi.rename(orgId, role.id, role.name.trim()),
    onSuccess: () => {
      toast.success('Job role renamed');
      setEditing(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not rename it'),
  });
  const remove = useMutation({
    mutationFn: (role: JobRole) => jobRolesApi.remove(orgId, role.id),
    onSuccess: () => {
      toast.success('Job role deleted');
      setRemoving(null);
      refresh();
      // Coverage and employees carry the role: let their screens re-read.
      void queryClient.invalidateQueries({ queryKey: ['coverage', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['employees', orgId] });
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not delete it'),
  });

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) create.mutate();
  }

  function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing?.name.trim()) rename.mutate(editing);
  }

  return (
    <section aria-labelledby="roles-heading" className="space-y-3">
      <div>
        <h2 id="roles-heading" className="text-lg font-semibold tracking-tight">
          Job roles
        </h2>
        <p className="text-sm text-muted-foreground">
          What your staff do, across every branch. Shifts, coverage and the auto-scheduler use them.
        </p>
      </div>

      {canEdit ? (
        <form onSubmit={onAdd} className="flex max-w-md gap-2">
          <label htmlFor="new-role" className="sr-only">
            New job role
          </label>
          <Input
            id="new-role"
            placeholder="e.g. Staff nurse"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus /> Add
          </Button>
        </form>
      ) : null}

      {roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      ) : roles.isPending ? (
        <Skeleton className="h-24 max-w-xl" />
      ) : roles.data.length === 0 ? (
        <p className="flex max-w-xl items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          <Tags className="size-4" aria-hidden="true" /> No job roles yet.
        </p>
      ) : (
        <ul className="max-w-xl divide-y rounded-xl border bg-card">
          {roles.data.map((role) => (
            <li key={role.id} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
              {editing?.id === role.id ? (
                <form onSubmit={onRename} className="flex flex-1 items-center gap-2">
                  <label htmlFor={`role-${role.id}`} className="sr-only">
                    New name for {role.name}
                  </label>
                  <Input
                    id={`role-${role.id}`}
                    autoFocus
                    maxLength={100}
                    value={editing.name}
                    onChange={(event) => setEditing({ id: role.id, name: event.target.value })}
                    onKeyDown={(event) => event.key === 'Escape' && setEditing(null)}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    variant="ghost"
                    aria-label="Save name"
                    disabled={!editing.name.trim() || rename.isPending}
                  >
                    <Check />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Cancel renaming"
                    onClick={() => setEditing(null)}
                  >
                    <X />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 font-medium">{role.name}</span>
                  {canEdit ? (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Rename ${role.name}`}
                        onClick={() => setEditing({ id: role.id, name: role.name })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${role.name}`}
                        onClick={() => setRemoving(role)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Delete “${removing?.name ?? ''}”?`}
        description="It is taken off everyone who has it, coverage that asked for it is removed, and shifts and templates keep their times without a role. This cannot be undone."
        confirmLabel="Delete role"
        cancelLabel="Keep it"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
