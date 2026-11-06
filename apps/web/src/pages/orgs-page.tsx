import { createOrgRequest, type OrgSummary } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { Logo } from '@/components/logo';
import { ErrorState, FormAlert } from '@/components/page';
import { TextField } from '@/components/text-field';
import { UserMenu } from '@/components/user-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { FieldGroup } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { orgsApi } from '@/lib/api';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';

/** After login: pick one of my organisations, or create one. */
export function OrgsPage() {
  const session = useSession();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  // ?new=1 (from the sidebar's org menu) opens the create dialog straight away.
  const [params, setParams] = useSearchParams();
  const creating = params.has('new');
  const setCreating = (open: boolean) => setParams(open ? { new: '1' } : {}, { replace: true });

  return (
    <div className="min-h-svh bg-muted/40">
      <header className="flex h-16 items-center justify-between border-b bg-background px-4 sm:px-8">
        <Logo />
        <UserMenu compact />
      </header>
      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-8 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">
              Hi {session.data?.name.split(' ')[0]} 👋
            </h1>
            <p className="text-muted-foreground">Choose an organisation to continue.</p>
          </div>
          {orgs.data?.length ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New organisation
            </Button>
          ) : null}
        </div>

        {orgs.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : orgs.isError ? (
          <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
        ) : orgs.data.length ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {orgs.data.map((org) => (
              <li key={org.id}>
                <OrgCard org={org} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="border bg-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2 />
              </EmptyMedia>
              <EmptyTitle>No organisations yet</EmptyTitle>
              <EmptyDescription>
                Create one for your clinic or shop, or ask your manager for an invite.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreating(true)}>
                <Plus /> Create organisation
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </main>
      <CreateOrgDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function OrgCard({ org }: { org: OrgSummary }) {
  return (
    <Link
      to={`/o/${org.id}`}
      className="group flex items-center gap-4 rounded-xl border bg-card p-5 shadow-xs transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-accent text-lg font-semibold text-accent-foreground">
        {org.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate font-medium">{org.name}</span>
        <Badge variant="secondary" className="capitalize">
          {org.role}
        </Badge>
      </span>
      <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

function CreateOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({ mutationFn: orgsApi.create });
  const [errors, setErrors] = useState<FieldErrors>({});

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createOrgRequest.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (org) => {
        void queryClient.invalidateQueries({ queryKey: ['orgs'] });
        toast.success(`${org.name} is ready`, { description: 'Add your first location next.' });
        void navigate(`/o/${org.id}/locations?new=1`);
      },
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create an organisation</DialogTitle>
          <DialogDescription>
            Usually your business name. You can add branches as locations next.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              label="Name"
              name="name"
              placeholder="Sunrise Clinic"
              autoFocus
              error={errors.name}
            />
            <FormAlert message={errors.name ? null : errorMessage(create.error)} />
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Spinner /> : null}
                Create
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
