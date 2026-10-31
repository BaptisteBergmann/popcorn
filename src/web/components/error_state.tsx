import { TriangleAlert } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import { EmptyState } from '@web/components/empty_state';
import { copy } from '@web/lib/copy';

export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title: string;
  body?: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      icon={TriangleAlert}
      iconClassName="text-destructive"
      title={title}
      body={body}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {copy.errorRetry}
        </Button>
      }
    />
  );
}
