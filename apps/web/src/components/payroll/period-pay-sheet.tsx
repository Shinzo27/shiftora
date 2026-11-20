import { formatMinutes } from '@shiftora/domain';
import type { PayPeriodView, PayrollEmployee } from '@shiftora/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Moon } from 'lucide-react';

import { ErrorState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { payrollApi } from '@/lib/api';

const day = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 100);
/** Basis points → "1×", "1.5×", "1.75×". */
const multiplier = (bp: number) => `${Number((bp / 10_000).toFixed(2))}×`;

/**
 * What each person is paid for an approved period (W7½ UI2), highest first, and the day lines
 * behind every total — the same numbers as the CSV, readable without opening a spreadsheet.
 */
export function PeriodPaySheet({
  orgId,
  period,
  title,
  onClose,
}: {
  orgId: string;
  period: PayPeriodView | null;
  title: string;
  onClose: () => void;
}) {
  const payroll = useQuery({
    queryKey: ['payroll', orgId, period?.id],
    queryFn: () => payrollApi.payroll(orgId, period!.id),
    enabled: period !== null,
  });
  const people = [...(payroll.data ?? [])].sort((a, b) => b.amountMinor - a.amountMinor);

  return (
    <Sheet open={period !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Pay for {title}</SheetTitle>
          <SheetDescription>
            Per person, highest first. Open a name to see the days behind it.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {payroll.isError ? (
            <ErrorState error={payroll.error} onRetry={() => void payroll.refetch()} />
          ) : payroll.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : people.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nobody was paid in this period.
            </p>
          ) : (
            people.map((person) => <PersonPay key={person.employeeId} person={person} />)
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PersonPay({ person }: { person: PayrollEmployee }) {
  const paid = person.regularMinutes + person.overtimeMinutes;
  return (
    // A native disclosure: keyboard and screen-reader behaviour come with it.
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{person.name}</p>
          <p className="tabular text-xs text-muted-foreground">
            {formatMinutes(paid)} at {money(person.rateMinor, person.currency)}/h
            {person.overtimeMinutes > 0
              ? ` · ${formatMinutes(person.overtimeMinutes)} overtime`
              : ''}
            {person.nightMinutes > 0 ? ` · ${formatMinutes(person.nightMinutes)} at night` : ''}
          </p>
        </div>
        <span className="tabular font-semibold">{money(person.amountMinor, person.currency)}</span>
        <ChevronDown
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ul className="divide-y border-t text-sm">
        {person.lines.map((line, index) => (
          <li
            key={`${line.date}-${line.category}-${line.night}-${index}`}
            className="flex items-center gap-2 px-3 py-2"
          >
            <span className="w-28 shrink-0 text-muted-foreground">
              {day.format(new Date(`${line.date}T00:00:00Z`))}
            </span>
            <span className="tabular">{formatMinutes(line.minutes)}</span>
            {line.category === 'overtime' ? <Badge variant="secondary">Overtime</Badge> : null}
            {line.night ? (
              <Badge variant="outline">
                <Moon aria-hidden="true" /> Night
              </Badge>
            ) : null}
            <span className="tabular ml-auto text-muted-foreground">
              {multiplier(line.multiplierBp)}
            </span>
            <span className="tabular w-24 text-right">
              {money(line.amountMinor, person.currency)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
