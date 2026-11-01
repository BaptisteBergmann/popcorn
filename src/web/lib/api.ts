import {
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryKey,
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

export async function fetchMembers(): Promise<MemberDto[]> {
  const res = await client.api.members.$get();
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

export function useMembers() {
  return useQuery({ queryKey: ['members'], queryFn: fetchMembers });
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

// The member only narrows what is shown (own surprises); it is part of the key so a member
// switch never shows the previous member's rows.
export function useTitles(status: TitleStatus, member: string | null) {
  return useQuery({
    queryKey: ['titles', status, member],
    queryFn: async (): Promise<TitleDto[]> => {
      const res = await client.api.titles.$get({
        query: member ? { status, member } : { status },
      });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
  });
}

export function useSearch(q: string, member: string | null) {
  return useQuery({
    queryKey: ['search', q, member],
    enabled: q.length >= 2,
    staleTime: 60_000,
    // Keep previous results across query changes only for the same member, so a member
    // switch can't leave the previous member's inList flags on screen.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[2] === member ? keepPreviousData(prev) : undefined,
    queryFn: async (): Promise<SearchHitDto[]> => {
      const res = await client.api.search.$get({ query: member ? { q, member } : { q } });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
  });
}

const byNewest = (a: TitleDto, b: TitleDto) => b.addedAt - a.addedAt || b.id - a.id;
type Snapshot = [QueryKey, TitleDto[] | undefined][];

type AddVars = { hit: SearchHitDto; addedBy: string; hidden: boolean };

export function useAddTitle() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async (vars: AddVars) => {
      const res = await client.api.titles.$post({
        json: {
          tmdbId: vars.hit.tmdbId,
          type: vars.hit.type,
          addedBy: vars.addedBy,
          hidden: vars.hidden,
        },
      });
      if (!res.ok) throw new ApiError(res.status);
      // 201 = new row; 200 = an existing surprise was defused by this add.
      return { created: res.status === 201 };
    },
    onSuccess: ({ created }, { hit, hidden }) => {
      markInList(hit.tmdbId, hit.type);
      void qc.invalidateQueries({ queryKey: ['titles'] });
      // On 200 never reveal that the title existed hidden: always the plain toast.
      toast(created && hidden ? copy.addToastSurprise(hit.title) : copy.addToastAdded(hit.title), {
        duration: 5000,
        action: { label: copy.addToastView, onClick: () => void navigate('/') },
      });
    },
    onError: (error, vars) => {
      const { hit } = vars;
      if (error instanceof ApiError && error.status === 409) {
        // Already saved (e.g. by the other person): same end state as success.
        markInList(hit.tmdbId, hit.type);
        void qc.invalidateQueries({ queryKey: ['titles'] });
        toast(copy.addToastExists);
        return;
      }
      if (error instanceof ApiError && error.status === 422) {
        toast.error(copy.addToastNoImdb(hit.title), {
          duration: 8000,
          action: {
            label: copy.addToastNoImdbAction,
            onClick: () => mutation.mutate({ ...vars, hidden: false }),
          },
        });
        return;
      }
      toast.error(copy.addToastError(hit.title));
    },
  });
  return mutation;

  function markInList(tmdbId: number, type: TitleType) {
    qc.setQueriesData<SearchHitDto[]>({ queryKey: ['search'] }, (old) =>
      old?.map((h) => (h.tmdbId === tmdbId && h.type === type ? { ...h, inList: true } : h)),
    );
  }
}

function snapshotTitles(qc: QueryClient): Snapshot {
  return qc.getQueriesData<TitleDto[]>({ queryKey: ['titles'] });
}

function restoreTitles(qc: QueryClient, snapshot: Snapshot | undefined) {
  snapshot?.forEach(([key, data]) => qc.setQueryData(key, data));
}

type SetStatusVars = {
  id: number;
  title: string;
  from: TitleStatus;
  to: TitleStatus;
  wasHidden?: boolean;
  isUndo?: boolean;
};

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
      const item = qc
        .getQueriesData<TitleDto[]>({ queryKey: ['titles', from] })
        .flatMap(([, data]) => data ?? [])
        .find((t) => t.id === id);
      qc.setQueriesData<TitleDto[]>({ queryKey: ['titles', from] }, (old) =>
        old?.filter((t) => t.id !== id),
      );
      if (item) {
        // Watched always reveals a surprise, server side too.
        const moved = { ...item, status: to, hidden: to === 'watched' ? false : item.hidden };
        qc.setQueriesData<TitleDto[]>({ queryKey: ['titles', to] }, (old) =>
          old ? [moved, ...old.filter((t) => t.id !== id)].sort(byNewest) : old,
        );
      }
      return { snapshot };
    },
    onSuccess: (_data, vars) => {
      if (vars.isUndo) return;
      const message =
        vars.to === 'watched'
          ? vars.wasHidden
            ? copy.toastWatchedRevealed(vars.title)
            : copy.toastWatched(vars.title)
          : copy.toastUnwatched(vars.title);
      toast(message, {
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
      qc.setQueriesData<TitleDto[]>({ queryKey: ['titles'] }, (old) =>
        old?.filter((t) => t.id !== id),
      );
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

export function useRevealTitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number; title: string }) => {
      const res = await client.api.titles[':id'].reveal.$post({ param: { id: String(id) } });
      if (!res.ok) throw new ApiError(res.status);
      return res.json();
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['titles'] });
      const snapshot = snapshotTitles(qc);
      qc.setQueriesData<TitleDto[]>({ queryKey: ['titles'] }, (old) =>
        old?.map((t) => (t.id === id ? { ...t, hidden: false } : t)),
      );
      return { snapshot };
    },
    onSuccess: (_d, { title }) => toast(copy.toastRevealed(title), { duration: 4000 }),
    onError: (_err, { title }, ctx) => {
      restoreTitles(qc, ctx?.snapshot);
      toast.error(copy.errorReveal(title));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['titles'] }),
  });
}
