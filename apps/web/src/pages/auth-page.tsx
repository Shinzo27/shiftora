import { loginRequest, signupRequest } from '@shiftora/shared';
import { BellRing, CalendarCheck2, MapPinCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';

import { Logo } from '@/components/logo';
import { FormAlert } from '@/components/page';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '@/lib/forms';
import { useLogin, useSession, useSignup } from '@/lib/session';

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

  const isLogin = mode === 'login';

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <main className="flex flex-col p-6 sm:p-10">
        <Link to="/" className="w-fit" aria-label="Shiftora home">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm space-y-8">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {isLogin ? 'Welcome back' : 'Create your account'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isLogin
                  ? 'Log in to plan shifts and see who is on today.'
                  : 'Set up your clinic or shop in under two minutes. Free for up to 10 staff.'}
              </p>
            </div>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                {isLogin ? null : (
                  <TextField
                    label="Your name"
                    name="name"
                    autoComplete="name"
                    placeholder="Asha Mehta"
                    error={errors.name}
                  />
                )}
                <TextField
                  label="Email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@clinic.in"
                  error={errors.email}
                />
                <TextField
                  label="Password"
                  name="password"
                  type="password"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  error={errors.password}
                  {...(isLogin ? {} : { hint: 'At least 8 characters' })}
                />
                <FormAlert message={errorMessage(mutation.error)} />
                <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
                  {mutation.isPending ? <Spinner /> : null}
                  {isLogin ? 'Log in' : 'Create account'}
                </Button>
              </FieldGroup>
            </form>
            <p className="text-center text-sm text-muted-foreground">
              {isLogin ? 'New to Shiftora? ' : 'Already have an account? '}
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                to={isLogin ? '/signup' : '/login'}
              >
                {isLogin ? 'Create an account' : 'Log in'}
              </Link>
            </p>
          </div>
        </div>
      </main>
      <Hero />
    </div>
  );
}

const features = [
  { icon: CalendarCheck2, text: 'Build the week in minutes, across every branch' },
  { icon: BellRing, text: 'Staff get their shifts on WhatsApp, not a photo of a whiteboard' },
  { icon: MapPinCheck, text: 'Geofenced clock-in and payroll-ready timesheets' },
];

/** The right-hand brand panel (desktop only): pitch + a mock of the schedule. */
function Hero() {
  return (
    <aside className="relative hidden overflow-hidden bg-hero text-hero-foreground lg:flex lg:flex-col lg:justify-center lg:p-16">
      <div
        aria-hidden="true"
        className="absolute inset-0 [background-image:radial-gradient(currentColor_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.12]"
      />
      <div
        aria-hidden="true"
        className="absolute -top-32 -right-32 size-96 rounded-full bg-hero-foreground/10 blur-3xl"
      />
      <div className="relative max-w-lg space-y-10">
        <div className="space-y-4">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight text-balance">
            Rotas your team actually reads.
          </h2>
          <ul className="space-y-3">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <MockSchedule />
      </div>
    </aside>
  );
}

const mockShifts = [
  { name: 'Asha M.', role: 'Nurse', time: '07:00 – 15:00', tone: 'bg-chart-1' },
  { name: 'Ravi K.', role: 'Reception', time: '09:00 – 17:00', tone: 'bg-chart-2' },
  { name: 'Nina D.', role: 'Nurse', time: '15:00 – 23:00', tone: 'bg-chart-3' },
  { name: 'Imran S.', role: 'Pharmacist', time: '22:00 – 06:00', tone: 'bg-chart-4' },
];

function MockSchedule() {
  return (
    <div
      aria-hidden="true"
      className="rotate-[-1.5deg] rounded-2xl bg-card p-5 text-card-foreground shadow-2xl ring-1 ring-black/5"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Andheri branch</div>
          <div className="text-xs text-muted-foreground">Tuesday, 10 Nov</div>
        </div>
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
          Published
        </span>
      </div>
      <ul className="space-y-2">
        {mockShifts.map((shift) => (
          <li
            key={shift.name}
            className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2"
          >
            <span className={`h-8 w-1 rounded-full ${shift.tone}`} />
            <span className="flex-1">
              <span className="block text-sm font-medium">{shift.name}</span>
              <span className="block text-xs text-muted-foreground">{shift.role}</span>
            </span>
            <span className="tabular text-xs text-muted-foreground">{shift.time}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
