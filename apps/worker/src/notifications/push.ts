import { and, eq, schema, sql, type Database } from '@shiftora/db';

/** What a phone shows in the notification tray. Kept small deliberately: a push is a nudge. */
export interface PushPayload {
  title: string;
  body: string;
  /** Where the tap should land, relative to the app. */
  url?: string;
}

export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * The two answers that matter. A push service saying the subscription is gone (404/410) is not a
 * failure to retry — that device has uninstalled, cleared its data or been wiped, and the row
 * should go with it.
 */
export type PushOutcome = 'sent' | 'gone' | 'failed';

export interface PushSender {
  send(subscription: StoredSubscription, payload: PushPayload): Promise<PushOutcome>;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * The real sender, over Web Push with VAPID.
 *
 * `web-push` is imported dynamically so the worker still boots (and its tests still run) when the
 * keys are absent — with no keys there is simply no push channel, rather than a crash.
 */
export async function createWebPushSender(config: PushConfig | null): Promise<PushSender | null> {
  if (!config) return null;

  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  return {
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          // A nudge, not a record: if the phone is offline it should still be fresh tomorrow.
          { TTL: 60 * 60 * 12 },
        );
        return 'sent';
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        // 404/410: the subscription no longer exists on the push service.
        if (statusCode === 404 || statusCode === 410) return 'gone';
        return 'failed';
      }
    },
  };
}

export interface PushResult {
  sent: number;
  gone: number;
  failed: number;
}

/**
 * Sends one message to every browser the person has subscribed, and forgets the ones that are
 * gone. One delivery row covers the channel, so "sent" means at least one device took it — the
 * per-device detail would be a table nobody reads.
 */
export async function sendPushToEmployee(
  db: Database,
  orgId: string,
  employeeId: string,
  sender: PushSender,
  payload: PushPayload,
): Promise<PushResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);

    const subscriptions = await tx
      .select({
        id: schema.pushSubscriptions.id,
        endpoint: schema.pushSubscriptions.endpoint,
        p256dh: schema.pushSubscriptions.p256dh,
        auth: schema.pushSubscriptions.auth,
      })
      .from(schema.pushSubscriptions)
      .where(
        and(
          eq(schema.pushSubscriptions.orgId, orgId),
          eq(schema.pushSubscriptions.employeeId, employeeId),
        ),
      );

    const result: PushResult = { sent: 0, gone: 0, failed: 0 };

    for (const subscription of subscriptions) {
      const outcome = await sender.send(subscription, payload);
      result[outcome] += 1;

      if (outcome === 'gone') {
        await tx
          .delete(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.id, subscription.id));
      }
    }

    return result;
  });
}
