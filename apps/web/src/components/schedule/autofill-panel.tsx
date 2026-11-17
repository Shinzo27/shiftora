import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { autofillApi } from '@/lib/api';

/**
 * "Fill this week from the coverage I set up" (W7 D3).
 *
 * The run is a job: this asks for it, then watches the row until the worker finishes. Progress
 * also arrives over the socket, but polling is what makes the panel honest on a connection that
 * drops — and the run is the record either way.
 */
export function AutofillPanel({ orgId, scheduleId }: { orgId: string; scheduleId: string }) {
  const queryClient = useQueryClient();

  const run = useQuery({
    queryKey: ['autofill', orgId, scheduleId],
    queryFn: () => autofillApi.latest(orgId, scheduleId),
    // Only while something is happening: a finished run does not need asking about.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 1_500 : false;
    },
  });

  const start = useMutation({
    mutationFn: () => autofillApi.start(orgId, scheduleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['autofill', orgId, scheduleId] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not start the fill.');
    },
  });

  const latest = run.data ?? null;
  const working = latest?.status === 'queued' || latest?.status === 'running';

  return (
    <div className="mt-3 rounded-xl border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={working || start.isPending}
          onClick={() => start.mutate()}
        >
          <Sparkles className="mr-2 size-4" aria-hidden="true" />
          {working ? 'Filling…' : 'Fill from coverage'}
        </Button>
        {latest ? (
          <span className="text-xs text-muted-foreground">
            {latest.status === 'queued' ? 'Queued for the scheduler' : null}
            {latest.status === 'running' ? 'Working out the week…' : null}
            {latest.status === 'failed' ? `Failed: ${latest.error ?? 'unknown error'}` : null}
            {latest.status === 'succeeded' ? (
              <>
                Filled <span className="font-medium text-foreground">{latest.assigned}</span>
                {latest.assigned === 1 ? ' shift' : ' shifts'}
                {latest.strategy ? ` · ${latest.strategy}` : ''}
                {latest.score ? ` · ${(latest.score.costMinor / 100).toFixed(0)} projected` : ''}
              </>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Uses this branch’s coverage rules. Nothing is published.
          </span>
        )}
        {latest && latest.unfilled.length > 0 ? (
          <Badge variant="outline" className="border-warning/50 text-warning">
            {latest.unfilled.length} could not be filled
          </Badge>
        ) : null}
      </div>

      {latest && latest.unfilled.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {latest.unfilled.slice(0, 6).map((slot) => (
            <li key={slot.id}>{slot.explanation}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
