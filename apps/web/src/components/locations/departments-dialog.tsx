import type { Department } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FolderTree, Pencil, Plus, Trash2, X } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { departmentsApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';

/**
 * A branch's departments (W7½ UI2): "Outpatients", "Pharmacy". Added, renamed in place, deleted
 * after a confirmation.
 */
export function DepartmentsDialog({
  orgId,
  location,
  onClose,
}: {
  orgId: string;
  location: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ['departments', orgId, location?.id];
  const departments = useQuery({
    queryKey: key,
    queryFn: () => departmentsApi.list(orgId, location!.id),
    enabled: location !== null,
  });
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Department | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: () => departmentsApi.create(orgId, location!.id, name.trim()),
    onSuccess: () => {
      toast.success('Department added');
      setName('');
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not add it'),
  });
  const rename = useMutation({
    mutationFn: (department: { id: string; name: string }) =>
      departmentsApi.rename(orgId, department.id, department.name.trim()),
    onSuccess: () => {
      toast.success('Department renamed');
      setEditing(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not rename it'),
  });
  const remove = useMutation({
    mutationFn: (department: Department) => departmentsApi.remove(orgId, department.id),
    onSuccess: () => {
      toast.success('Department deleted');
      setRemoving(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not delete it'),
  });

  const rows = departments.data ?? [];

  return (
    <Dialog open={location !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Departments at {location?.name}</DialogTitle>
          <DialogDescription>
            The parts of this branch, such as Outpatients or Pharmacy.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <label htmlFor="new-department" className="sr-only">
            New department
          </label>
          <Input
            id="new-department"
            placeholder="e.g. Outpatients"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus /> Add
          </Button>
        </form>

        {departments.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(departments.error)}
          </p>
        ) : departments.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            <FolderTree className="size-4" aria-hidden="true" /> No departments yet.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {rows.map((department) => (
              <li key={department.id} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                {editing?.id === department.id ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                      event.preventDefault();
                      if (editing.name.trim()) rename.mutate(editing);
                    }}
                  >
                    <label htmlFor={`dept-${department.id}`} className="sr-only">
                      New name for {department.name}
                    </label>
                    <Input
                      id={`dept-${department.id}`}
                      autoFocus
                      maxLength={100}
                      value={editing.name}
                      onChange={(event) =>
                        setEditing({ id: department.id, name: event.target.value })
                      }
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
                    <span className="flex-1 font-medium">{department.name}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Rename ${department.name}`}
                      onClick={() => setEditing({ id: department.id, name: department.name })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${department.name}`}
                      onClick={() => setRemoving(department)}
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={removing !== null}
          title={`Delete “${removing?.name ?? ''}”?`}
          description="The department is removed from this branch. This cannot be undone."
          confirmLabel="Delete department"
          cancelLabel="Keep it"
          pending={remove.isPending}
          onConfirm={() => removing && remove.mutate(removing)}
          onCancel={() => setRemoving(null)}
        />
      </DialogContent>
    </Dialog>
  );
}
