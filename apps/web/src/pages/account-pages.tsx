import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { authApi } from '../lib/api';
import { ApiError } from '../lib/api-client';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

/** The shared shell: a card with a title, one explanation, and a way back to signing in. */
function AccountCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          {/* The page's one h1 (W7½ UI3): a card title is a div, and these pages had none. */}
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </main>
  );
}

function BackToLogin() {
  return (
    <p className="text-sm text-muted-foreground">
      <Link to="/login" className="underline underline-offset-4">
        Back to sign in
      </Link>
    </p>
  );
}

/** `/verify-email?token=…` — the link in the confirmation email lands here. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  // A link with no token is failed before it is ever fetched — state, not a side effect.
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const [message, setMessage] = useState(
    token ? '' : 'This link has no token. Ask for a new email.',
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    authApi
      .verifyEmail(token)
      .then(() => {
        if (!cancelled) setState('done');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState('failed');
        setMessage(
          error instanceof ApiError
            ? error.message
            : 'Something went wrong confirming this address. Try the link again.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AccountCard
      title={state === 'done' ? 'Address confirmed' : 'Confirming your address'}
      description={
        state === 'done'
          ? 'Thank you — that address is now on your account.'
          : state === 'failed'
            ? 'That did not work.'
            : 'One moment.'
      }
    >
      {state === 'working' && <p className="text-sm text-muted-foreground">Checking the link…</p>}
      {state === 'failed' && <p className="text-sm text-destructive">{message}</p>}
      {state === 'done' && (
        <p className="text-sm text-muted-foreground">
          You can close this tab, or carry on where you left off.
        </p>
      )}
      <BackToLogin />
    </AccountCard>
  );
}

/** `/forgot-password` — asks for an address, and says the same thing whatever the answer is. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AccountCard
        title="Check your email"
        description="If that address has an account, a link is on its way. It works for one hour and can be used once."
      >
        <BackToLogin />
      </AccountCard>
    );
  }

  return (
    <AccountCard
      title="Forgotten your password?"
      description="Give us the address you sign in with, and we will send a link to choose a new one."
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send the link'}
        </Button>
      </form>
      <BackToLogin />
    </AccountCard>
  );
}

/** `/reset-password?token=…` — chooses a new password, then sends the person to sign in. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Something went wrong. Try the link again, or ask for a new one.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AccountCard
        title="Password changed"
        description="Your other sessions have been signed out. Sign in with the new password."
      >
        <p className="text-sm text-muted-foreground">
          <Link to="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </AccountCard>
    );
  }

  if (!token) {
    return (
      <AccountCard title="That link is incomplete" description="It has no token in it.">
        <p className="text-sm text-muted-foreground">
          <Link to="/forgot-password" className="underline underline-offset-4">
            Ask for a new link
          </Link>
        </p>
      </AccountCard>
    );
  }

  return (
    <AccountCard title="Choose a new password" description="At least eight characters.">
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || password.length < 8}>
          {busy ? 'Saving…' : 'Save the new password'}
        </Button>
      </form>
      <BackToLogin />
    </AccountCard>
  );
}
