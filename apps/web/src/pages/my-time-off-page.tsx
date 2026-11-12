import type { TimeOff } from '@shiftora/shared';
import { useQuery } from '@tanstack/react-query';
import { Plane } from 'lucide-react';

import { ErrorState } from '@/components/page';
import { Skeleton } from '@/components/ui/skeleton';
import { meApi } from '@/lib/api';
import { useOrg } from '@/lib/org-context';

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Wed 18 Nov, 09:00 → Fri 20 Nov, 18:30" in the device's own clock. */
function range(item: TimeOff): string {
  return `${DATE_TIME.format(new Date(item.startsAt))} → ${DATE_TIME.format(new Date(item.endsAt))}`;
}

/**
 * The dates a person has told their manager they cannot work. Read-only for now: asking for
 * time off from the phone arrives with the requests flow (week 5), and a half-built request
 * form would be worse than none.
 */
export function MyTimeOffPage() {
  const { orgId } = useOrg();
  const me = useQuery({ queryKey: ['me', orgId], queryFn: () => meApi.get(orgId) });
  const linked = me.data?.profile != null;
  const timeOff = useQuery({
    queryKey: ['me-time-off', orgId],
    // The moment of the fetch travels with the rows: "upcoming" is decided against that, not
    // against a clock read during render (which would make the component impure).
    queryFn: async () => ({ at: Date.now(), items: await meApi.timeOff(orgId) }),
    enabled: linked,
  });

  if (me.isPending || (linked && timeOff.isPending)) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  if (timeOff.isError) {
    return <ErrorState error={timeOff.error} onRetry={() => void timeOff.refetch()} />;
  }

  const now = timeOff.data?.at ?? 0;
  const items = [...(timeOff.data?.items ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const upcoming = items.filter((item) => Date.parse(item.endsAt) >= now);
  const past = items.filter((item) => Date.parse(item.endsAt) < now);

  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Time off</h1>
        <p className="text-sm text-muted-foreground">
          Dates you have told your manager you cannot work.
        </p>
      </header>

      {items.length === 0 ? (
        <section className="rounded-xl border bg-background p-8 text-center">
          <Plane className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold">Nothing booked</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {linked
              ? 'When you book time off, it appears here and your manager knows not to schedule you.'
              : 'Your login is not linked to a staff profile yet, so there is nothing to show.'}
          </p>
        </section>
      ) : (
        <div className="space-y-5">
          <Section title="Upcoming" items={upcoming} emptyText="Nothing coming up." />
          {past.length > 0 ? <Section title="Past" items={past} muted /> : null}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  items,
  emptyText,
  muted = false,
}: {
  title: string;
  items: TimeOff[];
  emptyText?: string;
  muted?: boolean;
}) {
  return (
    <section aria-labelledby={`time-off-${title}`}>
      <h2
        id={`time-off-${title}`}
        className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded-xl border bg-background p-4 ${muted ? 'opacity-70' : ''}`}
            >
              <p className="text-sm font-medium">{range(item)}</p>
              {item.reason ? (
                <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
