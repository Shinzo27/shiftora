import type { ShiftRequestView } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Inbox, LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { shiftRequestsApi } from '@/lib/api';
import { useOrg } from '@/lib/org-context';

/**
 * The manager's inbox for swaps and drops (W5 D5).
 *
 * Approving is the decision that actually moves shifts, so the API has already re-checked the
 * rota under a row lock by the time this button answers. That is why the button can be a button:
 * the refusals (overlap, hours, rest, a shift that moved) arrive as sentences to show, not as a
 * half-applied rota to fix by hand.
 */
export function RequestsPage() {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: ['requests', orgId],
    queryFn: () => shiftRequestsApi.inbox(orgId, 'open'),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      decision === 'approve'
        ? shiftRequestsApi.approve(orgId, id)
        : shiftRequestsApi.reject(orgId, id),
    onSuccess: (_view, variables) => {
      toast.success(
        variables.decision === 'approve' ? 'Approved. The rota is updated.' : 'Rejected.',
      );
      void queryClient.invalidateQueries({ queryKey: ['requests', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (error: unknown, variables) => {
      const needsAck =
        error instanceof ApiError && error.code === 'shift_request.needs_acknowledgement';
      toast.error(
        needsAck
          ? 'There is a warning on this swap. Review it in the rota, then approve from there.'
          : error instanceof ApiError
            ? error.message
            : 'That did not work.',
      );
      // A refusal of the decision means the inbox is out of date too.
      void queryClient.invalidateQueries({ queryKey: ['requests', orgId] });
      void variables;
    },
  });

  if (inbox.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  if (inbox.isError) return <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />;

  const requests = inbox.data;

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          {requests.length === 0
            ? 'Nothing is waiting on you.'
            : `${requests.length} ${requests.length === 1 ? 'request needs' : 'requests need'} a decision.`}
        </p>
      </header>

      {requests.length === 0 ? (
        <section className="rounded-xl border bg-background p-10 text-center">
          <Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold">All clear</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Swaps your team asks for land here, and so do shifts they cannot work.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              busy={decide.isPending && decide.variables?.id === request.id}
              onDecide={(decision) => decide.mutate({ id: request.id, decision })}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function RequestCard({
  request,
  busy,
  onDecide,
}: {
  request: ShiftRequestView;
  busy: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
}) {
  const Icon = request.type === 'swap' ? ArrowLeftRight : LogOut;

  return (
    <li className="rounded-xl border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-muted p-2">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {request.type === 'swap'
              ? `${request.requester.name} wants ${request.colleague?.name ?? 'a colleague'} to take this shift`
              : `${request.requester.name} cannot work this shift`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {request.shift.date} · {request.shift.startTime}–{request.shift.endTime} ·{' '}
            {request.shift.locationName}
            {request.shift.jobRoleName ? ` · ${request.shift.jobRoleName}` : ''}
          </p>
          {request.note && <p className="mt-1 text-sm text-muted-foreground">“{request.note}”</p>}
          {request.type === 'swap' && request.targetShift && (
            <p className="mt-1 text-xs text-muted-foreground">
              In return: {request.targetShift.date} · {request.targetShift.startTime}–
              {request.targetShift.endTime}
            </p>
          )}
          {request.status === 'pending_colleague' && (
            <Badge variant="outline" className="mt-2 font-normal">
              Waiting on the colleague
            </Badge>
          )}
        </div>
      </div>

      {request.actions.includes('manager_approve') && (
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => onDecide('approve')}>
            {busy ? 'Working…' : 'Approve'}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => onDecide('reject')}
          >
            Reject
          </Button>
        </div>
      )}
    </li>
  );
}
