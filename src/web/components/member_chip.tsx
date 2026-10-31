import { Button } from '@web/components/ui/button';
import { copy } from '@web/lib/copy';
import { useMember } from '@web/lib/member';

export function MemberChip() {
  const { member, setPickerOpen } = useMember();
  if (!member) return null;
  return (
    <Button
      variant="ghost"
      className="max-w-[9rem] px-2"
      aria-label={copy.headerMemberAria(member)}
      onClick={() => setPickerOpen(true)}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
      >
        {member.charAt(0).toUpperCase()}
      </span>
      <span className="truncate">{member}</span>
    </Button>
  );
}
