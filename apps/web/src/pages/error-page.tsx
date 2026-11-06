import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';

/** Shown when a page crashes, instead of React Router's developer screen. */
export function ErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (import.meta.env.DEV) console.error(error);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {notFound ? 'Page not found' : 'Something went wrong'}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {notFound
            ? "That link doesn't go anywhere."
            : 'Sorry about that. Reload the page, and if it keeps happening, let us know.'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
