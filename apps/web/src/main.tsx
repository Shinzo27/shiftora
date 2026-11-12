import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { LogoMark } from '@/components/logo';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-client';
import { router } from '@/router';
import { ThemeProvider } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't retry what won't change on retry (validation, auth, not found).
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          {/* Routes are code-split: this covers the first chunk (login, orgs, a shell). */}
          <Suspense
            fallback={
              <div className="flex min-h-svh items-center justify-center" aria-busy="true">
                <LogoMark className="size-10 animate-pulse" />
              </div>
            }
          >
            <RouterProvider router={router} />
          </Suspense>
          <Toaster richColors closeButton position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
