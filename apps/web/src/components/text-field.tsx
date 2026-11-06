import { useId, type ComponentProps } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** Label + input + hint or error, wired up for screen readers (aria-invalid, aria-describedby). */
export function TextField({
  label,
  error,
  hint,
  className,
  ...props
}: ComponentProps<typeof Input> & { label: string; error?: string | undefined; hint?: string }) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        {...props}
      />
      {error ? (
        <FieldError id={messageId}>{error}</FieldError>
      ) : hint ? (
        <FieldDescription id={messageId}>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}
