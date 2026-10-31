import { Toaster as Sonner, type ToasterProps } from 'sonner';

// Always dark (the app has no light mode); mobile offset keeps toasts above the bottom nav.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      mobileOffset={{ bottom: 'calc(64px + env(safe-area-inset-bottom) + 0.5rem)' }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
