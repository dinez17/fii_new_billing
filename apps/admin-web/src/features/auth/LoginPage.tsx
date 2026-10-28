import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { isPlatformConsole } from "../../lib/console";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password, otp: otp || undefined });
      if (isPlatformConsole && !data.permissions?.includes("platform:read")) {
        setError("This console requires a platform superadmin account.");
        return;
      }
      if (!isPlatformConsole && data.permissions?.includes("platform:read")) {
        setError("Use the superadmin console at http://localhost:8002 to sign in.");
        return;
      }
      setSession(data);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from?.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login")
        ? from : data.permissions?.includes("platform:read") ? "/platform/tenants" : "/dashboard", { replace: true });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>{isPlatformConsole ? "FII Platform" : "FII Billing"}</h1>
        <p>{isPlatformConsole ? "Superadmin sign in · Tenant and license management" : "Sign in to the tenant admin console"}</p>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <label>Authenticator code (if enabled)</label>
        <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
        {error && <div className="error">{error}</div>}
        <button className="primary" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p style={{ marginTop: 12 }}><Link to="/forgot-password">Forgot password?</Link></p>
      </form>
    </div>
  );
}
