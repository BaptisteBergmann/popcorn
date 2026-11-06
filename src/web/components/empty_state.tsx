import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  iconClassName = 'text-primary',
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  iconClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <Icon size={48} className={iconClassName} aria-hidden="true" />
      <p className="text-lg font-semibold [overflow-wrap:anywhere]">{title}</p>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
      {action}
    </div>
  );
}
