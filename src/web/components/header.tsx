import { Plus, Popcorn } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { MemberChip } from '@web/components/member_chip';
import { OfflineBanner } from '@web/components/offline_banner';
import { Button } from '@web/components/ui/button';
import { copy } from '@web/lib/copy';
import { cn, containerClass } from '@web/lib/utils';

export function Header() {
  return (
    <header className="sticky top-0 z-40 bg-background pt-[env(safe-area-inset-top)]">
      <div className={cn(containerClass, 'flex h-14 items-center gap-4')}>
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md text-lg font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Popcorn className="text-primary" size={24} aria-hidden="true" />
          {copy.appName}
        </Link>
        <nav aria-label="Navigation" className="ml-4 hidden items-center gap-4 md:flex">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                'rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            {copy.navList}
          </NavLink>
          <Button asChild size="sm">
            <NavLink to="/add">
              <Plus aria-hidden="true" />
              {copy.navAdd}
            </NavLink>
          </Button>
        </nav>
        <div className="ml-auto">
          <MemberChip />
        </div>
      </div>
      <OfflineBanner />
    </header>
  );
}
