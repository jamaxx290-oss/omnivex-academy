import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../lib/api";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const tokenError = params.get("error");
  const nav = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = "Choose a new password · Omnivex Academy";
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (password !== confirm) return setError("Passwords do not match");
    if (!token) return setError("This reset link is missing its token");

    setBusy(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { newPassword: password, token },
      });
      setDone(true);
      setTimeout(() => nav("/auth?mode=signin", { replace: true }), 1800);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-bg min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link to="/" className="focus-ring flex items-center gap-2 rounded-xl">
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl ring-1 ring-white/10" />
          <span className="text-[15px] font-semibold tracking-tight">Omnivex Academy</span>
        </Link>
      </header>

      <main className="mx-auto max-w-md px-5 pb-16 pt-6">
        <div className="card animate-fade-up rounded-2xl p-6 sm:p-8">
          {tokenError === "INVALID_TOKEN" || !token ? (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/15 text-lg">
                ⏱️
              </span>
              <h1 className="mt-4 text-xl font-semibold tracking-tight">
                Link expired or invalid
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-mist">
                Reset links are single-use and expire after 1 hour. Request a fresh one
                and we'll email it straight to you.
              </p>
              <Link
                to="/forgot-password"
                className="btn-primary focus-ring mt-6 block rounded-xl py-3 text-center text-sm font-semibold"
              >
                Request a new link
              </Link>
            </>
          ) : done ? (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/15 text-lg">
                ✅
              </span>
              <h1 className="mt-4 text-xl font-semibold tracking-tight">
                Password updated
              </h1>
              <p className="mt-2 text-sm text-mist">
                Signing you in shortly — all other sessions were signed out for safety.
              </p>
            </>
          ) : (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-lg">
                🔑
              </span>
              <h1 className="mt-4 text-xl font-semibold tracking-tight">
                Choose a new password
              </h1>
              <p className="mt-1.5 text-sm text-mist">
                Minimum 8 characters. This signs you out everywhere else.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="np" className="mb-1.5 block text-xs font-medium text-mist">
                    New password
                  </label>
                  <input
                    id="np"
                    type="password"
                    className="input focus-ring"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="cp" className="mb-1.5 block text-xs font-medium text-mist">
                    Confirm password
                  </label>
                  <input
                    id="cp"
                    type="password"
                    className="input focus-ring"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat it"
                    autoComplete="new-password"
                    required
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="animate-fade-in rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="btn-primary focus-ring w-full rounded-xl py-3 text-sm font-semibold"
                >
                  {busy ? "Updating…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
