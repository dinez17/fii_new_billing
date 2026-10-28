import { create } from "zustand";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  userType: string;
}

interface AuthState {
  user: AuthUser | null;
  permissions: string[];
  accessToken: string | null;
  setSession: (s: { user: AuthUser; permissions: string[]; accessToken: string }) => void;
  setTokens: (t: { accessToken: string }) => void;
  logout: () => void;
  hasPerm: (perm: string) => boolean;
}

const STORAGE_KEY = "fii.auth";

function load(): Pick<AuthState, "user" | "permissions" | "accessToken"> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { user: null, permissions: [], accessToken: null };
}

function persist(s: Pick<AuthState, "user" | "permissions" | "accessToken">) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export const useAuth = create<AuthState>((set, get) => ({
  ...load(),
  setSession: ({ user, permissions, accessToken }) => {
    const s = { user, permissions, accessToken };
    persist(s);
    set(s);
  },
  setTokens: ({ accessToken }) => {
    const { user, permissions } = get();
    const s = { user, permissions, accessToken };
    persist(s);
    set(s);
  },
  logout: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ user: null, permissions: [], accessToken: null });
  },
  hasPerm: (perm) => get().permissions.includes(perm),
}));
