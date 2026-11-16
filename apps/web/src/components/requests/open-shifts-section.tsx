import type { OpenShift } from '@shiftora/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, MapPin } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { openShiftsApi } from '@/lib/api';

/**
 * Shifts nobody is on, which this person could take (W5 D5).
 *
 * Only offered shifts appear here — the server decides who sees what, and the list is already
 * filtered to shifts they are eligible for. Taking one is a claim: first tap wins, and the second
 * person is told the shift has gone rather than being quietly given a rota they cannot work.
 */
export function OpenShiftsSection({ orgId, shifts }: { orgId: string; shifts: OpenShift[] }) {
  const queryClient = useQueryClient();

  const claim = useMutation({
    // The key is generated per tap, not per render: a retry of *this* tap must reuse it, and a
    // second tap is a new request. TanStack passes the key through the variables.
    mutationFn: ({ id, key }: { id: string; key: string }) => openShiftsApi.claim(orgId, id, key),
    onSuccess: (result) => {
      toast.success(
        `You are on ${result.shift.date}, ${result.shift.startTime}–${result.shift.endTime}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['me-open-shifts', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['me-shifts', orgId] });
    },
    onError: (error: unknown) => {
      const taken = error instanceof ApiError && error.code === 'shift.already_taken';
      toast.error(taken ? 'Someone else took it just now.' : message(error));
      // Either way the list is stale: refetch so the shift disappears.
      void queryClient.invalidateQueries({ queryKey: ['me-open-shifts', orgId] });
    },
  });

  if (shifts.length === 0) return null;

  return (
    <section aria-labelledby="open-shifts" className="mb-6">
      <h2
        id="open-shifts"
        className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        <CalendarPlus className="size-3.5" aria-hidden="true" />
        Open shifts you can take
      </h2>
      <ul className="space-y-2">
        {shifts.map((shift) => (
          <li key={shift.id} className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-lg font-semibold tabular-nums">
                {shift.startTime}–{shift.endTime}
              </p>
              <span className="text-xs text-muted-foreground">{shift.date}</span>
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
            <Button
              className="mt-3 w-full"
              disabled={claim.isPending}
              onClick={() =>
                claim.mutate({
                  id: shift.id,
                  // crypto.randomUUID is the client's promise that this tap happens once.
                  key: `claim-${shift.id}-${crypto.randomUUID()}`,
                })
              }
            >
              {claim.isPending && claim.variables.id === shift.id
                ? 'Taking it…'
                : 'Take this shift'}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Could not take the shift. Try again.';
}
