import { useEffect, useRef, useState } from 'react';
import { Check, Gift, Search, WifiOff, X } from 'lucide-react';
import { EmptyState } from '@web/components/empty_state';
import { ErrorState } from '@web/components/error_state';
import { SearchResultRow } from '@web/components/search_result_row';
import { Button } from '@web/components/ui/button';
import { Input } from '@web/components/ui/input';
import { Skeleton } from '@web/components/ui/skeleton';
import { useSearch } from '@web/lib/api';
import { copy } from '@web/lib/copy';
import { useMember } from '@web/lib/member';
import { useDebouncedValue } from '@web/lib/use_debounced_value';
import { useOnline } from '@web/lib/use_online';
import { cn } from '@web/lib/utils';

const SLOW_AFTER_MS = 3000;

export function AddPage() {
  const online = useOnline();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  // Enter searches immediately; `forced` is the trimmed text it was pressed with.
  const [forced, setForced] = useState<string | null>(null);
  const [slowFor, setSlowFor] = useState<string | null>(null);
  // Local on purpose: never persisted, so it resets to off when leaving the page.
  const [surprise, setSurprise] = useState(false);

  const trimmed = input.trim();
  const debounced = useDebouncedValue(trimmed, 350);
  const q = forced === trimmed ? trimmed : debounced;
  const active = trimmed.length >= 2;

  const { member } = useMember();
  const search = useSearch(active ? q : '', member);

  useEffect(() => {
    document.title = copy.addPageTitle;
  }, []);

  const loading = search.isFetching && active;
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlowFor(q), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [loading, q]);
  const slow = loading && slowFor === q;

  const clear = () => {
    setInput('');
    setForced(null);
    inputRef.current?.focus();
  };

  const renderResults = () => {
    if (!online) {
      return (
        <EmptyState
          icon={WifiOff}
          iconClassName="text-muted-foreground"
          title={copy.addOfflineTitle}
          body={copy.addOfflineBody}
        />
      );
    }
    if (!active) {
      return (
        <EmptyState
          icon={Search}
          iconClassName="text-muted-foreground"
          title={copy.addIdleTitle}
          body={copy.addIdleBody}
        />
      );
    }
    if (search.isError) {
      return <ErrorState title={copy.addError} onRetry={() => void search.refetch()} />;
    }
    if (!search.data) {
      return (
        <ul className="flex flex-col gap-3" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg bg-card p-2">
              <Skeleton className="h-[84px] w-14 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-11 w-28" />
            </li>
          ))}
        </ul>
      );
    }
    if (search.data.length === 0) {
      return (
        <EmptyState
          icon={Search}
          iconClassName="text-muted-foreground"
          title={copy.addEmptyTitle(trimmed)}
          body={copy.addEmptyBody}
        />
      );
    }
    return (
      <ul className={search.isPlaceholderData ? 'flex flex-col gap-3 opacity-60' : 'flex flex-col gap-3'}>
        {search.data.map((hit) => (
          <SearchResultRow key={`${hit.type}:${hit.tmdbId}`} hit={hit} surprise={surprise} />
        ))}
      </ul>
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="sr-only">{copy.addH1}</h1>
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 bg-background pb-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            size={18}
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            autoFocus
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={100}
            disabled={!online}
            value={input}
            placeholder={copy.addPlaceholder}
            aria-label={copy.addSearchAria}
            className="h-12 pr-12 pl-10 [&::-webkit-search-cancel-button]:hidden"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setForced(trimmed)}
          />
          {input && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-0.5 right-0 h-11 w-11"
              aria-label={copy.addClearAria}
              onClick={clear}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          className={cn('mt-2 h-11', surprise && 'border-primary bg-secondary text-foreground')}
          aria-pressed={surprise}
          aria-describedby={surprise ? 'surprise-help' : undefined}
          disabled={!online}
          onClick={() => setSurprise((v) => !v)}
        >
          <Gift aria-hidden="true" />
          {copy.surpriseToggle}
          {surprise && <Check aria-hidden="true" />}
        </Button>
        {surprise && (
          <p id="surprise-help" className="pt-2 text-sm text-muted-foreground">
            {copy.surpriseToggleHelp}
          </p>
        )}
        <div role="status" className="sr-only">
          {surprise ? copy.surpriseOnAnnounce : copy.surpriseOffAnnounce}
        </div>
        {slow && (
          <p role="status" className="pt-2 text-sm text-muted-foreground">
            {copy.addSlow}
          </p>
        )}
      </div>
      <div role="status" className="sr-only">
        {active && search.data ? copy.addResultsCount(search.data.length) : ''}
      </div>
      {renderResults()}
    </div>
  );
}
