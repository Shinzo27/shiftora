import { and, eq, inArray, schema, type Database, type Transaction } from '@shiftora/db';
import {
  renderRequestForManager,
  renderRequestOutcome,
  renderSwapAsked,
  toLocal,
  type ChannelPolicy,
  type RenderedMessage,
  type RequestMessageContext,
  type RequestOutcome,
  type RequestShiftLine,
} from '@shiftora/domain';

import type { OutboxEvent } from '../outbox-relay.js';
import type { FanOutResult } from './fan-out.js';
import { setOrg } from './fan-out.js';
import { managersOf } from './managers.js';
import { notifyEmployee, pushSubscriptionCounts, type StaffRecipient } from './notify.js';

export interface RequestNotifyDeps {
  usable: ChannelPolicy;
  appUrl: string;
}

const NOTHING: FanOutResult = { notifications: 0, deliveries: 0, deliveryIds: [] };

/** Who hears about each step of a request (W5 D2). */
type Audience = 'colleague' | 'requester' | 'managers';

const AUDIENCE: Record<string, (type: 'swap' | 'drop', responded: boolean) => Audience[]> = {
  // A swap asks the colleague first; a drop goes straight to the managers.
  'shift_request.created': (type) => (type === 'swap' ? ['colleague'] : ['managers']),
  // Both sides agreed: now it is the managers' decision.
  'shift_request.accepted': () => ['managers'],
  'shift_request.declined': () => ['requester'],
  // Everyone whose rota changes.
  'shift_request.approved': (type) =>
    type === 'swap' ? ['requester', 'colleague'] : ['requester'],
  // The colleague only if they had already said yes (they were expecting the shift).
  'shift_request.rejected': (type, responded) =>
    type === 'swap' && responded ? ['requester', 'colleague'] : ['requester'],
  // Withdrawn before anyone decided: the colleague may have been about to answer.
  'shift_request.cancelled': (type) => (type === 'swap' ? ['colleague'] : []),
};

const OUTCOME: Record<string, RequestOutcome> = {
  'shift_request.declined': 'declined',
  'shift_request.approved': 'approved',
  'shift_request.rejected': 'rejected',
  'shift_request.cancelled': 'cancelled',
};

type Person = StaffRecipient & { name: string };

/**
 * One `shift_request.*` event → messages: the colleague and the requester through their own
 * channel ladder, the location's managers by email. Idempotent like every handler here: the
 * notification rows are unique per event and recipient, so a replayed job sends nothing.
 */
export async function handleShiftRequestEvent(
  db: Database,
  event: OutboxEvent,
  deps: RequestNotifyDeps,
): Promise<FanOutResult> {
  const requestId = (event.payload as { requestId?: unknown } | null)?.requestId;
  const audienceFor = AUDIENCE[event.topic];
  if (typeof requestId !== 'string' || !audienceFor) return NOTHING;

  return db.transaction(async (tx) => {
    await setOrg(tx, event.orgId);
    const loaded = await load(tx, event.orgId, requestId);
    if (!loaded) return NOTHING;
    const { request, context, people, locationId } = loaded;

    const deliveryIds: string[] = [];
    let notifications = 0;
    const shiftsPath = `/o/${event.orgId}/shifts`;

    for (const audience of audienceFor(context.type, request.respondedAt !== null)) {
      if (audience === 'managers') {
        for (const manager of await managersOf(tx, event.orgId, locationId)) {
          const message = renderRequestForManager({
            ...context,
            managerName: manager.name,
            appUrl: `${deps.appUrl}/o/${event.orgId}/schedule`,
          });
          const sent = await emailOnce(tx, event, manager.email, message, requestId);
          if (sent.created) {
            notifications += 1;
            if (sent.deliveryId) deliveryIds.push(sent.deliveryId);
          }
        }
        continue;
      }

      const person: Person | null = audience === 'colleague' ? people.colleague : people.requester;
      if (!person) continue;
      const message: RenderedMessage =
        event.topic === 'shift_request.created'
          ? renderSwapAsked({ ...context, appUrl: `${deps.appUrl}${shiftsPath}` })
          : renderRequestOutcome({
              ...context,
              outcome: OUTCOME[event.topic]!,
              recipientName: person.name,
              appUrl: `${deps.appUrl}${shiftsPath}`,
            });
      const devices = await pushSubscriptionCounts(tx, [person.id]);
      const result = await notifyEmployee(tx, {
        orgId: event.orgId,
        outboxId: event.id,
        employee: person,
        pushDevices: devices.get(person.id) ?? 0,
        kind: event.topic,
        message,
        payload: { requestId, url: shiftsPath },
        usable: deps.usable,
      });
      if (result) {
        notifications += 1;
        if (result.deliveryId) deliveryIds.push(result.deliveryId);
      }
    }

    return { notifications, deliveries: deliveryIds.length, deliveryIds };
  });
}

/** One email to a manager for this event, unless this event already sent it (a replayed job). */
async function emailOnce(
  tx: Transaction,
  event: OutboxEvent,
  email: string,
  message: RenderedMessage,
  requestId: string,
): Promise<{ created: boolean; deliveryId: string | null }> {
  const [notification] = await tx
    .insert(schema.notifications)
    .values({
      orgId: event.orgId,
      outboxId: event.id,
      recipientEmail: email,
      kind: event.topic,
      subject: message.subject,
      body: message.body,
      payload: { requestId },
    })
    .onConflictDoNothing({
      target: [schema.notifications.outboxId, schema.notifications.recipientEmail],
    })
    .returning({ id: schema.notifications.id });
  if (!notification) return { created: false, deliveryId: null };
  const [delivery] = await tx
    .insert(schema.deliveries)
    .values({
      orgId: event.orgId,
      notificationId: notification.id,
      channel: 'email',
      address: email,
      status: 'queued',
    })
    .returning({ id: schema.deliveries.id });
  return { created: true, deliveryId: delivery?.id ?? null };
}

interface Loaded {
  request: typeof schema.shiftRequests.$inferSelect;
  context: RequestMessageContext;
  people: { requester: Person | null; colleague: Person | null };
  locationId: string;
}

/** The request with everything a message needs: both shifts in local time, both people. */
async function load(tx: Transaction, orgId: string, requestId: string): Promise<Loaded | null> {
  const [request] = await tx
    .select()
    .from(schema.shiftRequests)
    .where(and(eq(schema.shiftRequests.orgId, orgId), eq(schema.shiftRequests.id, requestId)));
  // A pickup is the claim itself (W5 D4): nothing to announce here.
  if (!request || request.type === 'pickup') return null;

  const shiftIds = [request.shiftId, ...(request.targetShiftId ? [request.targetShiftId] : [])];
  const shifts = await tx
    .select({
      id: schema.shifts.id,
      startsAt: schema.shifts.startsAt,
      endsAt: schema.shifts.endsAt,
      locationId: schema.shifts.locationId,
      locationName: schema.locations.name,
      timezone: schema.locations.timezone,
    })
    .from(schema.shifts)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.shifts.locationId))
    .where(and(eq(schema.shifts.orgId, orgId), inArray(schema.shifts.id, shiftIds)));
  const lineOf = (id: string | null): RequestShiftLine | null => {
    const shift = shifts.find((row) => row.id === id);
    if (!shift) return null;
    const start = toLocal(shift.startsAt, shift.timezone);
    const end = toLocal(shift.endsAt, shift.timezone);
    return {
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      locationName: shift.locationName,
    };
  };
  const given = lineOf(request.shiftId);
  const givenRow = shifts.find((row) => row.id === request.shiftId);
  if (!given || !givenRow) return null;

  const employeeIds = [
    request.requesterEmployeeId,
    ...(request.targetEmployeeId ? [request.targetEmployeeId] : []),
  ];
  const staff = await tx
    .select({
      id: schema.employees.id,
      name: schema.employees.name,
      email: schema.employees.email,
      phone: schema.employees.phone,
      notifyChannel: schema.employees.notifyChannel,
    })
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, orgId), inArray(schema.employees.id, employeeIds)));
  const requester = staff.find((row) => row.id === request.requesterEmployeeId) ?? null;
  const colleague = staff.find((row) => row.id === request.targetEmployeeId) ?? null;
  if (!requester) return null;

  return {
    request,
    locationId: givenRow.locationId,
    people: { requester, colleague },
    context: {
      type: request.type === 'drop' ? 'drop' : 'swap',
      requesterName: requester.name,
      colleagueName: colleague?.name ?? null,
      shift: given,
      returnShift: lineOf(request.targetShiftId),
      note: request.note,
      decisionNote: request.decisionNote,
    },
  };
}
