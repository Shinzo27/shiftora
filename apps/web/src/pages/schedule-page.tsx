import { addDays, startOfWeek, type LocalDate } from '@shiftora/domain';
import type { Shift } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enGB } from 'date-fns/locale';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useState } from 'react';
import { toast } from 'sonner';

import { ErrorState, PageHeader } from '@/components/page';
import { ShiftSheet } from '@/components/schedule/shift-sheet';
import { WeekBoard } from '@/components/schedule/week-board';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { employeesApi, jobRolesApi, schedulesApi, shiftsApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/forms';
import { useOrg } from '@/lib/org-context';
import { applyShiftMove, conflictMap, type ShiftMoveRequest } from '@/lib/schedule';
import {
  fromCalendarDate,
  readableDate,
  toCalendarDate,
  todayLocalDate,
  weekLabel,
} from '@/lib/week';

/** How many employees the board loads at once (a week has to show them all). */
const BOARD_LIMIT = 100;

interface SheetState {
  shift: Shift | null;
  initial: { date: LocalDate; employeeId: string | null };
}

/**
 * The week board: one location, one week, employees down and days across. A manager picks a
 * week, creates the schedule if the week has none, then adds, edits and deletes shifts in
 * place. Conflicts are answered by the API: an overlap is refused, the rest come back as
 * warnings on the shift sheet.
 */
export function SchedulePage() {
  const { orgId, role, locations, locationId, selectLocation } = useOrg();
  const canManage = role === 'owner' || role === 'manager';
  const today = todayLocalDate();
  const [weekStart, setWeekStart] = useState<LocalDate>(() => startOfWeek(today));
  const [sheet, setSheet] = useState<SheetState | null>(null);

  // "All locations" has no single rota; with one branch there is nothing to choose.
  const location =
    locations.find((item) => item.id === locationId) ??
    (locations.length === 1 ? locations[0]! : null);

  const schedules = useQuery({
    queryKey: ['schedules', orgId, location?.id, weekStart],
    queryFn: () => schedulesApi.list(orgId, { locationId: location!.id, weekStart }),
    enabled: Boolean(location),
  });
  const schedule = schedules.data?.[0] ?? null;

  const shifts = useQuery({
    queryKey: ['shifts', orgId, schedule?.id],
    queryFn: () => shiftsApi.list(orgId, schedule!.id),
    enabled: Boolean(schedule),
  });

  const employees = useQuery({
    queryKey: ['employees', 'board', orgId, location?.id],
    queryFn: () => employeesApi.list(orgId, { locationId: location!.id, limit: BOARD_LIMIT }),
    enabled: Boolean(location),
  });

  const jobRoles = useQuery({
    queryKey: ['job-roles', orgId],
    queryFn: () => jobRolesApi.list(orgId),
    enabled: Boolean(location),
  });

  // One request for the whole week's advisories, so the chips can carry their badges.
  const conflicts = useQuery({
    queryKey: ['conflicts', orgId, schedule?.id],
    queryFn: () => schedulesApi.conflicts(orgId, schedule!.id),
    enabled: Boolean(schedule),
  });

  const queryClient = useQueryClient();
  const createSchedule = useMutation({
    mutationFn: () => schedulesApi.create(orgId, { locationId: location!.id, weekStart }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules', orgId, location?.id] });
      toast.success('Schedule started', { description: 'Add shifts to build the week.' });
    },
    onError: (error) =>
      toast.error("Couldn't start the schedule", { description: errorMessage(error) }),
  });

  /**
   * Moving a chip is optimistic: the board shows the new cell at once, and the API's answer
   * either confirms it or the previous list comes back. A stale `version` means someone else
   * saved first, so the week is refetched and the manager is told why.
   */
  const moveShift = useMutation({
    mutationFn: (move: ShiftMoveRequest) =>
      shiftsApi.update(orgId, move.id, {
        date: move.date,
        employeeId: move.employeeId,
        version: move.version,
      }),
    onMutate: async (move) => {
      const key = ['shifts', orgId, schedule?.id];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Shift[]>(key);
      queryClient.setQueryData<Shift[]>(key, (list) => (list ? applyShiftMove(list, move) : list));
      return { previous, key };
    },
    onError: (error, _move, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      const code = error instanceof ApiError ? error.code : '';
      if (code === 'shift.version_conflict') {
        toast.error('Someone else changed this shift', {
          description: 'Showing the latest version of the week.',
        });
      } else if (code === 'shift.overlap') {
        toast.error('That would double-book them', { description: errorMessage(error) });
      } else {
        toast.error("Couldn't move the shift", { description: errorMessage(error) });
      }
      void queryClient.invalidateQueries({ queryKey: ['shifts', orgId, schedule?.id] });
    },
    onSuccess: ({ shift: saved, warnings }) => {
      if (warnings.length > 0) {
        toast.warning(`Moved — ${warnings[0]!.message}`);
      } else {
        toast.success(
          `Moved to ${readableDate(saved.date)}${saved.employeeId ? '' : ' (open shift)'}`,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts', orgId, schedule?.id] });
      void queryClient.invalidateQueries({ queryKey: ['conflicts', orgId, schedule?.id] });
    },
  });

  const failed = schedules.error ?? shifts.error ?? employees.error ?? jobRoles.error;
  const loading =
    schedules.isPending ||
    employees.isPending ||
    jobRoles.isPending ||
    (schedule !== null && shifts.isPending);

  const defaultDate = weekStart <= today && today <= addDays(weekStart, 6) ? today : weekStart;

  return (
    <>
      <PageHeader
        title="Schedule"
        description={
          location
            ? `${location.name} · ${location.timezone} · week of ${weekLabel(weekStart)}`
            : 'Build a week of shifts for one location.'
        }
        actions={
          location ? (
            <div className="flex flex-wrap items-center gap-2">
              <WeekNav weekStart={weekStart} today={today} onChange={setWeekStart} />
              {canManage ? (
                <Button
                  onClick={() =>
                    setSheet({ shift: null, initial: { date: defaultDate, employeeId: null } })
                  }
                  disabled={!schedule}
                >
                  <Plus /> Add shift
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      {!locations.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MapPin />
            </EmptyMedia>
            <EmptyTitle>No locations yet</EmptyTitle>
            <EmptyDescription>A week belongs to a location. Add a branch first.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to="locations">Add a location</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : !location ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays />
            </EmptyMedia>
            <EmptyTitle>Which location’s rota?</EmptyTitle>
            <EmptyDescription>
              Pick a branch to see its week. The switcher in the top bar changes it everywhere.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap justify-center gap-2">
              {locations.map((item) => (
                <Button key={item.id} variant="outline" onClick={() => selectLocation(item.id)}>
                  <MapPin /> {item.name}
                </Button>
              ))}
            </div>
          </EmptyContent>
        </Empty>
      ) : failed ? (
        <ErrorState
          error={failed}
          onRetry={() => {
            void schedules.refetch();
            void shifts.refetch();
            void employees.refetch();
            void jobRoles.refetch();
          }}
        />
      ) : loading ? (
        <BoardSkeleton />
      ) : !schedule ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarPlus />
            </EmptyMedia>
            <EmptyTitle>No schedule for this week yet</EmptyTitle>
            <EmptyDescription>
              {weekLabel(weekStart)} has no rota at {location.name}. Start one, then add shifts.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button onClick={() => createSchedule.mutate()} disabled={createSchedule.isPending}>
                <CalendarPlus /> Start the week
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={schedule.status === 'published' ? 'default' : 'secondary'}>
              {schedule.status === 'published' ? 'Published' : 'Draft'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {shifts.data?.length ?? 0} shift{shifts.data?.length === 1 ? '' : 's'} ·{' '}
              {employees.data?.items.length ?? 0} people
              {employees.data?.nextCursor ? ` (showing the first ${BOARD_LIMIT})` : ''}
            </span>
          </div>
          <WeekBoard
            weekStart={weekStart}
            today={today}
            employees={employees.data?.items ?? []}
            shifts={shifts.data ?? []}
            jobRoles={jobRoles.data ?? []}
            conflicts={conflictMap(conflicts.data?.conflicts)}
            onAdd={(cell) => setSheet({ shift: null, initial: cell })}
            onMove={(move) => moveShift.mutate(move)}
            onEdit={(shift) =>
              setSheet({ shift, initial: { date: shift.date, employeeId: shift.employeeId } })
            }
          />
        </>
      )}

      {sheet ? (
        <ShiftSheetDialog
          key={sheet.shift?.id ?? `${sheet.initial.date}:${sheet.initial.employeeId ?? 'open'}`}
          orgId={orgId}
          scheduleId={schedule?.id ?? ''}
          weekStart={weekStart}
          employees={employees.data?.items ?? []}
          jobRoles={jobRoles.data ?? []}
          shift={sheet.shift}
          initial={sheet.initial}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}

/** Previous / next / jump-to-week. The calendar picks any date and snaps to its Monday. */
function WeekNav({
  weekStart,
  today,
  onChange,
}: {
  weekStart: LocalDate;
  today: LocalDate;
  onChange: (weekStart: LocalDate) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        aria-label="Previous week"
        onClick={() => onChange(addDays(weekStart, -7))}
      >
        <ChevronLeft />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-44 justify-start gap-2 font-medium">
            <CalendarDays />
            {weekLabel(weekStart)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={enGB}
            selected={toCalendarDate(weekStart)}
            onSelect={(date) => date && onChange(startOfWeek(fromCalendarDate(date)))}
          />
          {weekStart !== startOfWeek(today) ? (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => onChange(startOfWeek(today))}
              >
                Back to this week
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      <Button
        variant="outline"
        size="icon"
        aria-label="Next week"
        onClick={() => onChange(addDays(weekStart, 7))}
      >
        <ChevronRight />
      </Button>
      {weekStart !== startOfWeek(today) ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(startOfWeek(today))}>
          Today
        </Button>
      ) : null}
    </div>
  );
}

/** Radix sheet wrapper: the form inside owns its own footer and scrolling. */
function ShiftSheetDialog(props: React.ComponentProps<typeof ShiftSheet>) {
  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <ShiftSheet {...props} />
      </SheetContent>
    </Sheet>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading the week">
      <Skeleton className="h-5 w-40" />
      <div className="rounded-xl border">
        <Skeleton className="h-11 w-full rounded-b-none" />
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-none border-t" />
        ))}
      </div>
    </div>
  );
}
