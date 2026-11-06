import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Check, Popcorn, Search, WifiOff, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { TitleStatus, TitleType } from '@shared/constants';
import { EmptyState } from '@web/components/empty_state';
import { ErrorState } from '@web/components/error_state';
import { InstallHint } from '@web/components/install_hint';
import { StremioCard } from '@web/components/stremio_card';
import { TitleGrid } from '@web/components/title_grid';
import { TitleGridSkeleton } from '@web/components/title_grid_skeleton';
import { Button } from '@web/components/ui/button';
import { Input } from '@web/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@web/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@web/components/ui/toggle_group';
import { useTitles } from '@web/lib/api';
import { copy } from '@web/lib/copy';
import {
  MAX_QUERY_LENGTH,
  matchesQuery,
  normalizeForSearch,
  parseSort,
  sortTitles,
  type ListSort,
} from '@web/lib/list_filters';
import { useMember } from '@web/lib/member';
import { useDebouncedValue } from '@web/lib/use_debounced_value';
import { useOnline } from '@web/lib/use_online';

type TypeFilter = 'all' | TitleType;

function TabPanel({
  status,
  filter,
  q,
  rawSort,
  onResetFilter,
  onResetSearch,
}: {
  status: TitleStatus;
  filter: TypeFilter;
  q: string;
  rawSort: string | null;
  onResetFilter: () => void;
  onResetSearch: () => void;
}) {
  // Wait for the member: fetching with null would flash a skeleton and refetch once it resolves.
  const { member, membersFailed, retryMembers } = useMember();
  const query = useTitles(status, member, member !== null);
  const online = useOnline();
  const sort: ListSort = parseSort(rawSort, status);
  const normalizedQuery = normalizeForSearch(q);
  const data = query.data;
  // Sort a copy at render time so optimistic cache updates stay correct under any sort.
  const visible = useMemo(() => {
    const byType = !data || filter === 'all' ? (data ?? []) : data.filter((t) => t.type === filter);
    const matched = byType.filter((t) => matchesQuery(t.title, normalizedQuery));
    return sortTitles(matched, sort);
  }, [data, filter, normalizedQuery, sort]);
  const isRefetchError = query.isRefetchError;

  useEffect(() => {
    if (isRefetchError) toast(copy.toastStale);
  }, [isRefetchError]);

  if (query.isPending) {
    if (!online) {
      return (
        <EmptyState
          icon={WifiOff}
          iconClassName="text-muted-foreground"
          title={copy.offlineNoCacheTitle}
          body={copy.offlineNoCacheBody}
        />
      );
    }
    if (membersFailed) {
      return (
        <ErrorState title={copy.errorListTitle} body={copy.errorListBody} onRetry={retryMembers} />
      );
    }
    return <TitleGridSkeleton />;
  }
  if (query.isError && !query.data) {
    return (
      <ErrorState
        title={copy.errorListTitle}
        body={copy.errorListBody}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const items = query.data ?? [];
  if (items.length === 0) {
    return status === 'to_watch' ? (
      <EmptyState
        icon={Popcorn}
        title={copy.emptyToWatchTitle}
        body={copy.emptyToWatchBody}
        action={
          <Button asChild>
            <Link to="/add">{copy.emptyToWatchCta}</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState icon={Check} title={copy.emptyWatchedTitle} body={copy.emptyWatchedBody} />
    );
  }

  if (visible.length === 0 && normalizedQuery !== '') {
    return (
      <EmptyState
        icon={Search}
        iconClassName="text-muted-foreground"
        title={copy.searchEmptyTitle(q)}
        action={
          <Button variant="link" onClick={onResetSearch}>
            {copy.searchEmptyReset}
          </Button>
        }
      />
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={Popcorn}
        title={filter === 'movie' ? copy.emptyFilterMovies : copy.emptyFilterSeries}
        action={
          <Button variant="link" onClick={onResetFilter}>
            {copy.emptyFilterReset}
          </Button>
        }
      />
    );
  }
  return (
    <>
      <p role="status" aria-live="polite" className="pb-3 text-sm text-muted-foreground empty:hidden">
        {normalizedQuery !== '' ? copy.searchResultCount(visible.length) : ''}
      </p>
      <TitleGrid items={visible} tab={status} />
    </>
  );
}

export function ListPage() {
  const [params, setParams] = useSearchParams();
  const tab: TitleStatus = params.get('tab') === 'watched' ? 'watched' : 'to_watch';
  const rawType = params.get('type');
  const filter: TypeFilter = rawType === 'movie' || rawType === 'series' ? rawType : 'all';

  const q = (params.get('q') ?? '').slice(0, MAX_QUERY_LENGTH);
  const rawSort = params.get('sort');
  const sort = parseSort(rawSort, tab);

  // The field keeps its own state for responsiveness; the URL gets the debounced value.
  const [input, setInput] = useState(q);
  const debouncedInput = useDebouncedValue(input, 200);
  const inputRef = useRef<HTMLInputElement>(null);

  const { member } = useMember();
  const toWatch = useTitles('to_watch', member, member !== null);
  const watched = useTitles('watched', member, member !== null);

  useEffect(() => {
    document.title = copy.appName;
  }, []);

  // Tab and filter live in the URL so they survive a reload.
  const update = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const updateMany = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    const next = debouncedInput.trim();
    setParams(
      (prev) => {
        if ((prev.get('q') ?? '') === next) return prev;
        const nextParams = new URLSearchParams(prev);
        if (next) nextParams.set('q', next);
        else nextParams.delete('q');
        return nextParams;
      },
      { replace: true },
    );
  }, [debouncedInput, setParams]);

  const clearSearch = () => {
    setInput('');
    update('q', null);
  };
  const resetSearch = () => {
    setInput('');
    updateMany({ q: null, type: null });
  };
  const hasTitles = (toWatch.data?.length ?? 0) > 0 || (watched.data?.length ?? 0) > 0;

  const count = (n: number | undefined) => (n === undefined ? '' : ` · ${n}`);

  return (
    <div>
      <h1 className="sr-only">{copy.listH1}</h1>
      <InstallHint listLoaded={toWatch.isSuccess} />
      <Tabs
        value={tab}
        onValueChange={(v) => update('tab', v === 'watched' ? 'watched' : null)}
        className="gap-3"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <TabsList aria-label={copy.statusAria}>
            <TabsTrigger id="tab-to-watch" value="to_watch">
              {copy.tabToWatch}
              {count(toWatch.data?.length)}
            </TabsTrigger>
            <TabsTrigger value="watched">
              {copy.tabWatched}
              {count(watched.data?.length)}
            </TabsTrigger>
          </TabsList>
          <ToggleGroup
            type="single"
            aria-label={copy.typeAria}
            value={filter}
            // Deselecting the active item yields '' and is ignored: one value is always set.
            onValueChange={(v) => v && update('type', v === 'all' ? null : v)}
          >
            <ToggleGroupItem value="all">{copy.filterAll}</ToggleGroupItem>
            <ToggleGroupItem value="movie">{copy.filterMovies}</ToggleGroupItem>
            <ToggleGroupItem value="series">{copy.filterSeries}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {hasTitles && (
          <div role="search" className="flex flex-col gap-3 sm:flex-row">
            <div className="relative sm:max-w-sm sm:flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                size={18}
                aria-hidden="true"
              />
              <Input
                ref={inputRef}
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                maxLength={MAX_QUERY_LENGTH}
                value={input}
                placeholder={copy.listSearchPlaceholder}
                aria-label={copy.listSearchAria}
                className="h-11 pr-12 pl-10 [&::-webkit-search-cancel-button]:hidden"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && input) {
                    e.preventDefault();
                    clearSearch();
                  } else if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
              />
              {input && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-0 right-0 h-11 w-11"
                  aria-label={copy.listSearchClearAria}
                  onClick={() => {
                    clearSearch();
                    inputRef.current?.focus();
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </div>
            <Select value={sort} onValueChange={(v) => update('sort', v === 'added' ? null : v)}>
              <SelectTrigger aria-label={copy.sortAria} className="sm:w-52">
                <ArrowUpDown size={16} className="text-muted-foreground" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="added">{copy.sortAdded}</SelectItem>
                <SelectItem value="title">{copy.sortTitle}</SelectItem>
                <SelectItem value="year_desc">{copy.sortYearDesc}</SelectItem>
                <SelectItem value="year_asc">{copy.sortYearAsc}</SelectItem>
                {tab === 'watched' && <SelectItem value="watched">{copy.sortWatched}</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="pt-3">
          <TabsContent value="to_watch">
            <TabPanel
              status="to_watch"
              filter={filter}
              q={q}
              rawSort={rawSort}
              onResetFilter={() => update('type', null)}
              onResetSearch={resetSearch}
            />
          </TabsContent>
          <TabsContent value="watched">
            <TabPanel
              status="watched"
              filter={filter}
              q={q}
              rawSort={rawSort}
              onResetFilter={() => update('type', null)}
              onResetSearch={resetSearch}
            />
          </TabsContent>
        </div>
      </Tabs>
      <StremioCard />
    </div>
  );
}
