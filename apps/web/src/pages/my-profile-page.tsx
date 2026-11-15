import { useQuery } from '@tanstack/react-query';
import { Mail, MapPin, Phone, ShieldCheck, UserRound } from 'lucide-react';

import { DefinitionRow } from '@/components/definition-row';
import { PushToggle } from '@/components/push-toggle';
import { initials } from '@/components/page';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { meApi } from '@/lib/api';
import { useOrg } from '@/lib/org-context';

const CHANNELS: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  push: 'Push notification',
};

/** Who the app thinks you are, and how it will reach you. Read-only: a manager owns these. */
export function MyProfilePage() {
  const { orgId } = useOrg();
  const me = useQuery({ queryKey: ['me', orgId], queryFn: () => meApi.get(orgId) });

  if (me.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (me.isError) return <Skeleton className="h-32 w-full rounded-xl" />;

  const profile = me.data.profile;
  if (!profile) {
    return (
      <section className="rounded-xl border bg-background p-6 text-center">
        <UserRound className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-base font-semibold">No staff profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This login administers the organisation but is not on the rota. Ask an owner to link it to
          a staff profile if you also work shifts.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-xl border bg-background p-5">
        <div className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarFallback>{initials(profile.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{profile.name}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {profile.jobRoleNames.length > 0
                ? profile.jobRoleNames.join(', ')
                : 'No job role yet'}
            </p>
          </div>
        </div>

        <dl className="mt-2 divide-y text-sm">
          <DefinitionRow icon={<Mail className="size-4" />} label="Email">
            {profile.email ?? 'Not set'}
          </DefinitionRow>
          <DefinitionRow icon={<Phone className="size-4" />} label="Phone">
            {profile.phone ?? 'Not set'}
          </DefinitionRow>
          <DefinitionRow icon={<ShieldCheck className="size-4" />} label="Reminders by">
            {CHANNELS[profile.notifyChannel] ?? profile.notifyChannel}
          </DefinitionRow>
        </dl>
      </section>

      <section className="mt-4 rounded-xl border bg-background p-5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Your locations
        </h2>
        {profile.locations.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No location assigned yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {profile.locations.map((location) => (
              <li key={location.id} className="flex items-center gap-2 text-sm">
                <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{location.name}</span>
                <Badge variant="outline" className="ml-auto shrink-0 font-normal">
                  {location.timezone.replace('_', ' ')}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PushToggle orgId={orgId} />

      <p className="mt-4 px-1 text-xs text-muted-foreground">
        Your manager keeps these details up to date. Ask them to change your phone number or how
        shift reminders reach you.
      </p>
    </>
  );
}
