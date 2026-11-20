import type { CreatePayRulesVersion, PayRulesData, PayRulesVersionView } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ErrorState, FormAlert } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { payRulesApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useOrg } from '@/lib/org-context';

/**
 * Pay rules, versioned (W7½ UI2).
 *
 * A version is a date and a set of rules, and it is never edited: changing how overtime works
 * means a new version starting later, so last March's payslip recalculates exactly as it did.
 * Owners write; managers read, because a manager has to be able to explain a payslip.
 */

const dayLabel = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateOf = (iso: string) => dayLabel.format(new Date(`${iso}T00:00:00Z`));

/** "1.5×", "2×" — nought or two decimals, never "1.50×". */
const times = (multiplier: number) => `${String(multiplier).replace(/\.0+$/, '')}×`;
const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};

/** One line a manager can read: what this version actually changes. */
export function describeRules(rules: PayRulesData): string {
  const parts: string[] = [];
  for (const rule of rules.overtime) {
    parts.push(
      `overtime after ${hours(rule.thresholdMinutes)} a ${rule.period} at ${times(rule.multiplier)}`,
    );
  }
  if (rules.nightPremium) {
    const { startLocal, endLocal, multiplier } = rules.nightPremium;
    parts.push(`night ${startLocal}–${endLocal} at ${times(multiplier)}`);
  }
  for (const rule of rules.breaks) {
    parts.push(`${rule.deductMinutes} min break after ${hours(rule.afterMinutes)}`);
  }
  if (rules.rounding) {
    parts.push(`rounding to ${rules.rounding.toMinutes} min (${rules.rounding.mode})`);
  }
  if (parts.length === 0) return 'Plain hourly pay — no overtime, premiums or rounding';
  return parts.join(' · ');
}

export function PayRulesPanel() {
  const { orgId, role } = useOrg();
  const isOwner = role === 'owner';
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ['pay-rules', orgId],
    queryFn: () => payRulesApi.list(orgId),
  });
  const [writing, setWriting] = useState(false);

  const withdraw = useMutation({
    mutationFn: (version: PayRulesVersionView) => payRulesApi.withdraw(orgId, version.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pay-rules', orgId] });
      toast.success('Version withdrawn');
    },
    onError: (error) =>
      toast.error(errorMessage(error) ?? 'Could not withdraw — a pay period may already use it'),
  });

  const latest = versions.data?.[0];

  return (
    <section aria-labelledby="pay-rules-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="pay-rules-heading" className="text-lg font-semibold tracking-tight">
            Pay rules
          </h2>
          <p className="text-sm text-muted-foreground">
            Overtime, night pay, breaks and rounding. A new version starts on a date; older payslips
            keep the rules they were calculated with.
          </p>
        </div>
        {isOwner ? (
          <Button variant="outline" onClick={() => setWriting(true)}>
            <Plus /> New version
          </Button>
        ) : null}
      </div>

      {versions.isError ? (
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      ) : versions.isPending ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : versions.data.length === 0 ? (
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p className="font-medium">No pay rules yet</p>
          <p className="mt-1 text-muted-foreground">
            Everyone is paid their hourly rate for the minutes they worked.
            {isOwner ? ' Add a version when you need overtime or night pay.' : ''}
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {versions.data.map((version, index) => (
            <li key={version.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <CalendarClock className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  From {dateOf(version.effectiveFrom)}
                  <Badge variant="outline">v{version.version}</Badge>
                  {index === 0 ? <Badge variant="secondary">current</Badge> : null}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {describeRules(version.rules)}
                </p>
                {version.note ? (
                  <p className="mt-1 text-xs text-muted-foreground italic">“{version.note}”</p>
                ) : null}
              </div>
              {isOwner && index === 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate(version)}
                  title="Withdraw the newest version, if no pay period has used it"
                >
                  <Undo2 /> Withdraw
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* No `latest` yet is the normal start (new organisations have no rules): the dialog then
          starts from plain hourly pay. Requiring one made the first version impossible to add. */}
      {writing ? (
        <RulesDialog
          orgId={orgId}
          previous={latest ?? null}
          onClose={() => setWriting(false)}
          onSaved={() => {
            setWriting(false);
            void queryClient.invalidateQueries({ queryKey: ['pay-rules', orgId] });
          }}
        />
      ) : null}
    </section>
  );
}

interface Draft {
  effectiveFrom: string;
  dayOn: boolean;
  dayHours: string;
  dayMultiplier: string;
  weekOn: boolean;
  weekHours: string;
  weekMultiplier: string;
  nightOn: boolean;
  nightStart: string;
  nightEnd: string;
  nightMultiplier: string;
  breakOn: boolean;
  breakAfter: string;
  breakDeduct: string;
  roundingOn: boolean;
  roundingTo: string;
  roundingMode: 'nearest' | 'up' | 'down';
  note: string;
}

/** Plain hourly pay: what applies before an organisation's first version. */
const NO_RULES: PayRulesData = { overtime: [], nightPremium: null, breaks: [], rounding: null };

/** Starts from the last version, so a change is an edit rather than retyping everything. */
function draftFrom(rules: PayRulesData): Draft {
  const day = rules.overtime.find((rule) => rule.period === 'day');
  const week = rules.overtime.find((rule) => rule.period === 'week');
  const night = rules.nightPremium;
  const brk = rules.breaks[0];
  return {
    effectiveFrom: '',
    dayOn: Boolean(day),
    dayHours: String((day?.thresholdMinutes ?? 540) / 60),
    dayMultiplier: String(day?.multiplier ?? 1.5),
    weekOn: Boolean(week),
    weekHours: String((week?.thresholdMinutes ?? 2880) / 60),
    weekMultiplier: String(week?.multiplier ?? 1.5),
    nightOn: Boolean(night),
    nightStart: night?.startLocal ?? '22:00',
    nightEnd: night?.endLocal ?? '06:00',
    nightMultiplier: String(night?.multiplier ?? 1.25),
    breakOn: Boolean(brk),
    breakAfter: String((brk?.afterMinutes ?? 360) / 60),
    breakDeduct: String(brk?.deductMinutes ?? 30),
    roundingOn: Boolean(rules.rounding),
    roundingTo: '5',
    roundingMode: resultsMode(rules),
    note: '',
  };
}

function resultsMode(rules: PayRulesData): Draft['roundingMode'] {
  const rounding = rules.rounding;
  return rounding?.mode ?? 'nearest';
}

function toRequest(draft: Draft): CreatePayRulesVersion {
  const overtime: PayRulesData['overtime'] = [];
  if (draft.dayOn) {
    overtime.push({
      period: 'day',
      thresholdMinutes: Math.round(Number(draft.dayHours) * 60),
      multiplier: Number(draft.dayMultiplier),
    });
  }
  if (draft.weekOn) {
    overtime.push({
      period: 'week',
      thresholdMinutes: Math.round(Number(draft.weekHours) * 60),
      multiplier: Number(draft.weekMultiplier),
    });
  }
  return {
    effectiveFrom: draft.effectiveFrom,
    note: draft.note.trim() || undefined,
    rules: {
      overtime,
      nightPremium: draft.nightOn
        ? {
            startLocal: draft.nightStart,
            endLocal: draft.nightEnd,
            multiplier: Number(draft.nightMultiplier),
          }
        : null,
      breaks: draft.breakOn
        ? [
            {
              afterMinutes: Math.round(Number(draft.breakAfter) * 60),
              deductMinutes: Math.round(Number(draft.breakDeduct)),
            },
          ]
        : [],
      rounding: draft.roundingOn
        ? {
            toMinutes: Number(draft.roundingTo) as 1 | 5 | 6 | 10 | 15 | 30,
            mode: draft.roundingMode,
          }
        : null,
    },
  };
}

function RulesDialog({
  orgId,
  previous,
  onClose,
  onSaved,
}: {
  orgId: string;
  /** null for the organisation's first version. */
  previous: PayRulesVersionView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    ...draftFrom(previous?.rules ?? NO_RULES),
    roundingTo: String(previous?.rules.rounding?.toMinutes ?? 5),
  }));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: () => payRulesApi.create(orgId, toRequest(draft)),
    onSuccess: () => {
      toast.success('Pay rules updated from that date');
      onSaved();
    },
    onError: (err) => setError(errorMessage(err) ?? 'Could not save these rules'),
  });

  const rules = toRequest(draft).rules;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{previous ? 'New pay rules version' : 'First pay rules'}</DialogTitle>
          <DialogDescription>
            {previous
              ? `Starts from v${previous.version} (${describeRules(previous.rules)}). Payslips before the start date keep the old rules.`
              : 'Everything is off until you turn it on. Before the start date, staff are paid their plain hourly rate.'}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="effective-from">Applies to work from</FieldLabel>
            <Input
              id="effective-from"
              type="date"
              value={draft.effectiveFrom}
              onChange={(event) => set('effectiveFrom', event.target.value)}
            />
          </Field>

          <RuleRow
            id="overtime-day"
            label="Daily overtime"
            checked={draft.dayOn}
            onChecked={(on) => set('dayOn', on)}
            suffix={
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">after</span>
                <Input
                  aria-label="Daily overtime after hours"
                  className="w-16"
                  inputMode="decimal"
                  value={draft.dayHours}
                  onChange={(event) => set('dayHours', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">h at</span>
                <Input
                  aria-label="Daily overtime multiplier"
                  className="w-16"
                  inputMode="decimal"
                  value={draft.dayMultiplier}
                  onChange={(event) => set('dayMultiplier', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">×</span>
              </div>
            }
          />

          <RuleRow
            id="overtime-week"
            label="Weekly overtime"
            checked={draft.weekOn}
            onChecked={(on) => set('weekOn', on)}
            suffix={
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">after</span>
                <Input
                  aria-label="Weekly overtime after hours"
                  className="w-16"
                  inputMode="decimal"
                  value={draft.weekHours}
                  onChange={(event) => set('weekHours', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">h at</span>
                <Input
                  aria-label="Weekly overtime multiplier"
                  className="w-16"
                  inputMode="decimal"
                  value={draft.weekMultiplier}
                  onChange={(event) => set('weekMultiplier', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">×</span>
              </div>
            }
          />

          <RuleRow
            id="night"
            label="Night premium"
            checked={draft.nightOn}
            onChecked={(on) => set('nightOn', on)}
            suffix={
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Night window starts"
                  type="time"
                  className="w-28"
                  value={draft.nightStart}
                  onChange={(event) => set('nightStart', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  aria-label="Night window ends"
                  type="time"
                  className="w-28"
                  value={draft.nightEnd}
                  onChange={(event) => set('nightEnd', event.target.value)}
                />
                <Input
                  aria-label="Night multiplier"
                  className="w-14"
                  inputMode="decimal"
                  value={draft.nightMultiplier}
                  onChange={(event) => set('nightMultiplier', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">×</span>
              </div>
            }
          />

          <RuleRow
            id="break"
            label="Break deducted"
            checked={draft.breakOn}
            onChecked={(on) => set('breakOn', on)}
            suffix={
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Break minutes"
                  className="w-16"
                  inputMode="numeric"
                  value={draft.breakDeduct}
                  onChange={(event) => set('breakDeduct', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">min after</span>
                <Input
                  aria-label="Break after hours"
                  className="w-16"
                  inputMode="decimal"
                  value={draft.breakAfter}
                  onChange={(event) => set('breakAfter', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">h</span>
              </div>
            }
          />

          <RuleRow
            id="rounding"
            label="Round minutes"
            checked={draft.roundingOn}
            onChecked={(on) => set('roundingOn', on)}
            suffix={
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">to</span>
                <Select value={draft.roundingTo} onValueChange={(v) => set('roundingTo', v)}>
                  <SelectTrigger aria-label="Rounding step" className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 5, 6, 10, 15, 30].map((step) => (
                      <SelectItem key={step} value={String(step)}>
                        {step} min
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={draft.roundingMode}
                  onValueChange={(v) => set('roundingMode', v as Draft['roundingMode'])}
                >
                  <SelectTrigger aria-label="Rounding mode" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nearest">nearest</SelectItem>
                    <SelectItem value="up">up</SelectItem>
                    <SelectItem value="down">down</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
          />

          <Field>
            <FieldLabel htmlFor="rules-note">Why (optional)</FieldLabel>
            <Input
              id="rules-note"
              placeholder="Diwali week, agreed with the team"
              value={draft.note}
              onChange={(event) => set('note', event.target.value)}
            />
          </Field>

          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            New rules read: {describeRules(rules)}
          </p>
          <FormAlert message={error} />
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner /> : null}
            Save version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleRow({
  id,
  label,
  checked,
  onChecked,
  suffix,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChecked: (on: boolean) => void;
  suffix: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChecked(value === true)}
        aria-label={label}
      />
      <label htmlFor={id} className="min-w-24 text-sm font-medium">
        {label}
      </label>
      <div className={checked ? '' : 'pointer-events-none opacity-40'}>{suffix}</div>
    </div>
  );
}
