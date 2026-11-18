import type { OrgSummary } from '@shiftora/shared';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck, MailCheck, ShieldQuestion } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Logo } from '@/components/logo';
import { FormAlert } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { invitesApi } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useSession } from '@/lib/session';

/**
 * `/invite/:code` — the page an invitation email points at (W7½ UI1).
 *
 * It works in both states, because the person clicking may not have an account yet. Logged out,
 * it explains what is waiting and carries the code through sign-in (`?next=`); logged in, one
 * button joins. Nothing here guesses the organisation's name: the code is the only claim, and
 * the server answers with the org once it is redeemed.
 */
export function AcceptInvitePage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [joined, setJoined] = useState<OrgSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const next = `/invite/${encodeURIComponent(code)}`;
  const accept = useMutation({
    mutationFn: () => invitesApi.accept(code),
    onSuccess: (org) => {
      setJoined(org);
      setTimeout(() => void navigate(`/o/${org.id}`), 900);
    },
    onError: (err) => setError(errorMessage(err) ?? 'This invite did not work'),
  });

  return (
    <div className="flex min-h-svh flex-col p-6 sm:p-10">
      <Link to="/" className="w-fit" aria-label="Shiftora home">
        <Logo />
      </Link>
      <main className="flex flex-1 items-center justify-center py-12">
        <div className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="space-y-2">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {joined ? <CircleCheck /> : <MailCheck />}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {joined ? `You're in ${joined.name}` : 'You have been invited to a team'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {joined
                ? 'Opening the organisation…'
                : session.data
                  ? 'Joining adds this clinic to your organisations. You can switch back at any time.'
                  : 'Sign in with the address the invitation was sent to, or create an account with it.'}
            </p>
          </div>

          <FormAlert message={error} />

          {session.isPending ? (
            <Spinner aria-label="Checking your sign-in" />
          ) : joined ? (
            <Button asChild>
              <Link to={`/o/${joined.id}`}>Open {joined.name}</Link>
            </Button>
          ) : session.data ? (
            <div className="space-y-3">
              <p className="text-sm">
                Signed in as <span className="font-medium">{session.data.email}</span>
              </p>
              <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
                {accept.isPending ? <Spinner /> : <ShieldQuestion />}
                Join the team
              </Button>
              {error ? (
                <p className="text-xs text-muted-foreground">
                  Recognise a different address?{' '}
                  <Link className="underline" to="/login?next=/orgs">
                    Sign in as someone else
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1">
                <Link to={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
              </Button>
            </div>
          )}

          <p className="border-t pt-4 text-xs text-muted-foreground">
            Invitations expire after seven days and work once. Ask an owner of the clinic for a new
            link if this one does not work.
          </p>
        </div>
      </main>
    </div>
  );
}
