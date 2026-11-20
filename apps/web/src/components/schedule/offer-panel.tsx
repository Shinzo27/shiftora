import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Megaphone, UserX } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { openShiftsApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';

/**
 * Offering an open shift (W7½ UI2): who at the branch could take it, eligible first, with the
 * server's reasons for everyone else — then one button that tells the eligible people, and only
 * them, through their usual channel. The first one to claim it in their app gets it.
 */
export function OfferPanel({ orgId, shiftId }: { orgId: string; shiftId: string }) {
  const candidates = useQuery({
    queryKey: ['shift-candidates', orgId, shiftId],
    queryFn: () => openShiftsApi.candidates(orgId, shiftId),
  });
  const offer = useMutation({
    mutationFn: () => openShiftsApi.offer(orgId, shiftId),
    onSuccess: (result) =>
      result.offeredTo > 0
        ? toast.success(
            `Offered to ${result.offeredTo} ${result.offeredTo === 1 ? 'person' : 'people'}`,
            { description: 'The first to claim it in their app gets it.' },
          )
        : toast.warning('Nobody can take it as things stand', {
            description: 'See the reasons beside each name.',
          }),
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not offer it'),
  });

  const people = candidates.data?.candidates ?? [];
  const eligible = people.filter((person) => person.eligible).length;

  return (
    <section aria-labelledby="offer-heading" className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="offer-heading" className="text-sm font-medium">
            Offer to staff
          </h3>
          <p className="text-xs text-muted-foreground">
            {candidates.isPending
              ? 'Checking who could take it…'
              : `${eligible} of ${people.length} could take it`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={candidates.isPending || eligible === 0 || offer.isPending}
          onClick={() => offer.mutate()}
        >
          {offer.isPending ? <Spinner /> : <Megaphone />}
          Offer to {eligible} {eligible === 1 ? 'person' : 'people'}
        </Button>
      </div>

      {candidates.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(candidates.error) ?? 'Could not check who could take it.'}
        </p>
      ) : candidates.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody works at this branch yet.</p>
      ) : (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-sm">
          {people.map((person) => (
            <li key={person.employeeId} className="flex gap-2 px-3 py-2">
              {person.eligible ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <UserX
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0">
                <p className={person.eligible ? 'font-medium' : 'text-muted-foreground'}>
                  {person.name}
                  <span className="sr-only">{person.eligible ? ', can take it' : ', cannot'}</span>
                </p>
                {person.reasons.length > 0 ? (
                  <p className="text-xs text-muted-foreground">{person.reasons.join(' · ')}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
