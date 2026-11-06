import { useQuery } from '@tanstack/react-query';
import { Building2, LogOut, MapPin, Monitor, Moon, Plus, Search, Sun, Users } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { orgsApi } from '@/lib/api';
import { useOrg } from '@/lib/org-context';
import { useLogout } from '@/lib/session';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** ⌘K / Ctrl+K: jump to a page, switch location or org, run an action. */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const logout = useLogout();
  const { setTheme } = useTheme();
  const { orgId, role, locations, selectLocation } = useOrg();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list, enabled: open });
  const canManage = role === 'owner' || role === 'manager';

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function run(action: () => unknown) {
    setOpen(false);
    action();
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-8 w-9 justify-start gap-2 px-2 text-muted-foreground sm:w-56"
        aria-label="Search and commands"
      >
        <Search />
        <span className="hidden flex-1 text-left font-normal sm:inline">Search…</span>
        <KbdGroup className="hidden sm:inline-flex">
          <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Go to">
              <CommandItem onSelect={() => run(() => navigate(`/o/${orgId}/locations`))}>
                <MapPin /> Locations
              </CommandItem>
              {canManage ? (
                <CommandItem onSelect={() => run(() => navigate(`/o/${orgId}/employees`))}>
                  <Users /> Employees
                </CommandItem>
              ) : null}
            </CommandGroup>
            <CommandGroup heading="Create">
              {canManage ? (
                <CommandItem onSelect={() => run(() => navigate(`/o/${orgId}/employees?new=1`))}>
                  <Plus /> Add employee
                </CommandItem>
              ) : null}
              {role === 'owner' ? (
                <CommandItem onSelect={() => run(() => navigate(`/o/${orgId}/locations?new=1`))}>
                  <Plus /> Add location
                </CommandItem>
              ) : null}
            </CommandGroup>
            {locations.length > 1 ? (
              <CommandGroup heading="Switch location">
                <CommandItem onSelect={() => run(() => selectLocation(null))}>
                  <MapPin /> All locations
                </CommandItem>
                {locations.map((location) => (
                  <CommandItem
                    key={location.id}
                    value={`location ${location.name}`}
                    onSelect={() => run(() => selectLocation(location.id))}
                  >
                    <MapPin /> {location.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {orgs.data && orgs.data.length > 1 ? (
              <CommandGroup heading="Switch organisation">
                {orgs.data
                  .filter((org) => org.id !== orgId)
                  .map((org) => (
                    <CommandItem
                      key={org.id}
                      value={`org ${org.name}`}
                      onSelect={() => run(() => navigate(`/o/${org.id}`))}
                    >
                      <Building2 /> {org.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
            <CommandGroup heading="Preferences">
              <CommandItem onSelect={() => run(() => setTheme('light'))}>
                <Sun /> Light theme
              </CommandItem>
              <CommandItem onSelect={() => run(() => setTheme('dark'))}>
                <Moon /> Dark theme
              </CommandItem>
              <CommandItem onSelect={() => run(() => setTheme('system'))}>
                <Monitor /> System theme
              </CommandItem>
              <CommandItem onSelect={() => run(() => logout.mutate())}>
                <LogOut /> Log out
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
