import { Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@web/components/ui/alert_dialog';
import { Button } from '@web/components/ui/button';
import { useRemoveTitle } from '@web/lib/api';
import { copy } from '@web/lib/copy';

// The trigger lives inside the dialog component so focus returns to the trash button on cancel.
export function RemoveDialog({ id, title, disabled }: { id: number; title: string; disabled: boolean }) {
  const remove = useRemoveTitle();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={disabled} aria-label={copy.removeAria(title)}>
          <Trash2 aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.removeTitle(title)}</AlertDialogTitle>
          <AlertDialogDescription>{copy.removeBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.removeCancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove.mutate({ id, title })}>
            {copy.removeConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
