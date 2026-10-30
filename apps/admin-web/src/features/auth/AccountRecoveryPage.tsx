import { APP_NAME, APP_LOGO } from "../../../../../packages/browser/src/brand";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, errMessage } from "../../lib/api";

export function AccountRecoveryPage() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [tenant, setTenant] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const mode = pathname.includes("verify-email") ? "verify" : pathname.includes("reset-password") ? "reset" : "request";
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "request") {
        await api.post("/auth/password-reset/request", { email, tenant });
        setMessage("If that account exists, a reset link has been sent.");
      } else if (mode === "reset") {
        await api.post("/auth/password-reset/confirm", { token: params.get("token"), newPassword: password });
        setMessage("Password reset. You can now sign in.");
      } else {
        await api.post("/auth/email/verify", { token: params.get("token") });
        setMessage("Email address verified.");
      }
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  }

  return <div className="login-wrap"><form className="login-card" onSubmit={submit}>
    <img className="login-logo" src={APP_LOGO} alt={APP_NAME} />
    <h1>{mode === "request" ? "Forgot password" : mode === "reset" ? "Reset password" : "Verify email"}</h1>
    {mode === "request" && <>
      <label>Company subdomain</label><input value={tenant} onChange={(e) => setTenant(e.target.value)} required />
      <label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
    </>}
    {mode === "reset" && <><label>New password</label><input type="password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required /></>}
    {message && <div className="success-banner">{message}</div>}
    {error && <div className="error">{error}</div>}
    {!message && <button className="primary" style={{ width: "100%", marginTop: 18 }} disabled={busy}>{busy ? "Please wait…" : "Continue"}</button>}
    <p style={{ marginTop: 14 }}><Link to="/login">Back to sign in</Link></p>
  </form></div>;
}
