import type { TitleStatus } from '@shared/constants';
import { TitleCard } from '@web/components/title_card';
import type { TitleDto } from '@web/lib/api';

export const gridClass =
  'grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

export function TitleGrid({ items, tab }: { items: TitleDto[]; tab: TitleStatus }) {
  return (
    <ul className={gridClass}>
      {items.map((item) => (
        <li key={item.id}>
          <TitleCard item={item} tab={tab} />
        </li>
      ))}
    </ul>
  );
}
