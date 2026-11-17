import type { CoverageRequirementView, JobRole } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { coverageApi, jobRolesApi } from '@/lib/api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ANY_ROLE = 'any';

/**
 * Standing coverage for one branch (W7 D1).
 *
 * This is what the auto-scheduler will fill: "every Monday, two nurses, 09:00–17:00". A manager
 * writes it once here; the solver turns a week of it into draft shifts and explains whatever it
 * could not fill.
 */
export function CoverageDialog({
  orgId,
  location,
  onClose,
}: {
  orgId: string;
  location: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [weekday, setWeekday] = useState('1');
  const [roleId, setRoleId] = useState(ANY_ROLE);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [headcount, setHeadcount] = useState('1');

  const requirements = useQuery({
    queryKey: ['coverage', orgId, location?.id],
    queryFn: () => coverageApi.list(orgId, location!.id),
    enabled: location !== null,
  });
  const roles = useQuery({
    queryKey: ['job-roles', orgId],
    queryFn: () => jobRolesApi.list(orgId),
    enabled: location !== null,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['coverage', orgId, location?.id] });
  };

  const add = useMutation({
    mutationFn: () =>
      coverageApi.create(orgId, location!.id, {
        weekday: Number(weekday),
        jobRoleId: roleId === ANY_ROLE ? null : roleId,
        startLocal: start,
        endLocal: end,
        headcount: Number(headcount),
      }),
    onSuccess: () => {
      toast.success('Requirement added.');
      refresh();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not add that.');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => coverageApi.remove(orgId, id),
    onSuccess: () => {
      toast.success('Removed.');
      refresh();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not remove that.');
    },
  });

  const rows = requirements.data ?? [];

  return (
    <Dialog open={location !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Coverage at {location?.name}</DialogTitle>
          <DialogDescription>
            What this branch needs every week. The auto-scheduler fills these into draft shifts —
            nothing is published without you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl border p-4">
            <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Add a requirement
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="coverage-day">Day</Label>
                <Select value={weekday} onValueChange={setWeekday}>
                  <SelectTrigger id="coverage-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day, index) => (
                      <SelectItem key={day} value={String(index + 1)}>
                        {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="coverage-role">Role</Label>
                <Select value={roleId} onValueChange={setRoleId}>
                  <SelectTrigger id="coverage-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_ROLE}>Anyone at the branch</SelectItem>
                    {(roles.data ?? []).map((role: JobRole) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="coverage-start">From</Label>
                  <Input
                    id="coverage-start"
                    type="time"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="coverage-end">To</Label>
                  <Input
                    id="coverage-end"
                    type="time"
                    value={end}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="coverage-count">How many people</Label>
                <Input
                  id="coverage-count"
                  type="number"
                  min={1}
                  max={20}
                  value={headcount}
                  onChange={(event) => setHeadcount(event.target.value)}
                />
              </div>
            </div>
            <Button className="mt-3" disabled={add.isPending} onClick={() => add.mutate()}>
              <Plus className="mr-2 size-4" aria-hidden="true" />
              Add
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Every week
            </p>
            {requirements.isPending ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <CalendarClock
                  className="mx-auto size-6 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing yet — add the hours this branch has to cover.
                </p>
              </div>
            ) : (
              <ul className="divide-y rounded-xl border">
                {rows.map((row: CoverageRequirementView) => (
                  <li key={row.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {DAYS[row.weekday - 1]} · {row.startLocal.slice(0, 5)}–
                        {row.endLocal.slice(0, 5)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.headcount} {row.headcount === 1 ? 'person' : 'people'}
                        {row.jobRoleName ? ` · ${row.jobRoleName}` : ' · anyone at the branch'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove requirement"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(row.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
