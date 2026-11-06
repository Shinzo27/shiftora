import { createOrgRequest } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { Button, Card, Empty, ErrorBanner, Loading, TextField } from '../components/ui.js';
import { orgsApi } from '../lib/api.js';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../lib/forms.js';
import { useLogout, useSession } from '../lib/session.js';

/** After login: pick one of my organisations, or create the first one. */
export function OrgsPage() {
  const session = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
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
        void navigate(`/o/${org.id}/locations`);
      },
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <main className="mx-auto mt-16 max-w-xl space-y-6 px-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-teal-800">Hi {session.data?.name}</h1>
        <Button variant="secondary" onClick={() => logout.mutate()}>
          Log out
        </Button>
      </header>

      <Card title="Your organisations">
        {orgs.isPending ? (
          <Loading />
        ) : orgs.data?.length ? (
          <ul className="divide-y divide-slate-200">
            {orgs.data.map((org) => (
              <li key={org.id}>
                <Link
                  to={`/o/${org.id}/locations`}
                  className="flex items-center justify-between py-3 hover:text-teal-700"
                >
                  <span className="font-medium">{org.name}</span>
                  <span className="text-sm capitalize text-slate-500">{org.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>You're not in an organisation yet. Create one below, or ask for an invite.</Empty>
        )}
        <ErrorBanner message={errorMessage(orgs.error)} />
      </Card>

      <Card title="Create an organisation">
        <form className="flex items-start gap-3" onSubmit={onSubmit} noValidate>
          <div className="flex-1">
            <TextField label="Name" name="name" placeholder="Sunrise Clinic" error={errors.name} />
          </div>
          <Button type="submit" className="mt-6" disabled={create.isPending}>
            Create
          </Button>
        </form>
        <ErrorBanner message={errors.name ? null : errorMessage(create.error)} />
      </Card>
    </main>
  );
}
