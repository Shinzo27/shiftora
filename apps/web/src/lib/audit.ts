import { addDays, localDayBounds, toLocal } from '@shiftora/domain';
import type { AuditEntity } from '@shiftora/shared';

/**
 * Turning audit rows into sentences for the owner's log (W7 D4). The rows store whatever each
 * module recorded as `before`/`after`, so this stays generic: it names the kind of thing, says
 * what happened to it, and lists the fields whose values differ.
 */

export const entityLabels: Record<AuditEntity, string> = {
  shift: 'Shift',
  schedule: 'Schedule',
  shift_template: 'Shift template',
  shift_request: 'Shift request',
  coverage_requirement: 'Coverage',
  employee: 'Employee',
  time_off: 'Time off',
  time_entry: 'Punch',
  pay_period: 'Pay period',
  pay_rules: 'Pay rules',
  location: 'Location',
  department: 'Department',
  job_role: 'Job role',
  membership: 'Member',
  invite: 'Invite',
  organization: 'Organisation',
  delivery: 'Message',
};

const words = (snake: string) => snake.replaceAll('_', ' ');

/** "Pay rules", or the raw kind tidied up for one this screen does not know yet. */
export function entityLabel(entity: string): string {
  if (entity in entityLabels) return entityLabels[entity as AuditEntity];
  const text = words(entity);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `shift_request.approved` → "Shift request approved". */
export function describeAction(action: string): string {
  const dot = action.indexOf('.');
  if (dot === -1) return entityLabel(action);
  return `${entityLabel(action.slice(0, dot))} ${words(action.slice(dot + 1))}`;
}

/** `hourlyRateMinor` → "hourly rate"; `job_role_id` → "job role id". */
export function fieldLabel(key: string): string {
  return words(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/ minor$/, '');
}

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** Money is stored in paise (`…Minor`, AGENTS.md → Money): show it as rupees. */
export function formatField(key: string, value: unknown): string {
  if (/(^m|M)inor$/.test(key) && typeof value === 'number') return rupees.format(value / 100);
  return formatValue(value);
}

/** A value short enough for one line of the log. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    return value.every((item) => typeof item !== 'object' || item === null)
      ? value.map(formatValue).join(', ')
      : `${value.length} items`;
  }
  const json = JSON.stringify(value);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

export interface Change {
  field: string;
  /** Absent when the thing was created (nothing before). */
  from?: string;
  /** Absent when it was removed (nothing after). */
  to?: string;
}

/** The fields that differ between before and after, in a stable order. */
export function changesOf(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Change[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const changes: Change[] = [];
  for (const key of keys) {
    const was = before?.[key];
    const now = after?.[key];
    if (before && after && JSON.stringify(was) === JSON.stringify(now)) continue;
    changes.push({
      field: fieldLabel(key),
      ...(before ? { from: formatField(key, was) } : {}),
      ...(after ? { to: formatField(key, now) } : {}),
    });
  }
  return changes;
}

export const periods = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
] as const;
export type Period = (typeof periods)[number]['value'];

/**
 * The start of the period on the viewer's calendar: "last 7 days" is today and the six before,
 * from local midnight — not 168 hours ago, which would start mid-morning.
 */
export function periodStart(period: Period, now: Date, zone: string): string | undefined {
  if (period === 'all') return undefined;
  const today = toLocal(now, zone).date;
  return localDayBounds(addDays(today, 1 - Number(period)), zone).start.toISOString();
}
