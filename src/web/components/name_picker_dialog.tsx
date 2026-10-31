import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { memberKey } from '@shared/member_key';
import { Button } from '@web/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import { Input } from '@web/components/ui/input';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchMembers, useAddMember } from '@web/lib/api';
import { copy } from '@web/lib/copy';
import { useMember } from '@web/lib/member';
import { useOnline } from '@web/lib/use_online';

export function NamePickerDialog() {
  const { member, members, mustPick, pickerOpen, setPickerOpen, setMember } = useMember();
  const open = mustPick || pickerOpen;
  const online = useOnline();
  const addMember = useAddMember();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    try {
      const created = await addMember.mutateAsync(trimmed);
      setMember(created.name);
      setName('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Name already exists (case-insensitive): select the existing one.
        // Look it up in freshly fetched data: the cached list may predate the other person's add.
        const fresh = await qc.fetchQuery({ queryKey: ['members'], queryFn: fetchMembers, staleTime: 0 });
        const key = memberKey(trimmed);
        const existing = fresh.find((m) => memberKey(m.name) === key);
        if (existing) {
          setMember(existing.name);
          setName('');
          return;
        }
      }
      toast.error(copy.memberError);
    }
  };

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
          {members.map((m) => (
            <Button
              key={m.id}
              variant="outline"
              size="lg"
              className="w-full"
              aria-pressed={m.name === member}
              onClick={() => setMember(m.name)}
            >
              {m.name === member && <Check aria-hidden="true" />}
              {m.name}
            </Button>
          ))}
        </div>
        <form onSubmit={submit} className="flex flex-col gap-2">
          {members.length > 0 && <p className="text-sm font-medium">{copy.memberAddTitle}</p>}
          <label htmlFor="member-name" className="text-sm text-muted-foreground">
            {copy.memberLabel}
          </label>
          <div className="flex gap-2">
            <Input
              id="member-name"
              value={name}
              maxLength={30}
              autoComplete="off"
              disabled={!online}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={!online || !trimmed || addMember.isPending}>
              {copy.memberSubmit}
            </Button>
          </div>
        </form>
        {!mustPick && (
          <DialogClose asChild>
            <Button variant="ghost">{copy.memberCancel}</Button>
          </DialogClose>
        )}
      </DialogContent>
    </Dialog>
  );
}
