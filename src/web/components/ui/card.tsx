import * as React from 'react';
import { cn } from '@web/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground', className)}
      {...props}
    />
  );
}

export { Card };
