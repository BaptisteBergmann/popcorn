import { useSyncExternalStore } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'popcorn:install-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

type State = {
  event: BeforeInstallPromptEvent | null;
  dismissed: boolean; // permanent, localStorage
  sessionHidden: boolean; // "dismissed" in the browser prompt: hide until reload
  installed: boolean;
};

let state: State = { event: null, dismissed: readDismissed(), sessionHidden: false, installed: false };
const listeners = new Set<() => void>();
function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

// Captured at module load: the event can fire before any component mounts.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setState({ event: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: the installed check below still hides the hint.
    }
    setState({ installed: true, dismissed: true, event: null });
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export type InstallKind = 'prompt' | 'ios' | null;

export function useInstallPrompt() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  let kind: InstallKind = null;
  if (!s.dismissed && !s.sessionHidden && !s.installed && !isStandalone()) {
    if (s.event) kind = 'prompt';
    else if (isIosSafari()) kind = 'ios';
  }

  async function install() {
    if (!s.event) return;
    await s.event.prompt();
    const { outcome } = await s.event.userChoice;
    // The event can only be used once.
    setState({ event: null, sessionHidden: outcome === 'dismissed' });
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Not persisted in private mode; hidden for this session anyway.
    }
    setState({ dismissed: true });
  }

  return { kind, install, dismiss };
}
