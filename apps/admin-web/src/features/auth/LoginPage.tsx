import { APP_NAME, APP_LOGO, APP_TAGLINE } from "../../../../../packages/browser/src/brand";
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
    <div className="login-wrap modern-login">
      <section className="login-story" aria-label="About FII VANIGA">
        <img className="login-story-logo" src={APP_LOGO} alt={APP_NAME} />
        <span className="login-eyebrow">{APP_TAGLINE}</span>
        <h2>{isPlatformConsole ? "One platform. Every business." : "Less paperwork. More business."}</h2>
        <p>{isPlatformConsole ? "Manage your tenants, licenses and platform access from one workspace." : "Bring your billing, subscriptions and accounts together. Spend less time on everyday admin and more time moving your business forward."}</p>
        <div className="login-highlights">
          <div><strong>{isPlatformConsole ? "Tenants" : "Billing"}</strong><span>{isPlatformConsole ? "Manage business workspaces" : "Quotes, invoices and receipts"}</span></div>
          <div><strong>{isPlatformConsole ? "Licenses" : "Subscriptions"}</strong><span>{isPlatformConsole ? "Plans and access controls" : "Recurring services, simplified"}</span></div>
          <div><strong>{isPlatformConsole ? "Access" : "Insights"}</strong><span>{isPlatformConsole ? "Keep administration organised" : "Know where your business stands"}</span></div>
        </div>
        <footer>FII VANIGA · Built for your everyday business</footer>
      </section>
      <form className="login-card" onSubmit={onSubmit}>
        <span className="login-eyebrow">{isPlatformConsole ? "Platform administration" : "Your business workspace"}</span>
        <h1>Welcome back</h1>
        <p>Sign in to {APP_NAME} to continue.</p>
        <label htmlFor="login-email">Email address</label>
        <input id="login-email" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label htmlFor="login-password">Password</label>
        <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <label htmlFor="login-otp">Authenticator code <span className="login-optional">if enabled</span></label>
        <input id="login-otp" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p style={{ marginTop: 12 }}><Link to="/forgot-password">Forgot password?</Link></p>
      </form>
    </div>
  );
}
