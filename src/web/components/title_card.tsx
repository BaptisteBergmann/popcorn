import { useState } from 'react';
import { Check, CircleOff, Undo2 } from 'lucide-react';
import type { TitleStatus } from '@shared/constants';
import { Poster } from '@web/components/poster';
import { RemoveDialog } from '@web/components/remove_dialog';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { type TitleDto, useSetStatus } from '@web/lib/api';
import { copy } from '@web/lib/copy';
import { useOnline } from '@web/lib/use_online';
import { cn } from '@web/lib/utils';

export function TitleCard({ item, tab }: { item: TitleDto; tab: TitleStatus }) {
  const { setStatus } = useSetStatus();
  const online = useOnline();
  const [leaving, setLeaving] = useState(false);
  const watchedTab = tab === 'watched';
  const typeLabel = item.type === 'movie' ? copy.typeMovie : copy.typeSeries;
  const meta = [item.year, typeLabel].filter(Boolean).join(' · ');

  const move = () =>
    setStatus({ id: item.id, title: item.title, from: tab, to: watchedTab ? 'to_watch' : 'watched' });

  const onToggle = () => {
    // Brief fade before the optimistic move; skipped for reduced motion.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return move();
    setLeaving(true);
    setTimeout(move, 150);
  };

  return (
    <article
      className={cn(
        'flex flex-col gap-1 transition duration-150 motion-reduce:transition-none',
        leaving && 'scale-95 opacity-0',
      )}
    >
      <Poster posterUrl={item.posterUrl} title={item.title} year={item.year} type={item.type}>
        {!item.hasImdb && (
          <Badge
            variant="outline"
            title={copy.noStremioDesc}
            className="absolute bottom-2 left-2 bg-background/85 backdrop-blur"
          >
            <CircleOff size={12} aria-hidden="true" />
            {copy.noStremio}
          </Badge>
        )}
      </Poster>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium">{item.title}</h3>
      <p className="text-xs text-muted-foreground">{meta}</p>
      {item.addedBy && <p className="text-xs text-muted-foreground">{copy.addedBy(item.addedBy)}</p>}
      <div className="mt-2 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={!online}
          onClick={onToggle}
          aria-label={watchedTab ? copy.markUnwatchedAria(item.title) : copy.markWatchedAria(item.title)}
        >
          {watchedTab ? <Undo2 aria-hidden="true" /> : <Check aria-hidden="true" />}
          {watchedTab ? copy.markUnwatched : copy.markWatched}
        </Button>
        <RemoveDialog id={item.id} title={item.title} disabled={!online} />
      </div>
    </article>
  );
}
