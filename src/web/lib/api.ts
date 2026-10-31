import {
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { hc, type InferResponseType } from 'hono/client';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { TitleStatus, TitleType } from '@shared/constants';
import type { AppType } from '@server/app';
import { copy } from '@web/lib/copy';
import { setNetworkFailed } from '@web/lib/use_online';

// The app lives under /<token>/; the first path segment is the token.
export const token = window.location.pathname.split('/')[1] ?? '';
const client = hc<AppType>(`${window.location.origin}/${token}`);

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
}

export type TitleDto = InferResponseType<typeof client.api.titles.$get, 200>[number];
export type SearchHitDto = InferResponseType<typeof client.api.search.$get, 200>[number];
export type ConfigDto = InferResponseType<typeof client.api.config.$get, 200>;
export type MemberDto = InferResponseType<typeof client.api.members.$get, 200>[number];

// A thrown non-ApiError is a network failure (fetch rejects); it drives the offline banner.
const onNetworkError = (error: unknown) => {
  if (!(error instanceof ApiError)) setNetworkFailed(true);
};

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: onNetworkError,
      onSuccess: () => setNetworkFailed(false),
    }),
    mutationCache: new MutationCache({ onError: onNetworkError }),
    defaultOptions: {
      queries: {
        retry: (count, error) => !(error instanceof ApiError) && count < 1,
      },
    },
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    staleTime: Infinity,
    queryFn: async (): Promise<ConfigDto> => {
      const res = await client.api.config.$get();
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
  });
}

export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: async (): Promise<MemberDto[]> => {
      const res = await client.api.members.$get();
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
  });
}

export function useAddMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await client.api.members.$post({ json: { name } });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
    // Also on 409: the list may be stale and the caller will look the name up in it.
    onSettled: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
}

export function useTitles(status: TitleStatus) {
  return useQuery({
    queryKey: ['titles', status],
    queryFn: async (): Promise<TitleDto[]> => {
      const res = await client.api.titles.$get({ query: { status } });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
  });
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    enabled: q.length >= 2,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SearchHitDto[]> => {
      const res = await client.api.search.$get({ query: { q } });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
  });
}

const byNewest = (a: TitleDto, b: TitleDto) => b.addedAt - a.addedAt || b.id - a.id;
type Snapshot = [TitleStatus, TitleDto[] | undefined][];

export function useAddTitle() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (vars: { hit: SearchHitDto; addedBy: string }) => {
      const res = await client.api.titles.$post({
        json: { tmdbId: vars.hit.tmdbId, type: vars.hit.type, addedBy: vars.addedBy },
      });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
    onSuccess: (_data, { hit }) => {
      markInList(hit.tmdbId, hit.type);
      void qc.invalidateQueries({ queryKey: ['titles'] });
      toast(copy.addToastAdded(hit.title), {
        duration: 5000,
        action: { label: copy.addToastView, onClick: () => void navigate('/') },
      });
    },
    onError: (error, { hit }) => {
      if (error instanceof ApiError && error.status === 409) {
        // Already saved (e.g. by the other person): same end state as success.
        markInList(hit.tmdbId, hit.type);
        void qc.invalidateQueries({ queryKey: ['titles'] });
        toast(copy.addToastExists);
        return;
      }
      toast.error(copy.addToastError(hit.title));
    },
  });

  function markInList(tmdbId: number, type: TitleType) {
    qc.setQueriesData<SearchHitDto[]>({ queryKey: ['search'] }, (old) =>
      old?.map((h) => (h.tmdbId === tmdbId && h.type === type ? { ...h, inList: true } : h)),
    );
  }
}

function snapshotTitles(qc: QueryClient): Snapshot {
  return [
    ['to_watch', qc.getQueryData<TitleDto[]>(['titles', 'to_watch'])],
    ['watched', qc.getQueryData<TitleDto[]>(['titles', 'watched'])],
  ];
}

function restoreTitles(qc: QueryClient, snapshot: Snapshot | undefined) {
  snapshot?.forEach(([status, data]) => qc.setQueryData(['titles', status], data));
}

type SetStatusVars = { id: number; title: string; from: TitleStatus; to: TitleStatus; isUndo?: boolean };

export function useSetStatus() {
  const qc = useQueryClient();

  // Toasts live in the hook-level callbacks on purpose: the card that triggered the change
  // unmounts as soon as the optimistic update lands, and per-call callbacks would not fire.
  const mutation = useMutation({
    mutationFn: async ({ id, to }: SetStatusVars) => {
      const res = await client.api.titles[':id'].$patch({
        param: { id: String(id) },
        json: { status: to },
      });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
    onMutate: async ({ id, from, to }) => {
      await qc.cancelQueries({ queryKey: ['titles'] });
      const snapshot = snapshotTitles(qc);
      const item = qc.getQueryData<TitleDto[]>(['titles', from])?.find((t) => t.id === id);
      qc.setQueryData<TitleDto[]>(['titles', from], (old) => old?.filter((t) => t.id !== id));
      if (item) {
        qc.setQueryData<TitleDto[]>(['titles', to], (old) =>
          old ? [{ ...item, status: to }, ...old].sort(byNewest) : old,
        );
      }
      return { snapshot };
    },
    onSuccess: (_data, vars) => {
      if (vars.isUndo) return;
      toast(vars.to === 'watched' ? copy.toastWatched(vars.title) : copy.toastUnwatched(vars.title), {
        duration: 5000,
        action: {
          label: copy.toastUndo,
          onClick: () => mutation.mutate({ ...vars, from: vars.to, to: vars.from, isUndo: true }),
        },
      });
    },
    onError: (_err, vars, ctx) => {
      restoreTitles(qc, ctx?.snapshot);
      toast.error(copy.errorUpdate(vars.title));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['titles'] }),
  });

  return { setStatus: mutation.mutate };
}

export function useRemoveTitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number; title: string }) => {
      const res = await client.api.titles[':id'].$delete({ param: { id: String(id) } });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['titles'] });
      const snapshot = snapshotTitles(qc);
      for (const status of ['to_watch', 'watched'] as const) {
        qc.setQueryData<TitleDto[]>(['titles', status], (old) => old?.filter((t) => t.id !== id));
      }
      return { snapshot };
    },
    onSuccess: (_d, { title }) => toast(copy.toastRemoved(title), { duration: 4000 }),
    onError: (_err, { title }, ctx) => {
      restoreTitles(qc, ctx?.snapshot);
      toast.error(copy.errorRemove(title));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['titles'] }),
  });
}
