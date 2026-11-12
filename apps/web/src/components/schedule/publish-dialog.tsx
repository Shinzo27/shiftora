import type { Employee, PublishPreview, Schedule } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { schedulesApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { weekLabel } from '@/lib/week';

interface PublishDialogProps {
  orgId: string;
  schedule: Schedule;
  employees: Employee[];
  onClose: () => void;
}

/**
 * Confirms a publish.
 *
 * The point of the confirmation is the **diff**: after a week has been sent once, publishing
 * again should tell the manager exactly who will hear about it and why. An empty diff says so
 * and cannot be published — a no-op notification run is not worth the messages.
 */
export function PublishDialog({ orgId, schedule, employees, onClose }: PublishDialogProps) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['publish-preview', orgId, schedule.id],
    queryFn: () => schedulesApi.publishPreview(orgId, schedule.id),
  });

  function refreshWeek() {
    void queryClient.invalidateQueries({ queryKey: ['schedules', orgId] });
    void queryClient.invalidateQueries({ queryKey: ['shifts', orgId, schedule.id] });
    void queryClient.invalidateQueries({ queryKey: ['conflicts', orgId, schedule.id] });
    void queryClient.invalidateQueries({ queryKey: ['publish-preview', orgId] });
  }

  const publish = useMutation({
    mutationFn: () => schedulesApi.publish(orgId, schedule.id),
    onSuccess: ({ publication }) => {
      const told = publication.diff.affectedEmployeeIds.length;
      toast.success(
        told === 0
          ? 'Week published'
          : `Week published — ${told} ${told === 1 ? 'person' : 'people'} will be told`,
        {
          description:
            told === 0
              ? 'Nothing changed since the last publish, so no messages go out.'
              : 'Notifications are queued by the worker.',
        },
      );
      refreshWeek();
      onClose();
    },
    onError: (error) => toast.error("Couldn't publish", { description: errorMessage(error) }),
  });

  const data = preview.data;
  const names = new Map(employees.map((employee) => [employee.id, employee.name]));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish {weekLabel(schedule.weekStart)}</DialogTitle>
          <DialogDescription>
            Staff are told only about shifts that differ from the last publish.
          </DialogDescription>
        </DialogHeader>

        {preview.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-5 w-32" />
          </div>
        ) : preview.isError ? (
          <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>
        ) : data ? (
          <PublishSummary
            preview={data}
            names={names}
            everPublished={schedule.publishedVersion !== null}
          />
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => publish.mutate()}
            disabled={publish.isPending || preview.isPending || !preview.data?.hasChanges}
          >
            {publish.isPending ? <Spinner /> : <CalendarCheck />}
            {schedule.publishedVersion === null ? 'Publish week' : 'Publish changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublishSummary({
  preview,
  names,
  everPublished,
}: {
  preview: PublishPreview;
  names: Map<string, string>;
  everPublished: boolean;
}) {
  const { added, changed, removed, affectedEmployeeIds } = preview.diff;
  const total = added.length + changed.length + removed.length;

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {everPublished
          ? 'Nothing has changed since the last publish, so there is nothing to send.'
          : 'This week has no shifts yet. Add some before publishing.'}
      </p>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <ul className="space-y-1.5">
        {added.length ? (
          <li className="flex items-center gap-2">
            <Plus className="size-4 text-success" aria-hidden="true" />
            {added.length} new {added.length === 1 ? 'shift' : 'shifts'}
          </li>
        ) : null}
        {changed.length ? (
          <li className="flex items-center gap-2">
            <ArrowRight className="size-4 text-warning" aria-hidden="true" />
            {changed.length} changed
          </li>
        ) : null}
        {removed.length ? (
          <li className="flex items-center gap-2">
            <Trash2 className="size-4 text-destructive" aria-hidden="true" />
            {removed.length} removed
          </li>
        ) : null}
      </ul>

      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="font-medium">
          {affectedEmployeeIds.length === 0
            ? 'Nobody will be told'
            : `${affectedEmployeeIds.length} ${affectedEmployeeIds.length === 1 ? 'person' : 'people'} will be told`}
        </p>
        {affectedEmployeeIds.length > 0 ? (
          <p className="mt-1 text-muted-foreground">
            {affectedEmployeeIds.map((id) => names.get(id) ?? 'a former employee').join(', ')}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            These shifts are open, so there is nobody to notify yet.
          </p>
        )}
      </div>
    </div>
  );
}
