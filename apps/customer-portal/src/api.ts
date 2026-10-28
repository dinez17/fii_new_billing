import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { create } from "zustand";

// ── auth store
interface PortalAuth {
  accessToken: string | null;
  customerName: string | null;
  setSession: (s: { accessToken: string; customerName: string }) => void;
  setTokens: (t: { accessToken: string }) => void;
  logout: () => void;
}

const KEY = "fii.portal.auth";
const saved = (() => {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; }
})();

export const useAuth = create<PortalAuth>((set, get) => ({
  accessToken: saved?.accessToken ?? null,
  customerName: saved?.customerName ?? null,
  setSession: (s) => { sessionStorage.setItem(KEY, JSON.stringify(s)); set(s); },
  setTokens: (t) => {
    const next = { ...t, customerName: get().customerName };
    sessionStorage.setItem(KEY, JSON.stringify(next));
    set(t);
  },
  logout: () => { sessionStorage.removeItem(KEY); set({ accessToken: null, customerName: null }); },
}));

// ── axios client with refresh
export const api = axios.create({ baseURL: "/api/v1", withCredentials: true });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<void> | null = null;

async function doRefresh(): Promise<void> {
  const { setTokens, logout } = useAuth.getState();
  try {
    const { data } = await axios.post("/api/v1/auth/refresh", {}, { withCredentials: true });
    setTokens({ accessToken: data.accessToken });
  } catch (err) {
    logout();
    throw err;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retry && !original.url?.includes("/auth/")) {
      original._retry = true;
      refreshing ??= doRefresh().finally(() => { refreshing = null; });
      await refreshing;
      return api(original);
    }
    return Promise.reject(error);
  },
);

export function errMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message ?? err.message;
  }
  return String(err);
}
