import type { ShiftRequestStatusValue, ShiftRequestView } from '@shiftora/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { shiftRequestsApi } from '@/lib/api';

const STATUS: Record<ShiftRequestStatusValue, { label: string; tone: string }> = {
  pending_colleague: { label: 'Waiting on a colleague', tone: 'bg-amber-100 text-amber-900' },
  pending_manager: { label: 'Waiting on a manager', tone: 'bg-sky-100 text-sky-900' },
  approved: { label: 'Approved', tone: 'bg-emerald-100 text-emerald-900' },
  rejected: { label: 'Rejected', tone: 'bg-rose-100 text-rose-900' },
  declined: { label: 'Declined', tone: 'bg-zinc-100 text-zinc-800' },
  cancelled: { label: 'Withdrawn', tone: 'bg-zinc-100 text-zinc-800' },
  expired: { label: 'Expired', tone: 'bg-zinc-100 text-zinc-800' },
};

/**
 * Requests in both directions (W5 D5): the ones waiting on this person's answer, and the ones
 * they asked for. The buttons come from the server (`actions`), so the UI cannot offer a move the
 * state machine would refuse.
 */
export function MyRequestsSection({
  orgId,
  requests,
}: {
  orgId: string;
  requests: ShiftRequestView[];
}) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['me-requests', orgId] });
    void queryClient.invalidateQueries({ queryKey: ['me-shifts', orgId] });
  };

  const act = useMutation({
    mutationFn: ({ action, id }: { action: 'accept' | 'decline' | 'cancel'; id: string }) => {
      if (action === 'accept') return shiftRequestsApi.accept(orgId, id);
      if (action === 'decline') return shiftRequestsApi.decline(orgId, id);
      return shiftRequestsApi.cancel(orgId, id);
    },
    onSuccess: (_view, variables) => {
      toast.success(
        variables.action === 'accept'
          ? 'You said yes. A manager decides next.'
          : variables.action === 'decline'
            ? 'Declined.'
            : 'Withdrawn.',
      );
      refresh();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'That did not work. Try again.');
      refresh();
    },
  });

  const waitingOnMe = requests.filter((request) => request.actions.includes('colleague_accept'));
  const mine = requests.filter((request) => !request.actions.includes('colleague_accept'));

  if (requests.length === 0) return null;

  return (
    <div className="mb-6 space-y-6">
      {waitingOnMe.length > 0 && (
        <section aria-labelledby="waiting-on-you">
          <h2
            id="waiting-on-you"
            className="mb-2 text-xs font-semibold tracking-wide text-primary uppercase"
          >
            Waiting on you
          </h2>
          <ul className="space-y-2">
            {waitingOnMe.map((request) => (
              <li key={request.id} className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                <p className="text-sm font-medium">
                  {request.requester.name} wants you to take{' '}
                  {request.type === 'swap' ? 'their shift' : 'a shift'}
                </p>
                <RequestLine request={request} />
                <div className="mt-3 flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ action: 'accept', id: request.id })}
                  >
                    Yes, I will take it
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ action: 'decline', id: request.id })}
                  >
                    No
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mine.length > 0 && (
        <section aria-labelledby="your-requests">
          <h2
            id="your-requests"
            className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Your requests
          </h2>
          <ul className="space-y-2">
            {mine.map((request) => (
              <li key={request.id} className="rounded-xl border bg-background p-4">
                <div className="flex items-center gap-2">
                  {request.type === 'swap' ? (
                    <ArrowLeftRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <LogOut className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <p className="text-sm font-medium">
                    {request.type === 'swap'
                      ? `Swap with ${request.colleague?.name ?? 'a colleague'}`
                      : 'Give this shift up'}
                  </p>
                  <Badge className={`ml-auto border-0 ${STATUS[request.status].tone}`}>
                    {STATUS[request.status].label}
                  </Badge>
                </div>
                <RequestLine request={request} />
                {request.decisionNote && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Manager: “{request.decisionNote}”
                  </p>
                )}
                {request.actions.includes('cancel') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ action: 'cancel', id: request.id })}
                  >
                    Withdraw
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RequestLine({ request }: { request: ShiftRequestView }) {
  return (
    <p className="mt-1 text-sm text-muted-foreground">
      {request.shift.date} · {request.shift.startTime}–{request.shift.endTime} ·{' '}
      {request.shift.locationName}
      {request.note ? ` · “${request.note}”` : ''}
    </p>
  );
}
