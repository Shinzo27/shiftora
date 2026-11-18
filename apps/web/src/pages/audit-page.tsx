import { auditEntities, type AuditEventView } from '@shiftora/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowRight, History, ScrollText, X } from 'lucide-react';
import { useSearchParams } from 'react-router';

import { ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { auditApi } from '@/lib/api';
import {
  changesOf,
  describeAction,
  entityLabel,
  entityLabels,
  periods,
  periodStart,
  type Period,
} from '@/lib/audit';
import { useOrg } from '@/lib/org-context';

const ANY = 'any';
const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const isPeriod = (value: string | null): value is Period =>
  periods.some((period) => period.value === value);

/**
 * The audit log (W7 D4): every change in the organisation, newest first — who made it and what
 * it was before. Owners only. The filters live in the URL, so "history of this one shift" is a
 * link that can be shared or bookmarked.
 */
export function AuditPage() {
  const { orgId, role } = useOrg();
  const [params, setParams] = useSearchParams();
  const entity = params.get('entity') ?? ANY;
  const entityId = params.get('entityId');
  const actor = params.get('actor') ?? ANY;
  const requested = params.get('period');
  const period: Period = isPeriod(requested) ? requested : '30';
  const isOwner = role === 'owner';

  const update = (changes: Record<string, string | null>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === ANY) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  const members = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => auditApi.members(orgId),
    enabled: isOwner,
  });

  const log = useInfiniteQuery({
    queryKey: ['audit-events', orgId, entity, entityId, actor, period],
    queryFn: ({ pageParam }) => {
      // The start of the period is worked out here, not during render: "now" belongs to the fetch.
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const from = periodStart(period, new Date(), zone);
      return auditApi.list(orgId, {
        ...(entity !== ANY ? { entity } : {}),
        ...(entityId ? { entityId } : {}),
        ...(actor !== ANY ? { actorUserId: actor } : {}),
        ...(from ? { from } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
    },
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: isOwner,
  });

  if (!isOwner) {
    return (
      <>
        <PageHeader title="Audit log" />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle>Only owners can see the audit log</EmptyTitle>
            <EmptyDescription>
              Ask an owner of this organisation if you need a change traced.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  const events = log.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change in your organisation: who made it, when, and what it was before."
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <Select value={entity} onValueChange={(value) => update({ entity: value, entityId: null })}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Kind of change">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Everything</SelectItem>
            {auditEntities.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {entityLabels[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actor} onValueChange={(value) => update({ actor: value })}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Changed by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Anyone</SelectItem>
            {(members.data ?? []).map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(value) => update({ period: value })}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {entityId ? (
          <Badge variant="secondary" className="h-8 gap-1.5 pl-3 text-sm">
            <History aria-hidden />
            History of one {entity !== ANY ? entityLabel(entity).toLowerCase() : 'item'}
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Show everything again"
              onClick={() => update({ entityId: null })}
            >
              <X />
            </Button>
          </Badge>
        ) : null}
      </div>

      {log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : log.isPending ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : events.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle>No changes match</EmptyTitle>
            <EmptyDescription>Try a longer period, or another kind of change.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ol className="divide-y rounded-xl border bg-card" aria-label="Changes, newest first">
            {events.map((event) => (
              <AuditRow
                key={event.id}
                event={event}
                showHistory={!entityId}
                onHistory={() => update({ entity: event.entity, entityId: event.entityId })}
              />
            ))}
          </ol>
          {log.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void log.fetchNextPage()}
                disabled={log.isFetchingNextPage}
              >
                {log.isFetchingNextPage ? <Spinner /> : null}
                Load older changes
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function AuditRow({
  event,
  showHistory,
  onHistory,
}: {
  event: AuditEventView;
  showHistory: boolean;
  onHistory: () => void;
}) {
  const changes = changesOf(event.before, event.after);
  return (
    <li className="grid gap-2 p-4 lg:grid-cols-[11rem_1fr_auto] lg:gap-4">
      <time dateTime={event.at} className="tabular text-sm text-muted-foreground">
        {when.format(new Date(event.at))}
      </time>
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium">
          {describeAction(event.action)}
          <span className="font-normal text-muted-foreground">
            {' '}
            by {event.actor?.name ?? 'Shiftora (automatic)'}
          </span>
        </p>
        {changes.length > 0 ? (
          <ul className="space-y-0.5 text-sm">
            {changes.map((change) => (
              <li
                key={change.field}
                className="flex flex-wrap items-baseline gap-x-1.5 break-words"
              >
                <span className="text-muted-foreground">{change.field}:</span>
                {change.from !== undefined ? (
                  <span
                    className={change.to !== undefined ? 'text-muted-foreground line-through' : ''}
                  >
                    {change.from}
                  </span>
                ) : null}
                {change.from !== undefined && change.to !== undefined ? (
                  <ArrowRight
                    className="size-3 self-center text-muted-foreground"
                    aria-label="changed to"
                  />
                ) : null}
                {change.to !== undefined ? <span>{change.to}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {showHistory ? (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={onHistory}
          aria-label={`History of this ${entityLabel(event.entity).toLowerCase()}`}
        >
          <History />
          History
        </Button>
      ) : null}
    </li>
  );
}
