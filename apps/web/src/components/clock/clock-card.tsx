import type { LocalDate } from '@shiftora/domain';
import type { MyProfile, MyShift, TimeEntry } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, LogIn, LogOut, MapPin, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { attendanceApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/forms';
import { currentFix, GeolocationError, isPoorAccuracy, type Fix } from '@/lib/geolocation';
import { compactDuration } from '@/lib/week';

/** Where the clock-in is happening: the shift's location, or the first one on the profile. */
function clockLocation(profile: MyProfile, shift: MyShift | undefined) {
  if (shift) return { id: shift.locationId, name: shift.locationName };
  return profile.locations[0] ?? null;
}

type Status = 'idle' | 'locating' | 'confirm' | 'saving';

/**
 * The punch card: one button, and whatever stops it working explained in place.
 *
 * Location is asked for **on tap**, not on load — a prompt that appears the moment the page opens
 * gets refused, and a refusal is remembered by the browser. If the phone admits it is unsure
 * (±100 m), the punch is not sent on a guess: the card asks first, because the manager will see
 * the flag either way.
 */
export function ClockCard({
  orgId,
  today,
  shift,
  profile,
}: {
  orgId: string;
  today: LocalDate;
  /** Today's shift, if there is one: it names the location and rides along on the punch. */
  shift: MyShift | undefined;
  profile: MyProfile;
}) {
  const queryClient = useQueryClient();
  const location = clockLocation(profile, shift);

  const entries = useQuery({
    queryKey: ['me-time-entries', orgId, today],
    queryFn: () => attendanceApi.entries(orgId, today, today),
  });

  const open: TimeEntry | undefined = entries.data?.items.find((entry) => !entry.clockOutAt);

  const [status, setStatus] = useState<Status>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingFix, setPendingFix] = useState<Fix | null>(null);
  const [flagged, setFlagged] = useState<string[] | null>(null);
  // Elapsed minutes, keyed by punch so a stale timer can never label a new shift.
  const [elapsed, setElapsed] = useState<{ id: string; minutes: number } | null>(null);

  // One key per punch: retrying the same intent must not create a second row.
  const key = useRef(newKey());

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['me-time-entries', orgId] });
  };

  const mapError = (error: unknown): string => {
    if (error instanceof GeolocationError) return error.message;
    if (error instanceof ApiError) return error.message;
    return errorMessage(error) ?? 'Something went wrong — try again.';
  };

  const clockIn = useMutation({
    mutationFn: (fix: Fix) => {
      if (!location) throw new Error('No branch to clock in at.');
      return attendanceApi.clockIn(
        orgId,
        {
          locationId: location.id,
          shiftId: shift?.id ?? null,
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyM: Math.round(fix.accuracyM),
        },
        key.current,
      );
    },
    onSuccess: ({ entry }) => {
      setStatus('idle');
      setFailure(null);
      setPendingFix(null);
      key.current = newKey();
      setFlagged(entry.flags.length > 0 ? entry.flags : null);
      refresh();
      toast.success(`Clocked in at ${entry.clockInTime}`);
    },
    onError: (error) => {
      setStatus('idle');
      setPendingFix(null);
      setFailure(mapError(error));
    },
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      // The clock-out may carry a position too; if the phone cannot give one, the punch still
      // closes (the API accepts it without coordinates).
      const fix = await currentFix().catch(() => null);
      return attendanceApi.clockOut(
        orgId,
        fix
          ? {
              latitude: fix.latitude,
              longitude: fix.longitude,
              accuracyM: Math.round(fix.accuracyM),
            }
          : {},
      );
    },
    onSuccess: ({ entry }) => {
      setStatus('idle');
      setFailure(null);
      setFlagged(entry.flags.length > 0 ? entry.flags : null);
      refresh();
      toast.success(`Clocked out — ${compactDuration(entry.minutes)} today`);
    },
    onError: (error) => {
      setStatus('idle');
      setFailure(mapError(error));
    },
  });

  async function startClockIn() {
    if (!location) return;
    setFailure(null);
    setFlagged(null);
    setStatus('locating');
    try {
      const fix = await currentFix();
      if (isPoorAccuracy(fix)) {
        setPendingFix(fix);
        setStatus('confirm');
        return;
      }
      setStatus('saving');
      clockIn.mutate(fix);
    } catch (error) {
      setStatus('idle');
      setFailure(mapError(error));
    }
  }

  function startClockOut() {
    setFailure(null);
    setFlagged(null);
    setStatus('saving');
    clockOut.mutate();
  }

  // The elapsed time is state written by a timer, never read from the clock during render. The
  // first render uses the server's own count; a tick corrects it within half a minute.
  useEffect(() => {
    if (!open) return;
    const punchId = open.id;
    const startedAt = Date.parse(open.clockInAt);
    const id = window.setInterval(() => {
      setElapsed({
        id: punchId,
        minutes: Math.max(0, Math.floor((Date.now() - startedAt) / 60_000)),
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  if (entries.isPending) return <Skeleton className="h-36 w-full rounded-xl" />;
  if (entries.isError) {
    return (
      <section className="rounded-xl border bg-background p-4">
        <p className="text-sm text-destructive">{errorMessage(entries.error)}</p>
        <Button variant="outline" className="mt-3" onClick={() => void entries.refetch()}>
          Try again
        </Button>
      </section>
    );
  }

  if (!location) {
    return (
      <section className="rounded-xl border bg-background p-4">
        <h2 className="text-sm font-semibold">No location yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask your manager to add you to a branch before you can clock in.
        </p>
      </section>
    );
  }

  const busy = status === 'locating' || status === 'saving';

  return (
    <section
      aria-labelledby="clock-heading"
      className={`rounded-xl border p-4 ${open ? 'border-primary/40 bg-primary/5' : 'bg-background'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="clock-heading" className="text-base font-semibold">
            {open ? 'On the clock' : 'Clock in'}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{location.name}</span>
            {shift ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {shift.startTime}–{shift.endTime}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {open ? (
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">
              {/* Zero minutes reads like a bug; a punch that just landed says so. */}
              {(() => {
                const minutes = elapsed?.id === open.id ? elapsed.minutes : open.minutes;
                return minutes < 1 ? 'just now' : compactDuration(minutes);
              })()}
            </p>
            <p className="text-xs text-muted-foreground">since {open.clockInTime}</p>
          </div>
        ) : (
          <Clock className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      {open ? (
        <Button
          className="mt-4 h-12 w-full"
          variant="outline"
          onClick={startClockOut}
          disabled={busy}
        >
          {busy ? <Spinner /> : <LogOut />} Clock out
        </Button>
      ) : status === 'confirm' ? (
        <div className="mt-4 space-y-2">
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Your phone is only accurate to about ±{Math.round(pendingFix?.accuracyM ?? 0)} m. Clock
            in anyway? Your manager will see the flag.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1"
              onClick={() => {
                setPendingFix(null);
                setStatus('idle');
              }}
            >
              Try again
            </Button>
            <Button
              className="h-11 flex-1"
              onClick={() => {
                if (!pendingFix) return;
                setStatus('saving');
                clockIn.mutate(pendingFix);
              }}
            >
              Clock in anyway
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-4 h-12 w-full" onClick={() => void startClockIn()} disabled={busy}>
          {busy ? <Spinner /> : <LogIn />}
          {status === 'locating' ? 'Finding you…' : 'Clock in'}
        </Button>
      )}

      {/* Status and errors are announced, not just drawn. */}
      <div role="status" aria-live="polite" className="mt-3 empty:mt-0">
        {failure ? <p className="text-sm text-destructive">{failure}</p> : null}
        {!failure && flagged ? (
          <p className="text-xs text-muted-foreground">
            {flagged.includes('outside_geofence')
              ? 'Recorded outside the branch radius — your manager can see this.'
              : flagged.includes('low_accuracy')
                ? 'Recorded with a low-accuracy position.'
                : 'Recorded with your phone clock far from ours — your manager can see this.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A UUID for `Idempotency-Key`. `crypto.randomUUID` needs a secure context — the same
 * requirement as geolocation, so a page that can clock in at all has it.
 */
function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
