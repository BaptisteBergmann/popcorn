import { Skeleton } from '@web/components/ui/skeleton';
import { gridClass } from '@web/components/title_grid';

export function TitleGridSkeleton() {
  return (
    <div className={gridClass} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-[2/3] rounded-lg" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-1 h-11" />
        </div>
      ))}
    </div>
  );
}
