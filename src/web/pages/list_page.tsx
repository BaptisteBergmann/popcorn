import { useEffect } from 'react';
import { Check, Popcorn, WifiOff } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@web/components/ui/toggle_group';
import { useTitles } from '@web/lib/api';
import { copy } from '@web/lib/copy';
import { useMember } from '@web/lib/member';
import { useOnline } from '@web/lib/use_online';

type TypeFilter = 'all' | TitleType;

function TabPanel({
  status,
  filter,
  onResetFilter,
}: {
  status: TitleStatus;
  filter: TypeFilter;
  onResetFilter: () => void;
}) {
  // Wait for the member: fetching with null would flash a skeleton and refetch once it resolves.
  const { member } = useMember();
  const query = useTitles(status, member, member !== null);
  const online = useOnline();
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

  const filtered = filter === 'all' ? items : items.filter((t) => t.type === filter);
  if (filtered.length === 0) {
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
  return <TitleGrid items={filtered} tab={status} />;
}

export function ListPage() {
  const [params, setParams] = useSearchParams();
  const tab: TitleStatus = params.get('tab') === 'watched' ? 'watched' : 'to_watch';
  const rawType = params.get('type');
  const filter: TypeFilter = rawType === 'movie' || rawType === 'series' ? rawType : 'all';

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
        <div className="pt-3">
          <TabsContent value="to_watch">
            <TabPanel status="to_watch" filter={filter} onResetFilter={() => update('type', null)} />
          </TabsContent>
          <TabsContent value="watched">
            <TabPanel status="watched" filter={filter} onResetFilter={() => update('type', null)} />
          </TabsContent>
        </div>
      </Tabs>
      <StremioCard />
    </div>
  );
}
