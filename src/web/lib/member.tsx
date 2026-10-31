import { createContext, useContext, useState, type ReactNode } from 'react';
import { useConfig } from '@web/lib/api';

const STORAGE_KEY = 'popcorn:member';

type MemberContextValue = {
  member: string | null;
  members: string[];
  /** Config loaded but no valid stored name: the picker must open, non-dismissible. */
  mustPick: boolean;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  setMember: (name: string) => void;
};

const MemberContext = createContext<MemberContextValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function MemberProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const [stored, setStored] = useState<string | null>(readStored);
  const [pickerOpen, setPickerOpen] = useState(false);

  const members = config.data?.members ?? [];
  // A stored name that left MEMBERS is treated as missing.
  const member = stored && members.includes(stored) ? stored : null;

  const setMember = (name: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // Not persisted (private mode); kept in memory for this session.
    }
    setStored(name);
    setPickerOpen(false);
  };

  return (
    <MemberContext.Provider
      value={{
        member,
        members,
        mustPick: config.isSuccess && member === null,
        pickerOpen,
        setPickerOpen,
        setMember,
      }}
    >
      {children}
    </MemberContext.Provider>
  );
}

export function useMember(): MemberContextValue {
  const ctx = useContext(MemberContext);
  if (!ctx) throw new Error('useMember must be used inside MemberProvider');
  return ctx;
}
