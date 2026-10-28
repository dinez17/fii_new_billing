import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../stores/auth";

let restoration: Promise<void> | null = null;
function restoreSession(): Promise<void> {
  restoration ??= (async () => {
    try {
      const { data } = await axios.post("/api/v1/auth/refresh", {}, { withCredentials: true });
      const { data: profile } = await axios.get("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${data.accessToken}` }, withCredentials: true,
      });
      useAuth.getState().setSession({ user: profile, permissions: profile.permissions, accessToken: data.accessToken });
    } catch {
      useAuth.getState().logout();
    }
  })().finally(() => { restoration = null; });
  return restoration;
}

export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { accessToken, hasPerm } = useAuth();
  const location = useLocation();
  const [restoring, setRestoring] = useState(!accessToken);
  useEffect(() => {
    if (accessToken) { setRestoring(false); return; }
    let active = true;
    void restoreSession().finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [accessToken]);
  if (restoring) return <div className="login-wrap">Restoring your session…</div>;
  if (!accessToken) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (permission && !hasPerm(permission)) {
    return (
      <div className="content">
        <div className="card">You don't have permission to view this page ({permission}).</div>
      </div>
    );
  }
  return <>{children}</>;
}
