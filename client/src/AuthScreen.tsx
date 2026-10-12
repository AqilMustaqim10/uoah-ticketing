import { useEffect, useState } from "react";

const API = "http://localhost:3000";

type Mode = "login" | "signup" | "signup-code" | "forgot" | "reset-code";
type Unit = { id: number; code: string; name: string };

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const input =
  "w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600";
const primary =
  "w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50";
const link = "text-sm text-blue-600 hover:underline";

export default function AuthScreen({
  onLoggedIn,
}: {
  onLoggedIn: (user: any) => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [units, setUnits] = useState<Unit[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [unitId, setUnitId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    fetch(`${API}/auth/units`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  // Counts down the "resend" timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function go(next: Mode, message = "") {
    setMode(next);
    setError("");
    setInfo(message);
    setCode("");
    setPassword("");
    setConfirm("");
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      setError("Cannot reach the server");
    } finally {
      setBusy(false);
    }
  }

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await post("/auth/login", { email, password });
      if (!r.ok) return setError(r.data.error ?? "Login failed");
      onLoggedIn(r.data);
    });
  };

  const requestSignup = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (password !== confirm) return setError("Passwords do not match");
    run(async () => {
      const r = await post("/auth/signup/request", {
        name,
        email,
        unitId: Number(unitId),
        password,
      });
      if (!r.ok) return setError(r.data.error ?? "Could not sign up");
      setCooldown(60);
      setMode("signup-code");
      setInfo(r.data.message);
    });
  };

  const verifySignup = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await post("/auth/signup/verify", { email, code });
      if (!r.ok) return setError(r.data.error ?? "Invalid code");
      go("login", r.data.message);
    });
  };

  const requestReset = (e?: React.FormEvent) => {
    e?.preventDefault();
    run(async () => {
      const r = await post("/auth/reset/request", { email });
      if (!r.ok) return setError(r.data.error ?? "Could not send code");
      setCooldown(60);
      setMode("reset-code");
      setInfo(r.data.message);
    });
  };

  const confirmReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords do not match");
    run(async () => {
      const r = await post("/auth/reset/confirm", {
        email,
        code,
        newPassword: password,
      });
      if (!r.ok) return setError(r.data.error ?? "Could not reset password");
      go("login", r.data.message);
    });
  };

  const titles: Record<Mode, string> = {
    login: "Sign in to continue",
    signup: "Create your account",
    "signup-code": "Verify your email",
    forgot: "Reset your password",
    "reset-code": "Enter the code and a new password",
  };

  return (
    <div className="min-h-screen bg-slate-50 grid place-items-center p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-xs p-6">
        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white grid place-items-center font-bold mb-4">
          U
        </div>
        <h1 className="text-xl font-semibold text-slate-900">UOA Helpdesk</h1>
        <p className="text-sm text-slate-500 mb-4">{titles[mode]}</p>

        {info && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
            {info}
          </p>
        )}

        {mode === "login" && (
          <form onSubmit={login} className="space-y-3">
            <input
              className={input}
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className={input}
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className={primary} disabled={busy}>
              Log in
            </button>
            <div className="flex justify-between">
              <button
                type="button"
                className={link}
                onClick={() => go("forgot")}
              >
                Forgot password?
              </button>
              <button
                type="button"
                className={link}
                onClick={() => go("signup")}
              >
                Create account
              </button>
            </div>
          </form>
        )}

        {mode === "signup" && (
          <form onSubmit={requestSignup} className="space-y-3">
            <input
              className={input}
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={input}
              placeholder="Company email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select
              className={input}
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
            >
              <option value="">Select your business unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </select>
            <input
              className={input}
              type="password"
              placeholder="Password (10+ characters, letters and numbers)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              className={input}
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button className={primary} disabled={busy}>
              Send verification code
            </button>
            <button type="button" className={link} onClick={() => go("login")}>
              Back to login
            </button>
          </form>
        )}

        {mode === "signup-code" && (
          <form onSubmit={verifySignup} className="space-y-3">
            <p className="text-sm text-slate-600">
              We sent a 6-digit code to <strong>{email}</strong>.
            </p>
            <input
              className={input + " tracking-widest text-center text-lg"}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className={primary} disabled={busy || code.length !== 6}>
              Verify and create account
            </button>
            <div className="flex justify-between">
              <button
                type="button"
                className={
                  link + " disabled:text-slate-400 disabled:no-underline"
                }
                disabled={cooldown > 0 || busy}
                onClick={() => requestSignup()}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
              <button
                type="button"
                className={link}
                onClick={() => go("signup")}
              >
                Change details
              </button>
            </div>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={requestReset} className="space-y-3">
            <input
              className={input}
              placeholder="Company email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className={primary} disabled={busy}>
              Send reset code
            </button>
            <button type="button" className={link} onClick={() => go("login")}>
              Back to login
            </button>
          </form>
        )}

        {mode === "reset-code" && (
          <form onSubmit={confirmReset} className="space-y-3">
            <p className="text-sm text-slate-600">
              Enter the 6-digit code sent to <strong>{email}</strong>.
            </p>
            <input
              className={input + " tracking-widest text-center text-lg"}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <input
              className={input}
              type="password"
              placeholder="New password (10+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              className={input}
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button className={primary} disabled={busy || code.length !== 6}>
              Change password
            </button>
            <div className="flex justify-between">
              <button
                type="button"
                className={
                  link + " disabled:text-slate-400 disabled:no-underline"
                }
                disabled={cooldown > 0 || busy}
                onClick={() => requestReset()}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
              <button
                type="button"
                className={link}
                onClick={() => go("login")}
              >
                Back to login
              </button>
            </div>
          </form>
        )}

        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>
    </div>
  );
}
