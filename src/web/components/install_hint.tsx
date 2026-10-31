import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import { copy } from '@web/lib/copy';
import { useMember } from '@web/lib/member';
import { useInstallPrompt } from '@web/lib/use_install_prompt';
import { useOnline } from '@web/lib/use_online';
import { cn } from '@web/lib/utils';

export function InstallHint({ listLoaded }: { listLoaded: boolean }) {
  const { kind, install, dismiss } = useInstallPrompt();
  const online = useOnline();
  const { mustPick, pickerOpen } = useMember();
  const [leaving, setLeaving] = useState(false);

  if (!kind || !online || !listLoaded || mustPick || pickerOpen) return null;

  const onDismiss = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLeaving(true);
    setTimeout(
      () => {
        dismiss();
        // The card (and the focused button) is gone, so hand focus to the first tab.
        document.getElementById('tab-to-watch')?.focus();
      },
      reduce ? 0 : 150,
    );
  };

  return (
    <section
      aria-labelledby="install-title"
      className={cn(
        'relative mb-4 flex flex-col gap-3 rounded-xl border bg-card p-4 transition-opacity duration-150 md:hidden motion-reduce:transition-none',
        leaving && 'opacity-0',
      )}
    >
        <div className="flex items-center gap-3 pr-10">
          <Download className="shrink-0 text-primary" size={24} aria-hidden="true" />
          <h2 id="install-title" className="text-lg font-semibold">
            {copy.installTitle}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">{copy.installBody}</p>
        {kind === 'prompt' ? (
          <Button className="w-full" onClick={() => void install()}>
            {copy.installButton}
          </Button>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              {copy.installIosStep1Before}{' '}
              <Share className="inline size-4 align-text-bottom" aria-hidden="true" />{' '}
              {copy.installIosStep1After}
            </li>
            <li>{copy.installIosStep2}</li>
          </ol>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2"
          aria-label={copy.installDismissAria}
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </Button>
    </section>
  );
}
