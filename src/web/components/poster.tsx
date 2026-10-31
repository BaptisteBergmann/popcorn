import { useState, type ReactNode } from 'react';
import { Film, Tv } from 'lucide-react';
import type { TitleType } from '@shared/constants';
import { copy } from '@web/lib/copy';
import { cn } from '@web/lib/utils';

type PosterProps = {
  posterUrl: string | null;
  title: string;
  year: number | null;
  type: TitleType;
  className?: string;
  children?: ReactNode;
};

export function Poster({ posterUrl, title, year, type, className, children }: PosterProps) {
  // Remember which URL failed so a different poster (new props) gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = posterUrl !== null && failedUrl !== posterUrl;
  const Icon = type === 'movie' ? Film : Tv;

  return (
    <div className={cn('relative aspect-[2/3] overflow-hidden rounded-lg bg-muted', className)}>
      {showImage ? (
        <img
          src={posterUrl}
          alt={copy.posterAlt(title, year)}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(posterUrl)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 p-2 text-center text-muted-foreground">
          <Icon size={32} aria-hidden="true" />
          <span className="line-clamp-3 text-xs">{title}</span>
        </div>
      )}
      {children}
    </div>
  );
}
