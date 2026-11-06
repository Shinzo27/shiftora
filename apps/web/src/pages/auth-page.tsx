import { loginRequest, signupRequest } from '@shiftora/shared';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';

import { Button, Card, ErrorBanner, TextField } from '../components/ui.js';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../lib/forms.js';
import { useLogin, useSession, useSignup } from '../lib/session.js';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const session = useSession();
  const login = useLogin();
  const signup = useSignup();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = mode === 'login' ? login : signup;

  if (session.data) return <Navigate to="/orgs" replace />;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const onSuccess = () => void navigate('/orgs');
    const onError = (error: unknown) => setErrors(apiFieldErrors(error));

    if (mode === 'login') {
      const parsed = loginRequest.safeParse(values);
      if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
      setErrors({});
      login.mutate(parsed.data, { onSuccess, onError });
    } else {
      const parsed = signupRequest.safeParse(values);
      if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
      setErrors({});
      signup.mutate(parsed.data, { onSuccess, onError });
    }
  }

  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-6 text-center text-2xl font-bold text-teal-800">Shiftora</h1>
      <Card title={mode === 'login' ? 'Log in' : 'Create your account'}>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {mode === 'signup' ? (
            <TextField label="Your name" name="name" autoComplete="name" error={errors.name} />
          ) : null}
          <TextField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            error={errors.email}
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            error={errors.password}
            {...(mode === 'signup' ? { hint: 'At least 8 characters' } : {})}
          />
          <ErrorBanner message={errorMessage(mutation.error)} />
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mode === 'login' ? 'Log in' : 'Sign up'}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">
        {mode === 'login' ? (
          <>
            New here?{' '}
            <Link className="text-teal-700 underline" to="/signup">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Have an account?{' '}
            <Link className="text-teal-700 underline" to="/login">
              Log in
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
