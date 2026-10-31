import { Check, Loader2, Plus } from 'lucide-react';
import { Poster } from '@web/components/poster';
import { Button } from '@web/components/ui/button';
import { type SearchHitDto, useAddTitle } from '@web/lib/api';
import { copy } from '@web/lib/copy';
import { useMember } from '@web/lib/member';
import { useOnline } from '@web/lib/use_online';

export function SearchResultRow({ hit }: { hit: SearchHitDto }) {
  const add = useAddTitle();
  const online = useOnline();
  const { member } = useMember();
  const typeLabel = hit.type === 'movie' ? copy.typeMovie : copy.typeSeries;
  const meta = [hit.year, typeLabel].filter(Boolean).join(' · ');

  return (
    <li className="flex items-center gap-3 rounded-lg bg-card p-2">
      <Poster
        posterUrl={hit.posterUrl}
        title={hit.title}
        year={hit.year}
        type={hit.type}
        className="w-14 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-medium">{hit.title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </div>
      {hit.inList ? (
        <Button variant="secondary" className="min-w-[7rem] text-muted-foreground" disabled>
          <Check aria-hidden="true" />
          {copy.addInList}
        </Button>
      ) : add.isPending ? (
        <Button className="min-w-[7rem]" disabled>
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {copy.addAdding}
        </Button>
      ) : (
        <Button
          className="min-w-[7rem]"
          disabled={!online || !member}
          aria-label={copy.addButtonAria(hit.title)}
          onClick={() => member && add.mutate({ hit, addedBy: member })}
        >
          <Plus aria-hidden="true" />
          {copy.addButton}
        </Button>
      )}
    </li>
  );
}
