import { createContext, useContext, useState, type ReactNode } from 'react';
import { useMembers, type MemberDto } from '@web/lib/api';

const STORAGE_KEY = 'popcorn:member';

type MemberContextValue = {
  member: string | null;
  members: MemberDto[];
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
  const membersQuery = useMembers();
  const [stored, setStored] = useState<string | null>(readStored);
  const [pickerOpen, setPickerOpen] = useState(false);

  const members = membersQuery.data ?? [];
  // A stored name that no longer exists in the members list is treated as missing.
  const member = stored && members.some((m) => m.name === stored) ? stored : null;

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
        mustPick: membersQuery.isSuccess && member === null,
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
