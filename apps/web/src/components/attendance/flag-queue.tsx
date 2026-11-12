import type { Attendance, AttendanceRow } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Download, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { attendanceApi } from '@/lib/api';
import { downloadCsv, toCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/forms';
import { compactDuration, readableDate } from '@/lib/week';

/**
 * Flagged punches, one decision at a time.
 *
 * A count is not actionable — "12 flagged" tells a manager nothing and gets ignored. Each row
 * here says who, when, how far from the branch, and what the phone's clock claimed, so the
 * decision takes one glance. Accepting leaves the punch exactly as recorded; a dispute keeps it
 * too, with the reason, because the conversation afterwards is the point.
 */
export function FlagQueue({
  orgId,
  locationId,
  from,
  to,
}: {
  orgId: string;
  locationId: string;
  from: string;
  to: string;
}) {
  const queryClient = useQueryClient();
  const [disputing, setDisputing] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const flags = useQuery({
    queryKey: ['attendance-flags', orgId, locationId, from, to],
    queryFn: () => attendanceApi.flags(orgId, locationId, from, to),
  });

  const review = useMutation({
    mutationFn: (input: { id: string; decision: 'accepted' | 'disputed'; note?: string }) =>
      attendanceApi.review(orgId, input.id, {
        decision: input.decision,
        ...(input.note ? { note: input.note } : {}),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-flags', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['attendance', orgId] });
      setDisputing(null);
      setNote('');
      toast.success(
        result.entry.review?.decision === 'accepted'
          ? 'Punch accepted'
          : 'Punch disputed, with the reason on record',
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = flags.data?.items ?? [];
  if (flags.isError) {
    return (
      <section className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
        <p className="font-medium">Could not load the review queue</p>
        <p className="text-muted-foreground">{errorMessage(flags.error)}</p>
      </section>
    );
  }
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="queue-heading" className="rounded-xl border border-warning/40">
      <header className="flex items-center gap-2 border-b border-warning/30 bg-warning/5 px-4 py-3">
        <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
        <h2 id="queue-heading" className="text-sm font-semibold">
          Needs a look · {items.length}
        </h2>
        <p className="ml-auto text-xs text-muted-foreground">Flagged punches, not yet answered</p>
      </header>

      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id} className="p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm font-medium">{item.employeeName}</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {readableDate(item.date)} · {item.clockInTime}
                {item.clockOutTime ? `–${item.clockOutTime}` : ' – …'}
              </p>
              <FlagBadges row={item} />
            </div>

            {disputing === item.id ? (
              <div className="mt-3 space-y-2">
                <Textarea
                  aria-label="Why this punch is disputed"
                  rows={2}
                  autoFocus
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="He was at the Bandra branch that morning."
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={note.trim().length < 3 || review.isPending}
                    onClick={() =>
                      review.mutate({ id: item.id, decision: 'disputed', note: note.trim() })
                    }
                  >
                    Send dispute
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDisputing(null);
                      setNote('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ id: item.id, decision: 'accepted' })}
                >
                  <Check />
                  Accept
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDisputing(item.id)}>
                  <X />
                  Dispute
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FlagBadges({ row }: { row: AttendanceRow }) {
  const labels: Record<string, string> = {
    outside_geofence: row.distanceM === null ? 'off site' : `${row.distanceM} m away`,
    low_accuracy: row.accuracyM === null ? 'weak GPS' : `±${row.accuracyM} m`,
    device_skew: 'phone clock',
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {row.flags.map((flag) => (
        <Badge key={flag} variant="outline" className="border-warning/50 font-normal text-warning">
          {labels[flag] ?? flag}
        </Badge>
      ))}
    </div>
  );
}

/** The week as a file: what an accountant asks for, with nothing to explain. */
export function ExportButton({
  attendance,
  weekStart,
}: {
  attendance: Attendance;
  weekStart: string;
}) {
  const rows: (string | number | null)[][] = [
    [
      'Date',
      'Employee',
      'Branch',
      'Rostered start',
      'Rostered end',
      'Clock in',
      'Clock out',
      'Minutes',
      'State',
      'Late (min)',
      'Early (min)',
      'Flags',
      'Edited',
      'Review',
    ],
    ...attendance.items.map((item) => [
      item.date,
      item.employeeName,
      item.locationName,
      item.shift?.startTime ?? null,
      item.shift?.endTime ?? null,
      item.clockInTime,
      item.clockOutTime,
      item.minutes,
      item.state,
      item.lateMinutes,
      item.earlyMinutes,
      item.flags.join(' '),
      item.edited ? 'yes' : null,
      item.review?.decision ?? null,
    ]),
    [],
    ['Employee', 'Worked', 'Rostered', 'Difference'],
    ...attendance.totals.map((total) => [
      total.employeeName,
      compactDuration(total.workedMinutes),
      total.plannedMinutes ? compactDuration(total.plannedMinutes) : null,
      total.plannedMinutes
        ? `${total.workedMinutes - total.plannedMinutes >= 0 ? '+' : '-'}${compactDuration(
            Math.abs(total.workedMinutes - total.plannedMinutes),
          )}`
        : null,
    ]),
  ];

  return (
    <Button
      variant="outline"
      disabled={attendance.items.length === 0}
      onClick={() =>
        downloadCsv(`attendance-${attendance.locationName}-${weekStart}.csv`, toCsv(rows))
      }
    >
      <Download />
      Export CSV
    </Button>
  );
}
