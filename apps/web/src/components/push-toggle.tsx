import { useMutation } from '@tanstack/react-query';
import { BellOff, BellRing } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { disablePush, enablePush, pushSupport, type PushSupport } from '@/lib/push';

const MESSAGES: Record<PushSupport, string> = {
  on: 'Notifications are on for this device. We will send shift changes here.',
  off: 'Turn on notifications to hear about a new rota or a changed shift.',
  blocked:
    'This browser has blocked notifications for the site. Allow them in the address bar, then try again.',
  unavailable: 'Notifications are not set up on this server yet.',
  unsupported:
    'Notifications arrive through the installed app. Open the built site — or add Shiftora to your home screen — and turn them on there.',
};

/**
 * The staff app's opt-in.
 *
 * Deliberately one device at a time: permission is a property of the browser, not the person, and
 * a button that claims otherwise ("notifications: on") would be lying on the second phone.
 */
export function PushToggle({ orgId }: { orgId: string }) {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pushSupport(orgId)
      .then((state) => {
        if (!cancelled) setSupport(state);
      })
      .catch(() => {
        if (!cancelled) setSupport('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const mutate = useMutation({
    mutationFn: (action: 'on' | 'off') =>
      action === 'on' ? enablePush(orgId) : disablePush(orgId),
    onSuccess: (state) => {
      setSupport(state);
      setError(null);
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not change notifications.');
    },
  });

  if (!support) return null;

  const actionable = support === 'on' || support === 'off' || support === 'blocked';

  return (
    <section className="mt-4 rounded-xl border bg-background p-5">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Notifications
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{MESSAGES[support]}</p>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {actionable && (
        <Button
          variant={support === 'on' ? 'outline' : 'default'}
          className="mt-3 w-full sm:w-auto"
          disabled={mutate.isPending}
          onClick={() => mutate.mutate(support === 'on' ? 'off' : 'on')}
        >
          {support === 'on' ? (
            <>
              <BellOff className="mr-2 size-4" aria-hidden="true" />
              Turn off on this device
            </>
          ) : (
            <>
              <BellRing className="mr-2 size-4" aria-hidden="true" />
              Turn on notifications
            </>
          )}
        </Button>
      )}
    </section>
  );
}
