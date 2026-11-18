import type { PayPeriodView } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, IndianRupee, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { PayRulesPanel } from '@/components/payroll/pay-rules-panel';
import { payrollApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useOrg } from '@/lib/org-context';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const dayLabel = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const range = (period: PayPeriodView) =>
  `${dayLabel.format(new Date(`${period.startsOn}T00:00:00Z`))} – ${dayLabel.format(
    new Date(`${period.endsOn}T00:00:00Z`),
  )}`;

/** Hands a downloaded file to the browser. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Payroll (W6): pay periods, what still blocks approving each one, the approval itself (owners),
 * and the files for the accountant. Managers set periods up and see what to review; the money is
 * the owner's.
 */
export function PayrollPage() {
  const { orgId, role } = useOrg();
  const isOwner = role === 'owner';
  const periods = useQuery({
    queryKey: ['pay-periods', orgId],
    queryFn: () => payrollApi.periods(orgId),
    // The worker is calculating: check back until the lines are in.
    refetchInterval: (query) =>
      query.state.data?.some((period) => period.status === 'calculating') ? 2_000 : false,
  });

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Pay periods, what still needs reviewing, and the files for your accountant."
      />
      <PayRulesPanel />
      <NewPeriod />
      <section aria-labelledby="periods-heading" className="space-y-3">
        <h2 id="periods-heading" className="text-lg font-semibold tracking-tight">
          Pay periods
        </h2>
        {periods.isError ? (
          <ErrorState error={periods.error} onRetry={() => void periods.refetch()} />
        ) : periods.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : periods.data.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IndianRupee />
              </EmptyMedia>
              <EmptyTitle>No pay periods yet</EmptyTitle>
              <EmptyDescription>
                Add the dates you pay for — a week, a fortnight or a month.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <PeriodTable periods={periods.data} isOwner={isOwner} />
        )}
      </section>
    </>
  );
}

function NewPeriod() {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const create = useMutation({
    mutationFn: () => payrollApi.create(orgId, { startsOn, endsOn }),
    onSuccess: () => {
      toast.success('Pay period added');
      setStartsOn('');
      setEndsOn('');
      void queryClient.invalidateQueries({ queryKey: ['pay-periods', orgId] });
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not add the period'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="period-start">From</Label>
        <Input
          id="period-start"
          type="date"
          required
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="period-end">To</Label>
        <Input
          id="period-end"
          type="date"
          required
          min={startsOn || undefined}
          value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? <Spinner /> : null}
        Add pay period
      </Button>
      <p className="w-full text-xs text-muted-foreground">Up to 31 days. Periods cannot overlap.</p>
    </form>
  );
}

function PeriodTable({ periods, isOwner }: { periods: PayPeriodView[]; isOwner: boolean }) {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['pay-periods', orgId] });

  const approve = useMutation({
    mutationFn: (id: string) => payrollApi.approve(orgId, id),
    onSuccess: () => {
      toast.success('Approved', { description: 'Pay is being calculated.' });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not approve it'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => payrollApi.remove(orgId, id),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not delete it'),
  });
  const download = useMutation({
    mutationFn: async ({ period, format }: { period: PayPeriodView; format: 'csv' | 'xlsx' }) => {
      const blob = await payrollApi.export(orgId, period.id, `format=${format}`);
      save(blob, `payroll-${period.startsOn}-to-${period.endsOn}.${format}`);
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not download it'),
  });

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.map((period) => {
            const ready =
              period.readiness !== null &&
              period.readiness.openPunches === 0 &&
              period.readiness.unreviewedFlags === 0;
            return (
              <TableRow key={period.id}>
                <TableCell className="min-w-44 whitespace-normal font-medium">
                  {range(period)}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {period.status === 'approved' && period.totals ? (
                    <div className="space-y-0.5">
                      <Badge variant="secondary">
                        <CheckCircle2 className="text-success" aria-hidden="true" /> Approved
                      </Badge>
                      <div className="tabular text-sm">
                        {rupees.format(period.totals.amountMinor / 100)} · {period.totals.employees}{' '}
                        people · {(period.totals.paidMinutes / 60).toFixed(1)} h
                      </div>
                    </div>
                  ) : period.status === 'calculating' ? (
                    <Badge variant="outline">
                      <Spinner /> Calculating
                    </Badge>
                  ) : (
                    <div className="space-y-0.5">
                      <Badge variant="outline">Open</Badge>
                      {period.readiness ? (
                        <div className="text-xs text-muted-foreground">
                          {ready
                            ? 'Ready to approve'
                            : `${period.readiness.openPunches} open punch(es), ${period.readiness.unreviewedFlags} flagged to review`}
                          {period.readiness.disputed > 0
                            ? ` · ${period.readiness.disputed} disputed (not paid)`
                            : ''}
                        </div>
                      ) : null}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {period.status === 'open' && isOwner ? (
                      <Button
                        size="sm"
                        disabled={!ready || approve.isPending}
                        onClick={() => approve.mutate(period.id)}
                        aria-label={`Approve pay for ${range(period)}`}
                      >
                        Approve
                      </Button>
                    ) : null}
                    {period.status === 'open' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(period.id)}
                        aria-label={`Delete the pay period ${range(period)}`}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                    {period.status === 'approved' && isOwner
                      ? (['csv', 'xlsx'] as const).map((format) => (
                          <Button
                            key={format}
                            size="sm"
                            variant="outline"
                            disabled={download.isPending}
                            onClick={() => download.mutate({ period, format })}
                            aria-label={`Download ${range(period)} as ${format.toUpperCase()}`}
                          >
                            <Download /> {format.toUpperCase()}
                          </Button>
                        ))
                      : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
