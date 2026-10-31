import { Check } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import { copy } from '@web/lib/copy';
import { useMember } from '@web/lib/member';

export function NamePickerDialog() {
  const { member, members, mustPick, pickerOpen, setPickerOpen, setMember } = useMember();
  const open = mustPick || pickerOpen;

  return (
    <Dialog open={open} onOpenChange={(next) => !mustPick && setPickerOpen(next)}>
      <DialogContent
        showCloseButton={!mustPick}
        closeLabel={copy.close}
        // First visit: the name is required, so the dialog cannot be dismissed.
        onInteractOutside={(e) => mustPick && e.preventDefault()}
        onEscapeKeyDown={(e) => mustPick && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{copy.memberTitle}</DialogTitle>
          <DialogDescription>{copy.memberBody}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {members.map((name) => (
            <Button
              key={name}
              variant="outline"
              size="lg"
              className="w-full"
              aria-pressed={name === member}
              onClick={() => setMember(name)}
            >
              {name === member && <Check aria-hidden="true" />}
              {name}
            </Button>
          ))}
        </div>
        {!mustPick && (
          <DialogClose asChild>
            <Button variant="ghost">{copy.memberCancel}</Button>
          </DialogClose>
        )}
      </DialogContent>
    </Dialog>
  );
}
