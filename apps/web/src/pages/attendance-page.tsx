import { addDays, startOfWeek, type LocalDate } from '@shiftora/domain';
import type { Attendance, AttendanceRow } from '@shiftora/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock, MapPin, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EditPunchSheet } from '@/components/attendance/edit-punch-sheet';
import { ExportButton, FlagQueue } from '@/components/attendance/flag-queue';
import { ErrorState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { attendanceApi } from '@/lib/api';
import { useOrg } from '@/lib/org-context';
import { compactDuration, readableDate, todayLocalDate, weekLabel } from '@/lib/week';

/**
 * What actually happened, next to what was planned.
 *
 * A manager's question on a Monday morning is "who turned up, and who didn't" — so this is a
 * list of punches by day, each one against the shift it belongs to, with the week's totals at
 * the bottom. Lateness and earliness are not stored anywhere: they are computed from the punch
 * and the shift on every read, which is why correcting a time will never leave a stale flag.
 */
export function AttendancePage() {
  const { orgId, locations, locationId, selectLocation } = useOrg();
  const [weekStart, setWeekStart] = useState<LocalDate>(() => startOfWeek(todayLocalDate()));
  const [editing, setEditing] = useState<string | null>(null);
  const from = weekStart;
  const to = addDays(weekStart, 6);
  const today = todayLocalDate();

  const attendance = useQuery({
    queryKey: ['attendance', orgId, locationId, from, to],
    queryFn: () => attendanceApi.list(orgId, locationId!, from, to),
    enabled: Boolean(locationId),
  });

  const groups = useMemo(() => groupByDate(attendance.data?.items ?? []), [attendance.data]);
  const location = locations.find((item) => item.id === locationId);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timesheets</h1>
          <p className="text-sm text-muted-foreground">
            {location ? (
              <>
                {location.name} · {weekLabel(weekStart)}
              </>
            ) : (
              'Choose a branch to see its punches.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {attendance.data ? (
            <ExportButton attendance={attendance.data} weekStart={weekStart} />
          ) : null}
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setWeekStart(startOfWeek(today))}>
            This week
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight />
          </Button>
        </div>
      </header>

      {!locationId ? (
        <section className="rounded-xl border bg-background p-8 text-center">
          <MapPin className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold">Which branch?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Punches belong to a location. Pick one to see the week.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {locations.map((item) => (
              <Button key={item.id} variant="outline" onClick={() => selectLocation(item.id)}>
                {item.name}
              </Button>
            ))}
          </div>
        </section>
      ) : attendance.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : attendance.isError ? (
        <ErrorState error={attendance.error} onRetry={() => void attendance.refetch()} />
      ) : groups.length === 0 ? (
        <section className="rounded-xl border bg-background p-8 text-center">
          <Clock className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold">No punches this week</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Staff clock in from their phone; nothing appears here until someone does.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          <FlagQueue orgId={orgId} locationId={locationId} from={from} to={to} />
          {groups.map(([date, rows]) => (
            <section key={date} aria-labelledby={`day-${date}`}>
              <h2
                id={`day-${date}`}
                className={`mb-2 text-xs font-semibold tracking-wide uppercase ${
                  date === today ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {readableDate(date)}
              </h2>
              <ul className="divide-y overflow-hidden rounded-xl border bg-background">
                {rows.map((row) => (
                  <PunchRow key={row.id} row={row} onEdit={() => setEditing(row.id)} />
                ))}
              </ul>
            </section>
          ))}

          <Totals totals={attendance.data.totals} />
        </div>
      )}

      {editing ? (
        <EditPunchSheet
          orgId={orgId}
          entryId={editing}
          timezone={location?.timezone ?? 'UTC'}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function PunchRow({ row, onEdit }: { row: AttendanceRow; onEdit: () => void }) {
  const badges = punchBadges(row);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      {/* Phones: the name gets its own line (it was cut to "Roh…"); wider screens: one row. */}
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <p className="truncate text-sm font-medium">{row.employeeName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {row.shift ? `rostered ${row.shift.startTime}–${row.shift.endTime}` : 'not rostered'}
          {row.edited ? ' · edited' : ''}
        </p>
      </div>

      <p className="text-sm tabular-nums">
        {row.clockInTime}
        {row.clockOutTime ? `–${row.clockOutTime}` : ' – …'}
      </p>

      <p className="w-16 text-right text-sm text-muted-foreground tabular-nums">
        {row.clockOutAt ? compactDuration(row.minutes) : 'open'}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {badges.map((badge) => (
          <Badge
            key={badge.label}
            variant={badge.tone === 'warning' ? 'outline' : 'secondary'}
            className={
              badge.tone === 'warning'
                ? 'border-warning/50 font-normal text-warning'
                : 'font-normal'
            }
          >
            {badge.label}
          </Badge>
        ))}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="ml-auto"
        aria-label={`Correct ${row.employeeName}'s punch`}
        onClick={onEdit}
      >
        <Pencil />
      </Button>
    </li>
  );
}

function Totals({ totals }: { totals: Attendance['totals'] }) {
  if (totals.length === 0) return null;
  return (
    <section aria-labelledby="totals-heading" className="rounded-xl border bg-background">
      <h2 id="totals-heading" className="border-b px-4 py-3 text-sm font-semibold">
        This week
      </h2>
      <ul className="divide-y">
        {totals.map((total) => {
          const difference = total.workedMinutes - total.plannedMinutes;
          return (
            <li
              key={total.employeeId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 basis-full truncate font-medium sm:basis-0 sm:flex-1">
                {total.employeeName}
              </span>
              <span className="tabular-nums">{compactDuration(total.workedMinutes)} worked</span>
              <span className="text-muted-foreground tabular-nums sm:w-24 sm:text-right">
                {total.plannedMinutes ? `${compactDuration(total.plannedMinutes)} rostered` : '—'}
              </span>
              <span
                className={`ml-auto text-right tabular-nums sm:ml-0 sm:w-16 ${
                  difference < 0 ? 'text-warning' : 'text-muted-foreground'
                }`}
              >
                {total.plannedMinutes ? signed(difference) : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface PunchBadge {
  label: string;
  tone: 'neutral' | 'warning';
}

/** What a manager needs to see without opening anything: lateness first, then the odd ones. */
function punchBadges(row: AttendanceRow): PunchBadge[] {
  const badges: PunchBadge[] = [];
  if (row.state === 'late') badges.push({ label: `${row.lateMinutes} min late`, tone: 'warning' });
  if (row.state === 'early')
    badges.push({ label: `${row.earlyMinutes} min early`, tone: 'neutral' });
  if (row.state === 'unscheduled') badges.push({ label: 'not rostered', tone: 'neutral' });
  if (row.flags.includes('outside_geofence')) badges.push({ label: 'off site', tone: 'warning' });
  if (row.flags.includes('low_accuracy')) badges.push({ label: 'weak GPS', tone: 'warning' });
  if (row.flags.includes('device_skew')) badges.push({ label: 'phone clock', tone: 'warning' });
  // The verdict matters more than the flag it answers: a disputed punch stays visible.
  if (row.review?.decision === 'disputed') badges.push({ label: 'disputed', tone: 'warning' });
  if (row.review?.decision === 'accepted') badges.push({ label: 'accepted', tone: 'neutral' });
  return badges;
}

function signed(minutes: number): string {
  if (minutes === 0) return '±0';
  return `${minutes > 0 ? '+' : '−'}${compactDuration(Math.abs(minutes))}`;
}

/** Punches grouped by the local date they happened on, oldest day first. */
function groupByDate(items: AttendanceRow[]): [LocalDate, AttendanceRow[]][] {
  const byDate = new Map<LocalDate, AttendanceRow[]>();
  for (const item of items) {
    const list = byDate.get(item.date);
    if (list) list.push(item);
    else byDate.set(item.date, [item]);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
}
