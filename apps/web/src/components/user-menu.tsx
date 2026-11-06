import { Building2, ChevronsUpDown, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '@/lib/theme';
import { Link } from 'react-router';

import { initials } from '@/components/page';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogout, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * Avatar button with the user's name, a theme picker and log out.
 * `compact` shows only the avatar (top bars); otherwise name and email too (sidebar footer).
 */
export function UserMenu({
  compact = false,
  side = 'bottom',
}: {
  compact?: boolean;
  side?: 'bottom' | 'right' | 'top';
}) {
  const session = useSession();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  const user = session.data;
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          'flex items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          compact
            ? 'p-0.5'
            : 'w-full p-2 hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent',
        )}
      >
        <Avatar className="size-8 rounded-lg">
          <AvatarFallback className="rounded-lg bg-accent text-xs font-medium text-accent-foreground">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        {compact ? null : (
          <>
            <span className="grid min-w-0 flex-1 text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium text-foreground">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/orgs">
              <Building2 /> Switch organisation
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
