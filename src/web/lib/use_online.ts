import { useSyncExternalStore } from 'react';

// "Online" means the browser says so AND the last request did not fail at the network level.
let networkFailed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setNetworkFailed(value: boolean) {
  if (networkFailed === value) return;
  networkFailed = value;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onOnline = () => {
    networkFailed = false;
    listener();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', listener);
  };
}

const getSnapshot = () => navigator.onLine && !networkFailed;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
