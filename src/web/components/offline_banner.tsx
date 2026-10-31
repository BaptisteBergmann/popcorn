import { WifiOff } from 'lucide-react';
import { useOnline } from '@web/lib/use_online';
import { copy } from '@web/lib/copy';
import { cn, containerClass } from '@web/lib/utils';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="bg-muted text-sm">
      <div className={cn(containerClass, 'flex items-center gap-2 py-2')}>
        <WifiOff size={16} aria-hidden="true" />
        {copy.offlineBanner}
      </div>
    </div>
  );
}
