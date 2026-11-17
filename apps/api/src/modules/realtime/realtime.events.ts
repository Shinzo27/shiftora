/** What the browser hears about. The payload is scoped, so a client can ignore other weeks. */
export interface ScheduleChangedEvent {
  orgId: string;
  scheduleId: string;
  locationId: string;
  weekStart: string;
  /** `shifts` = a shift was added, moved or removed; `published` = the week was sent. */
  kind: 'shifts' | 'published';
}

/** Room per organisation: every signed-in member of it hears the event and filters by payload. */
export function orgRoom(orgId: string): string {
  return `org:${orgId}`;
}

export const SCHEDULE_CHANGED = 'schedule.changed';

/** What the worker reports about a long job (the auto-scheduler). */
export interface AutofillProgressEvent {
  orgId: string;
  scheduleId: string;
  runId: string;
  /** 'solving' while it thinks, 'succeeded' when the draft is written. */
  status: string;
}

export const AUTOFILL_UPDATED = 'schedule.autofill';
