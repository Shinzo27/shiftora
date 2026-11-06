import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const styles =
    variant === 'primary'
      ? 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-700/50'
      : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50';
  return (
    <button
      className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function TextField({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        className={`mt-1 block w-full rounded-md border px-3 py-2 shadow-sm focus:ring-2 focus:ring-teal-600 focus:outline-none ${
          error ? 'border-red-400' : 'border-slate-300'
        }`}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error ? (
        <span className="mt-1 block text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {title ? <h2 className="mb-4 text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
    >
      {message}
    </p>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="p-6 text-sm text-slate-500">{label}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-slate-100 px-4 py-6 text-center text-sm text-slate-600">
      {children}
    </p>
  );
}
