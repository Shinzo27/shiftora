import { pushApi } from './api';

export type PushSupport = 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on';

/**
 * Turning notifications on, honestly.
 *
 * Four things can be wrong and each gets its own answer, because "notifications failed" is the
 * message that makes people stop believing the button: the browser has no Web Push, the server
 * has no VAPID keys, the person has refused permission, or it is simply off.
 */
export async function pushSupport(orgId: string): Promise<PushSupport> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  // In development there is no service worker (vite-plugin-pwa only emits one for a build), so a
  // push cannot be received at all — saying so beats a button that never finishes loading.
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'unsupported';

  const publicKey = await pushApi.publicKey();
  if (!publicKey) return 'unavailable';
  if (Notification.permission === 'denied') return 'blocked';

  const subscription = await registration.pushManager.getSubscription();
  return subscription && (await isKnown(orgId, subscription)) ? 'on' : 'off';
}

/** Subscribing again is harmless (the server upserts), so this doubles as "refresh the row". */
export async function enablePush(orgId: string): Promise<PushSupport> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'unsupported';

  const publicKey = await pushApi.publicKey();
  if (!publicKey) return 'unavailable';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Chrome rejects a key that is not a Uint8Array; the server sends base64url.
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await pushApi.subscribe(orgId, toBody(subscription));
  return 'on';
}

export async function disablePush(orgId: string): Promise<PushSupport> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'off';

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return 'off';

  // Tell the server first: if the browser forgets the endpoint before the server does, the row
  // lingers and every notification is sent to a subscription nobody can see.
  await pushApi.unsubscribe(orgId, toBody(subscription));
  await subscription.unsubscribe();
  return 'off';
}

function toBody(subscription: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('This browser did not return usable push keys.');
  return { endpoint: subscription.endpoint, keys: { p256dh, auth } };
}

/** Whether the server already knows this device — so the button reflects the server, not the tab. */
async function isKnown(orgId: string, subscription: PushSubscription): Promise<boolean> {
  try {
    // Upsert, so this is also how a re-registered device repairs its row.
    await pushApi.subscribe(orgId, toBody(subscription));
    return true;
  } catch {
    return false;
  }
}

/** A fresh ArrayBuffer, not a view over one: applicationServerKey insists on owning it. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
