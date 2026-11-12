import type { ReactNode } from 'react';

/**
 * One line of a `<dl>`: label on the left with its icon, value on the right.
 *
 * The markup matters: a `<div>` inside a `<dl>` may only wrap `dt`/`dd` pairs, so the icon lives
 * *inside* its `<dt>` instead of beside it (axe's `definition-list` rule, and screen readers
 * announce the label with its icon rather than as stray text).
 */
export function DefinitionRow({
  icon,
  label,
  children,
  align = 'center',
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div className={`flex gap-2 py-3 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <dt className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="ml-auto min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}
