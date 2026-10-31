import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router';
import { toast } from 'sonner';
import { BottomNav } from '@web/components/bottom_nav';
import { Footer } from '@web/components/footer';
import { Header } from '@web/components/header';
import { NamePickerDialog } from '@web/components/name_picker_dialog';
import { Toaster } from '@web/components/ui/sonner';
import { copy } from '@web/lib/copy';
import { useOnline } from '@web/lib/use_online';
import { cn, containerClass } from '@web/lib/utils';

export function AppShell() {
  const online = useOnline();
  const wasOnline = useRef(online);

  useEffect(() => {
    if (online && !wasOnline.current) toast(copy.offlineBack, { duration: 2000 });
    wasOnline.current = online;
  }, [online]);

  // A fragment-only href would navigate to <base>#main, so move focus by hand.
  const skipToContent = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById('main')?.focus();
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {copy.navSkip}
      </a>
      <Header />
      <main id="main" tabIndex={-1} className={cn(containerClass, 'flex-1 pt-4 focus:outline-none')}>
        <Outlet />
      </main>
      <Footer />
      <BottomNav />
      <NamePickerDialog />
      <Toaster />
    </div>
  );
}
