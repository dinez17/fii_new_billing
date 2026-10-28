import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuth } from "../stores/auth";
import { isPlatformConsole } from "./console";

const consoleScope = isPlatformConsole ? "platform" : "tenant";
export const api = axios.create({ baseURL: "/api/v1", withCredentials: true, headers: { "X-FII-Console": consoleScope } });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<void> | null = null;

async function doRefresh(): Promise<void> {
  const { setTokens, logout } = useAuth.getState();
  try {
    const { data } = await axios.post("/api/v1/auth/refresh", {}, { withCredentials: true, headers: { "X-FII-Console": consoleScope, "X-FII-User": useAuth.getState().user?.id } });
    setTokens({ accessToken: data.accessToken });
  } catch (err) {
    logout();
    window.location.href = "/login";
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
    if (err.response?.status === 429) {
      const seconds = Number(err.response.headers["retry-after"]);
      return Number.isFinite(seconds) && seconds > 0
        ? `Too many requests. Try again in ${Math.ceil(seconds / 60)} minute(s).`
        : "Too many requests. Please wait a few minutes before trying again.";
    }
    const data = err.response?.data as { error?: { message?: string; details?: unknown } } | undefined;
    let msg = data?.error?.message ?? err.message;
    // zod fieldErrors: { field: ["problem", ...], ... } → "field: problem"
    const details = data?.error?.details;
    if (details && typeof details === "object") {
      const parts = Object.entries(details as Record<string, unknown>)
        .map(([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join("; ") : String(errs)}`)
        .filter(Boolean);
      if (parts.length > 0) msg += ` — ${parts.join(" · ")}`;
    }
    return msg;
  }
  return String(err);
}
