import { assignableRoles, type AssignableRole } from '@shiftora/domain';
import {
  email as emailSchema,
  type CreateInviteResponse,
  type Invite,
  type Member,
  type MemberLocations,
} from '@shiftora/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Mail, MoreHorizontal, Plus, ShieldCheck, UserCog } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ErrorState, FormAlert, initials, PageHeader } from '@/components/page';
import { TextField } from '@/components/text-field';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { invitesApi, locationsApi, membersApi } from '@/lib/api';
import { apiFieldErrors, errorMessage, type FieldErrors } from '@/lib/forms';
import { useOrg } from '@/lib/org-context';
import { useSession } from '@/lib/session';

/**
 * Who may sign in, and what each of them may touch (W7½ UI1).
 *
 * Owners change things here; managers are given the read-only view, because the server refuses
 * their writes anyway and a menu that always fails is worse than no menu. Every refusal that can
 * only be decided on the server — demoting the last owner, removing yourself — is shown as the
 * server's own sentence rather than a second, drifting copy of the rule.
 */

const roleLabels: Record<AssignableRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'Staff',
};

const roleBlurb: Record<AssignableRole, string> = {
  owner: 'Everything, including billing and who else is an owner',
  manager: 'Plans shifts, approves time and payroll, no org settings',
  employee: 'Sees their own shifts and clocks in',
};

/** The link a person opens to join. Same route the email points at. */
function inviteUrl(code: string): string {
  return `${window.location.origin}/invite/${encodeURIComponent(code)}`;
}

export function TeamPage() {
  const { orgId, role, locations } = useOrg();
  const session = useSession();
  const isOwner = role === 'owner';
  const queryClient = useQueryClient();

  const members = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => membersApi.list(orgId),
  });
  const invites = useQuery({
    queryKey: ['invites', orgId],
    queryFn: () => invitesApi.list(orgId),
  });
  const allLocations = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => locationsApi.list(orgId),
  });

  // Branches per member: one small request each. A team is a handful of people, and the answer
  // changes per member, so one request per row is honest — and cached, so it is paid once.
  const scopes = useQueries({
    queries: (members.data ?? []).map((member) => ({
      queryKey: ['member-locations', orgId, member.userId],
      queryFn: () => membersApi.locations(orgId, member.userId),
      staleTime: 30_000,
    })),
  });
  const scopeOf = useMemo(() => {
    const byUser = new Map<string, MemberLocations | undefined>();
    (members.data ?? []).forEach((member, index) => byUser.set(member.userId, scopes[index]?.data));
    return byUser;
  }, [members.data, scopes]);

  const locationName = new Map((allLocations.data ?? locations).map((l) => [l.id, l.name]));

  const [inviting, setInviting] = useState(false);
  const [shownInvite, setShownInvite] = useState<CreateInviteResponse | null>(null);
  const [editingBranches, setEditingBranches] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const changeRole = useMutation({
    mutationFn: ({ member, role: next }: { member: Member; role: AssignableRole }) =>
      membersApi.changeRole(orgId, member.userId, next),
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
      toast.success(`${member.name} is now ${roleLabels[member.role as AssignableRole]}`);
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not change the role'),
  });

  const remove = useMutation({
    mutationFn: (member: Member) => membersApi.remove(orgId, member.userId),
    onSuccess: (_unused, member) => {
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
      setRemoving(null);
      toast.success(`${member.name} no longer has access`);
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not remove this person'),
  });

  const revoke = useMutation({
    mutationFn: (invite: Invite) => invitesApi.revoke(orgId, invite.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invites', orgId] });
      toast.success('Invitation revoked');
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not revoke it'),
  });

  const reinvite = useMutation({
    mutationFn: async (invite: Invite) => {
      const body = { email: invite.email, role: invite.role };
      await invitesApi.revoke(orgId, invite.id);
      return invitesApi.create(orgId, body);
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['invites', orgId] });
      setShownInvite(created);
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not make a new link'),
  });

  const rows = members.data ?? [];
  const pending = invites.data ?? [];
  const me = session.data?.id;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Team"
        description="Who can sign in to this clinic, and what each of them may touch."
        actions={
          isOwner ? (
            <Button onClick={() => setInviting(true)}>
              <Plus /> Invite someone
            </Button>
          ) : null
        }
      />

      {members.isPending ? (
        <MembersSkeleton />
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} />
      ) : (
        <section className="space-y-3" aria-labelledby="members-heading">
          <h2 id="members-heading" className="text-sm font-medium text-muted-foreground">
            People with access · {rows.length}
          </h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Branches</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  {isOwner ? <TableHead className="w-10" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((member) => {
                  const scope = scopeOf.get(member.userId);
                  const isMe = member.userId === me;
                  return (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarFallback>{initials(member.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {member.name}
                              {/* A real space, not a margin: copied text and screen readers
                                  should read "Priya Nair (you)", not "Priya Nairyou". */}
                              {isMe ? (
                                <span className="text-xs font-normal text-muted-foreground">
                                  {' '}
                                  (you)
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={member.role === 'owner' ? 'default' : 'secondary'}
                          className="capitalize"
                        >
                          {member.role === 'owner' ? <ShieldCheck /> : null}
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {describeScope(member, scope, locationName)}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {new Date(member.joinedAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </TableCell>
                      {isOwner ? (
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Actions for ${member.name}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuLabel className="font-normal text-muted-foreground">
                                Change role
                              </DropdownMenuLabel>
                              {assignableRoles.map((next) => (
                                <DropdownMenuItem
                                  key={next}
                                  disabled={next === member.role}
                                  onSelect={() => changeRole.mutate({ member, role: next })}
                                >
                                  <span className="flex-1">{roleLabels[next]}</span>
                                  {next === member.role ? <Check /> : null}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={member.role === 'owner'}
                                onSelect={() => setEditingBranches(member)}
                              >
                                <UserCog /> Branches…
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setRemoving(member)}
                              >
                                {isMe ? 'Leave this organisation' : 'Remove from team'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {isOwner
              ? 'A change here takes effect on that person’s next request — nothing to restart.'
              : 'Only an owner can change roles, branches or remove someone.'}
          </p>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="invites-heading">
        <h2 id="invites-heading" className="text-sm font-medium text-muted-foreground">
          Invitations waiting
        </h2>
        {invites.isError ? (
          <ErrorState error={invites.error} onRetry={() => void invites.refetch()} />
        ) : pending.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Mail />
              </EmptyMedia>
              <EmptyTitle>No open invitations</EmptyTitle>
              <EmptyDescription>
                {isOwner
                  ? 'Invite a manager or a colleague; the link stops working after seven days or once it is used.'
                  : 'When an owner invites someone, it shows here until they join.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Expires</TableHead>
                  {isOwner ? <TableHead className="w-10" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">{invite.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {invite.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {expiresIn(invite.expiresAt)}
                    </TableCell>
                    {isOwner ? (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for the invitation to ${invite.email}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onSelect={() => reinvite.mutate(invite)}>
                              <Copy /> Show a fresh link
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => revoke.mutate(invite)}
                            >
                              Revoke invitation
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {inviting ? (
        <InviteDialog
          orgId={orgId}
          onClose={() => setInviting(false)}
          onCreated={(created) => {
            setInviting(false);
            setShownInvite(created);
          }}
        />
      ) : null}

      {shownInvite ? (
        <InviteLinkDialog response={shownInvite} onClose={() => setShownInvite(null)} />
      ) : null}

      {editingBranches && scopeOf.get(editingBranches.userId) ? (
        <BranchesDialog
          key={editingBranches.userId}
          member={editingBranches}
          orgId={orgId}
          current={scopeOf.get(editingBranches.userId)!}
          onClose={() => setEditingBranches(null)}
        />
      ) : null}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {removing?.userId === me ? 'Leave this organisation?' : `Remove ${removing?.name}?`}
            </DialogTitle>
            <DialogDescription>
              {removing?.userId === me
                ? 'You lose access to this organisation’s schedules and records. An owner has to invite you back.'
                : 'They stop seeing this clinic immediately. Their shifts stay on the rota and need re-assigning.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Keep access
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing)}
            >
              {remove.isPending ? <Spinner /> : null}
              {removing?.userId === me ? 'Leave' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "Every branch" when unrestricted, otherwise the names, or "…" while they load. */
function describeScope(
  member: Member,
  scope: MemberLocations | undefined,
  locationName: Map<string, string>,
): string {
  if (member.role === 'owner') return 'Every branch';
  if (!scope) return '…';
  if (!scope.restricted) return 'Every branch';
  const names = scope.locationIds.map((id) => locationName.get(id)).filter(Boolean);
  return names.length ? names.join(', ') : 'No branch yet';
}

function expiresIn(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

function MembersSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading the team">
      <Skeleton className="h-4 w-40" />
      <div className="space-y-px overflow-hidden rounded-xl border">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 bg-card p-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function InviteDialog({
  orgId,
  onClose,
  onCreated,
}: {
  orgId: string;
  onClose: () => void;
  onCreated: (created: CreateInviteResponse) => void;
}) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [role, setRole] = useState<AssignableRole>('employee');
  const create = useMutation({
    mutationFn: (input: { email: string; role: AssignableRole }) =>
      invitesApi.create(orgId, input),
    onSuccess: (created) => {
      // The pending list is another query: without this the new invitation is invisible until
      // the page is reloaded.
      void queryClient.invalidateQueries({ queryKey: ['invites', orgId] });
      toast.success(`Invitation emailed to ${created.invite.email}`);
      onCreated(created);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entered = new FormData(event.currentTarget).get('email');
    const email = typeof entered === 'string' ? entered : '';
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      return setErrors({ email: parsed.error.issues[0]?.message ?? 'Enter an email address' });
    }
    setErrors({});
    create.mutate(
      { email: parsed.data, role },
      {
        onError: (error) =>
          setErrors({ ...apiFieldErrors(error), form: errorMessage(error) ?? 'Could not invite' }),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
            <DialogDescription>
              They get an email with a link that works for seven days. If they have no account
              yet, they create one with this address.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <TextField
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nurse@clinic.test"
              error={errors.email}
              autoFocus
            />
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Select value={role} onValueChange={(value) => setRole(value as AssignableRole)}>
                <SelectTrigger id="invite-role" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((option) => (
                    <SelectItem key={option} value={option}>
                      {roleLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{roleBlurb[role]}</p>
            </Field>
            <FormAlert message={errors.form ?? null} />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <Mail />}
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The code is only known at creation, so this is where a manager can copy it. */
function InviteLinkDialog({
  response,
  onClose,
}: {
  response: CreateInviteResponse;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(response.code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copied');
    } catch {
      // Clipboard permissions vary; the field is selectable as a fallback.
      toast.error('Could not copy — select the link and copy it instead');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invitation on its way</DialogTitle>
          <DialogDescription>
            We emailed {response.invite.email}. You can also send the link yourself — it works
            once, for seven days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <FieldLabel htmlFor="invite-link">Link</FieldLabel>
          <div className="flex gap-2">
            <input
              id="invite-link"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-lg border bg-muted/40 px-3 font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The email contains the same link. Showing a fresh one replaces it.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BranchesDialog({
  member,
  orgId,
  current,
  onClose,
}: {
  member: Member;
  orgId: string;
  current: MemberLocations;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const allLocations = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => locationsApi.list(orgId),
  });
  const [selected, setSelected] = useState<string[]>(current.locationIds);

  const save = useMutation({
    mutationFn: () => membersApi.setLocations(orgId, member.userId, selected),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: ['member-locations', orgId, member.userId] });
      onClose();
      toast.success(
        next.restricted
          ? `${member.name} is limited to ${selected.length} branch${selected.length === 1 ? '' : 'es'}`
          : `${member.name} can use every branch`,
      );
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not save the branches'),
  });

  const locations = allLocations.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Branches for {member.name}</DialogTitle>
          <DialogDescription>
            Choose none to give access to every branch, including ones added later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2" role="group" aria-label="Branches">
          {locations.map((location) => {
            const checked = selected.includes(location.id);
            return (
              <label
                key={location.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm has-checked:border-primary/40 has-checked:bg-primary/5"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) =>
                    setSelected((ids) =>
                      value === true ? [...ids, location.id] : ids.filter((id) => id !== location.id),
                    )
                  }
                />
                <span className="flex-1">{location.name}</span>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner /> : null}
            Save branches
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
