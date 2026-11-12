import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { cn } from '@/lib/utils';

/**
 * Bottom sheet (vaul). On a phone it is the native gesture — drag down to dismiss; on a
 * desktop it becomes a dialog anchored to the bottom of the window.
 */
export function Drawer(props: ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

export function DrawerTrigger(props: ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerOverlay({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

export function DrawerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col rounded-t-2xl border-t bg-background pb-[max(1rem,env(safe-area-inset-bottom))] outline-none',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted"
        />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}

export function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn('space-y-1 px-5 pt-4 pb-2', className)}
      {...props}
    />
  );
}

export function DrawerBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-body"
      className={cn('overflow-y-auto px-5 pb-4', className)}
      {...props}
    />
  );
}

export function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn('mt-auto flex flex-col gap-2 px-5 pt-2', className)}
      {...props}
    />
  );
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

/** A close button for the sheet's corner, when the drag handle is not obvious enough. */
export function DrawerCloseButton({ label = 'Close' }: { label?: string }) {
  return (
    <DrawerPrimitive.Close
      className="absolute top-3 right-3 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={label}
    >
      <X className="size-4" />
    </DrawerPrimitive.Close>
  );
}
