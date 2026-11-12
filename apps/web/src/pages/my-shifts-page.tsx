import { addDays, type LocalDate } from '@shiftora/domain';
import type { MyShift } from '@shiftora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock, Info, MapPin, Moon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DefinitionRow } from '@/components/definition-row';
import { ErrorState } from '@/components/page';
import {
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { api, meApi } from '@/lib/api';
import { useOrg } from '@/lib/org-context';
import { connectRealtime } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { compactDuration, dayHeading, todayLocalDate } from '@/lib/week';

/** A week back for context, four weeks ahead — enough for "when am I working?" in one request. */
const DAYS_BACK = 7;
const DAYS_AHEAD = 28;

/**
 * The one thing staff open the app for: when am I working next?
 *
 * Grouped by day with the next shift first, each card answerable at a glance (start, end,
 * where, what role) and tappable for the rest (break, notes, hours). It listens to the same
 * realtime channel as the manager board, so a manager publishing or moving a shift updates a
 * phone that is already open.
 */
export function MyShiftsPage() {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const today = todayLocalDate();
  const from = addDays(today, -DAYS_BACK);
  const to = addDays(today, DAYS_AHEAD);

  const me = useQuery({ queryKey: ['me', orgId], queryFn: () => meApi.get(orgId) });
  const linked = me.data?.profile != null;
  const shifts = useQuery({
    queryKey: ['me-shifts', orgId, from, to],
    queryFn: () => meApi.shifts(orgId, from, to),
    enabled: linked,
  });

  // Someone else's write could be one of my shifts: refetch, and let the cache decide.
  useEffect(() => {
    const token = api.token;
    if (!token) return;
    return connectRealtime(token, () => {
      void queryClient.invalidateQueries({ queryKey: ['me-shifts', orgId] });
    });
  }, [orgId, queryClient]);

  const [selected, setSelected] = useState<MyShift | null>(null);
  const items = useMemo(() => shifts.data?.items ?? [], [shifts.data]);

  const groups = useMemo(() => {
    const byDate = new Map<LocalDate, MyShift[]>();
    for (const shift of items) {
      const list = byDate.get(shift.date);
      if (list) list.push(shift);
      else byDate.set(shift.date, [shift]);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const nextSeven = items.filter((shift) => shift.date >= today && shift.date <= addDays(today, 7));
  const nextSevenMinutes = nextSeven.reduce((total, shift) => total + shift.paidMinutes, 0);

  if (me.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;

  if (!linked) {
    return (
      <section className="rounded-xl border bg-background p-5 text-center">
        <Info className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-base font-semibold">You are not on the rota yet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This login is not linked to a staff profile, so there are no shifts to show. Ask your
          manager to add you to the team with this email address.
        </p>
      </section>
    );
  }

  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Hi, {me.data.profile?.name.split(' ')[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {nextSeven.length === 0
            ? 'No shifts in the next seven days.'
            : `${nextSeven.length} ${nextSeven.length === 1 ? 'shift' : 'shifts'} in the next 7 days · ${compactDuration(nextSevenMinutes)}`}
        </p>
      </header>

      {shifts.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : shifts.isError ? (
        <ErrorState error={shifts.error} onRetry={() => void shifts.refetch()} />
      ) : groups.length === 0 ? (
        <section className="rounded-xl border bg-background p-8 text-center">
          <CalendarDays className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold">Nothing scheduled</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Shifts appear here as soon as your manager publishes the week.
          </p>
        </section>
      ) : (
        <div className="space-y-5">
          {groups.map(([date, dayShifts]) => (
            <section key={date} aria-labelledby={`day-${date}`}>
              <h2
                id={`day-${date}`}
                className={cn(
                  'mb-2 text-xs font-semibold tracking-wide uppercase',
                  date === today ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {dayHeading(date, today)}
              </h2>
              <ul className="space-y-2">
                {dayShifts.map((shift) => (
                  <li key={shift.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(shift)}
                      className={cn(
                        'w-full rounded-xl border bg-background p-4 text-left transition-shadow active:scale-[0.995]',
                        date === today && 'border-primary/40 ring-1 ring-primary/20',
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-lg font-semibold tabular-nums">
                          {shift.startTime}–{shift.endTime}
                        </p>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {compactDuration(shift.paidMinutes)}
                        </span>
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{shift.locationName}</span>
                        {shift.jobRoleName ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{shift.jobRoleName}</span>
                          </>
                        ) : null}
                      </p>
                      {shift.notes ? (
                        <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                          {shift.notes}
                        </p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <ShiftDrawer shift={selected} onClose={() => setSelected(null)} today={today} />
    </>
  );
}

function ShiftDrawer({
  shift,
  onClose,
  today,
}: {
  shift: MyShift | null;
  onClose: () => void;
  today: LocalDate;
}) {
  const overnight = shift ? shift.endTime <= shift.startTime : false;
  return (
    <Drawer open={shift !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        {shift ? (
          <>
            <DrawerCloseButton />
            <DrawerHeader>
              <DrawerTitle>{dayHeading(shift.date, today)}</DrawerTitle>
              <DrawerDescription>
                {shift.startTime}–{shift.endTime} · {compactDuration(shift.paidMinutes)} paid
                {overnight ? ' · overnight' : ''}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <dl className="divide-y text-sm">
                <DefinitionRow icon={<MapPin className="size-4" />} label="Where">
                  {shift.locationName}
                </DefinitionRow>
                <DefinitionRow icon={<Clock className="size-4" />} label="Break">
                  {shift.breakMinutes === 0 ? 'None' : `${shift.breakMinutes} minutes`}
                </DefinitionRow>
                <DefinitionRow icon={<CalendarDays className="size-4" />} label="Role">
                  {shift.jobRoleName ?? 'No particular role'}
                </DefinitionRow>
                {overnight ? (
                  <DefinitionRow icon={<Moon className="size-4" />} label="Ends next day">
                    Yes, past midnight
                  </DefinitionRow>
                ) : null}
                {shift.notes ? (
                  <div className="flex gap-2 py-3">
                    <dt className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <Info className="size-4" aria-hidden="true" />
                      Notes
                    </dt>
                    <dd className="ml-auto min-w-0 text-right font-medium whitespace-pre-line">
                      {shift.notes}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Clocking in from here arrives with attendance — your location is checked when you
                do.
              </p>
            </DrawerBody>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
