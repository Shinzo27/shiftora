import { cn } from '@/lib/utils';

/** The Shiftora mark: a rounded tile with a stylised S (also used as the favicon). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path
        d="M9 12.5c0-2 1.8-3.5 4.5-3.5H22v3.5h-8.2c-.6 0-.8.3-.8.6 0 .4.3.6.8.7l4.6.7c2.6.4 4.6 1.7 4.6 4.3 0 2.6-2.1 4.2-5 4.2H9v-3.5h8.8c.7 0 1-.3 1-.7 0-.4-.3-.6-1-.7l-4.4-.7C10.8 17.1 9 15.6 9 12.5Z"
        className="fill-brand-foreground"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <LogoMark />
      <span className="text-lg">Shiftora</span>
    </span>
  );
}
