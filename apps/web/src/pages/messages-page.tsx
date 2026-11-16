import type { DeadLetter, MessageUsage } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Mail, MessageCircle, RotateCw, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

import { ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { messagesApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useOrg } from '@/lib/org-context';
import { cn } from '@/lib/utils';

const channelLabel: Record<DeadLetter['channel'], string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  push: 'Push',
};
const channelIcon = { whatsapp: MessageCircle, sms: Smartphone, email: Mail, push: Bell };

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Owner-only: what the message queue gave up on, a Replay for each, and this month's paid
 * messages against the quota. Failures are normally invisible to staff because the message falls
 * back to email — this page is where the owner sees that it happened and why.
 */
export function MessagesPage() {
  const { orgId, role } = useOrg();
  const isOwner = role === 'owner';
  const usage = useQuery({
    queryKey: ['messages', 'usage', orgId],
    queryFn: () => messagesApi.usage(orgId),
    enabled: isOwner,
  });
  const deadLetters = useQuery({
    queryKey: ['messages', 'dead-letters', orgId],
    queryFn: () => messagesApi.deadLetters(orgId),
    enabled: isOwner,
  });

  if (!isOwner) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Owners only</EmptyTitle>
          <EmptyDescription>
            Message delivery and the paid quota are visible to owners.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <PageHeader
        title="Messages"
        description="Paid messages used this month, and anything that could not be delivered."
      />

      <section aria-labelledby="usage-heading" className="space-y-3">
        <h2 id="usage-heading" className="sr-only">
          Usage this month
        </h2>
        {usage.isError ? (
          <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
        ) : usage.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : (
          <UsageCards usage={usage.data} />
        )}
      </section>

      <section aria-labelledby="dead-heading" className="space-y-3">
        <div className="space-y-1">
          <h2 id="dead-heading" className="text-lg font-semibold tracking-tight">
            Could not be delivered
          </h2>
          <p className="text-sm text-muted-foreground">
            Each failed every retry. Most already reached the person another way.
          </p>
        </div>
        {deadLetters.isError ? (
          <ErrorState error={deadLetters.error} onRetry={() => void deadLetters.refetch()} />
        ) : deadLetters.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : deadLetters.data.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-success/10 text-success">
                <CheckCircle2 />
              </EmptyMedia>
              <EmptyTitle>Nothing stuck</EmptyTitle>
              <EmptyDescription>
                Every message reached someone, or is still on its way.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <DeadLetterTable rows={deadLetters.data} />
        )}
      </section>
    </>
  );
}

function UsageCards({ usage }: { usage: MessageUsage }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {usage.channels.map((item) => {
        const share = item.limit > 0 ? item.used / item.limit : 0;
        const Icon = channelIcon[item.channel];
        return (
          <Card key={item.channel}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {channelLabel[item.channel]}
              </CardTitle>
              <CardDescription className="tabular">
                {item.used.toLocaleString('en-IN')} of {item.limit.toLocaleString('en-IN')} this
                month
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                role="meter"
                aria-label={`${channelLabel[item.channel]} used this month`}
                aria-valuemin={0}
                aria-valuemax={item.limit}
                aria-valuenow={item.used}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn(
                    'h-full rounded-full transition-[width]',
                    share >= 1 ? 'bg-destructive' : share >= 0.8 ? 'bg-warning' : 'bg-primary',
                  )}
                  style={{ width: `${Math.min(share, 1) * 100}%` }}
                />
              </div>
              {share >= 1 ? (
                <p className="mt-2 text-xs text-destructive">
                  Used up: messages go by email and push until next month.
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DeadLetterTable({ rows }: { rows: DeadLetter[] }) {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const replay = useMutation({
    mutationFn: (id: string) => messagesApi.replay(orgId, id),
    onSuccess: () => {
      toast.success('Queued again', { description: 'It will be sent in the next few seconds.' });
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not replay it'),
  });

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>For</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead className="hidden md:table-cell">Why</TableHead>
            <TableHead className="hidden sm:table-cell">Instead</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const replaying = replay.isPending && replay.variables === row.id;
            return (
              <TableRow key={row.id}>
                <TableCell className="min-w-44 whitespace-normal">
                  <div className="font-medium">{row.recipient}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.subject} · {when.format(new Date(row.deadLetteredAt))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{channelLabel[row.channel]}</Badge>
                  {row.address ? (
                    <div className="tabular mt-1 text-xs text-muted-foreground">{row.address}</div>
                  ) : null}
                </TableCell>
                <TableCell className="hidden max-w-72 whitespace-normal md:table-cell">
                  <div className="text-sm">{row.reason ?? 'Unknown error'}</div>
                  <div className="tabular text-xs text-muted-foreground">
                    {row.attempts} attempts{row.replays > 0 ? ` · replayed ${row.replays}×` : ''}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {row.fallback ? (
                    <Badge variant={row.fallback.status === 'sent' ? 'secondary' : 'outline'}>
                      {channelLabel[row.fallback.channel]}: {row.fallback.status}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Nowhere else to send</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={replay.isPending}
                    onClick={() => replay.mutate(row.id)}
                    aria-label={`Replay the ${channelLabel[row.channel]} message to ${row.recipient}`}
                  >
                    {replaying ? <Spinner /> : <RotateCw />}
                    Replay
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
