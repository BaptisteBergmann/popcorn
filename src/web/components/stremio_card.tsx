import { useRef, useState } from 'react';
import { Check, Copy, Tv } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import { Card } from '@web/components/ui/card';
import { Input } from '@web/components/ui/input';
import { Skeleton } from '@web/components/ui/skeleton';
import { useConfig } from '@web/lib/api';
import { copy } from '@web/lib/copy';

export function StremioCard() {
  const config = useConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // The list still works without the card.
  if (config.isError) return null;

  const url = config.data?.stremioManifestUrl;
  const installHref = url?.replace(/^https?:\/\//, 'stremio://');

  const onCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      inputRef.current?.select();
      setCopyFailed(true);
    }
  };

  return (
    <Card className="mt-10 max-w-xl">
      <div className="flex items-center gap-3">
        <Tv className="text-primary" size={24} aria-hidden="true" />
        <h2 className="text-lg font-semibold">{copy.stremioTitle}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{copy.stremioBody}</p>
      {config.isPending || !url ? (
        <>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </>
      ) : (
        <>
          <Button asChild className="w-full sm:w-auto sm:self-start">
            <a href={installHref} rel="noreferrer">
              {copy.stremioInstall}
            </a>
          </Button>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              readOnly
              value={url}
              aria-label={copy.stremioUrlAria}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button variant="outline" onClick={onCopy} className="min-w-[7rem]">
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? copy.stremioCopied : copy.stremioCopy}
            </Button>
          </div>
          <p className="sr-only" aria-live="polite">
            {copied ? copy.stremioCopied : ''}
          </p>
          {copyFailed && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {copy.stremioCopyFallback}
            </p>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">{copy.stremioHint}</p>
    </Card>
  );
}
