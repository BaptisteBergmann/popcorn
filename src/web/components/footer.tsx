import { copy } from '@web/lib/copy';
import { cn, containerClass } from '@web/lib/utils';

export function Footer() {
  return (
    <footer
      className={cn(
        containerClass,
        'flex flex-col items-center gap-2 pt-6 pb-[calc(64px+env(safe-area-inset-bottom)+1.5rem)] text-center text-xs text-muted-foreground md:items-start md:pb-8 md:text-left',
      )}
    >
      <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" aria-label="TMDB">
        <img src={`${import.meta.env.BASE_URL}tmdb.svg`} alt="" className="h-3" />
      </a>
      <p>{copy.footerTmdb}</p>
    </footer>
  );
}
