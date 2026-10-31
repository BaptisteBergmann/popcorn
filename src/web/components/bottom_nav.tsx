import { LayoutGrid, Plus } from 'lucide-react';
import { NavLink } from 'react-router';
import { copy } from '@web/lib/copy';
import { cn } from '@web/lib/utils';

const itemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
    isActive ? 'text-primary' : 'text-muted-foreground',
  );

export function BottomNav() {
  return (
    <nav
      aria-label="Navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid grid-cols-2">
        <NavLink to="/" end className={itemClass}>
          <LayoutGrid size={22} aria-hidden="true" />
          {copy.navList}
        </NavLink>
        <NavLink to="/add" className={itemClass}>
          <Plus size={22} aria-hidden="true" />
          {copy.navAdd}
        </NavLink>
      </div>
    </nav>
  );
}
