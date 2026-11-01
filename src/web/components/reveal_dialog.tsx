import { useRef } from 'react';
import { Eye } from 'lucide-react';
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
import { useRevealTitle } from '@web/lib/api';
import { copy } from '@web/lib/copy';

// The trigger lives inside the dialog component so focus returns to the reveal button on cancel.
export function RevealDialog({
  id,
  title,
  disabled,
  onRevealed,
}: {
  id: number;
  title: string;
  disabled: boolean;
  /** Called instead of Radix's focus return, because the trigger unmounts after a reveal. */
  onRevealed: () => void;
}) {
  const reveal = useRevealTitle();
  const confirmed = useRef(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full"
          disabled={disabled}
          aria-label={copy.revealAria(title)}
        >
          <Eye aria-hidden="true" />
          {copy.reveal}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          if (!confirmed.current) return;
          confirmed.current = false;
          e.preventDefault();
          onRevealed();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.revealTitle(title)}</AlertDialogTitle>
          <AlertDialogDescription>{copy.revealBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.revealCancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmed.current = true;
              reveal.mutate({ id, title });
            }}
          >
            {copy.revealConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
