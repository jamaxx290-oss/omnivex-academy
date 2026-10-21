import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Reset password · Omnivex Academy";
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/request-password-reset", {
        method: "POST",
        body: {
          email: email.trim().toLowerCase(),
          redirectTo: `${location.origin}/reset-password`,
        },
      });
      setSent(true);
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
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-sm font-bold">
            O
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Omnivex Academy</span>
        </Link>
        <Link
          to="/auth"
          className="focus-ring rounded-xl text-sm text-mist transition hover:text-white"
        >
          Back to sign in
        </Link>
      </header>

      <main className="mx-auto max-w-md px-5 pb-16 pt-6">
        <div className="card animate-fade-up rounded-2xl p-6 sm:p-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-lg">
            🔑
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Forgot your password?</h1>

          {sent ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-mist">
                If an account exists for{" "}
                <span className="font-medium text-white">{email}</span>, we've emailed a
                link to reset your password. It expires in 1 hour.
              </p>
              <p className="mt-4 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5 text-xs text-mist">
                Didn't arrive? Check your spam folder, then try again in a few minutes.
              </p>
              <Link
                to="/auth?mode=signin"
                className="btn-ghost focus-ring mt-6 block rounded-xl py-3 text-center text-sm font-semibold"
              >
                Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <p className="text-sm leading-relaxed text-mist">
                Enter your account email and we'll send you a secure link to choose a new
                password.
              </p>
              <div>
                <label htmlFor="fp-email" className="mb-1.5 block text-xs font-medium text-mist">
                  Email address
                </label>
                <input
                  id="fp-email"
                  type="email"
                  className="input focus-ring"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
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
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}
        </div>

        {!sent && (
          <p className="mt-6 text-center text-xs text-mist">
            Remembered it?{" "}
            <Link
              to="/auth?mode=signin"
              className="focus-ring rounded text-accent transition hover:text-white"
            >
              Sign in
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
