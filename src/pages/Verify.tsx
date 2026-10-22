import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../hooks";

export default function VerifyPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { refetch } = useMe();

  const [email, setEmail] = useState(params.get("email") || "");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const next = params.get("next");

  useEffect(() => {
    document.title = "Verify email · Omnivex Academy";
    if (!email) {
      api<{ user: { email: string; emailVerified: boolean } | null }>("/api/me").then(
        (r) => {
          if (r.user?.email && !r.user.emailVerified) setEmail(r.user.email);
        },
      );
    }
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode(silent = false) {
    if (!email) return;
    setError(null);
    try {
      await api("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        body: { email, type: "email-verification" },
      });
      setCooldown(45);
      if (!silent) setNotice("Code sent — check your inbox (and spam folder).");
    } catch (err) {
      if (!silent) setError(errorMessage(err));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) return setError("Enter the 6-digit code");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/email-otp/verify-email", {
        method: "POST",
        body: { email, otp },
      });
      const { data } = await refetch();
      const user = data?.user;
      if (!user) throw new Error("Could not load your account");
      if (next && next.startsWith("/")) nav(next, { replace: true });
      else if (user.banned) nav("/banned", { replace: true });
      else if (user.membershipStatus === "active" || user.isAdmin)
        nav("/app/groups", { replace: true });
      else nav("/paywall", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setOtp("");
      inputRef.current?.focus();
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
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-lg">
            ✉️
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Verify your email</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-mist">
            Enter the 6-digit code we sent to{" "}
            <span className="font-medium text-white">{email || "your inbox"}</span>. It
            expires in 10 minutes.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {!email && (
              <div>
                <label htmlFor="v-email" className="mb-1.5 block text-xs font-medium text-mist">
                  Email address
                </label>
                <input
                  id="v-email"
                  type="email"
                  className="input focus-ring"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
            )}

            <div>
              <label htmlFor="otp" className="mb-1.5 block text-xs font-medium text-mist">
                Verification code
              </label>
              <input
                id="otp"
                ref={inputRef}
                className="input focus-ring text-center text-2xl font-bold tracking-[0.5em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setOtp(v);
                  setNotice(null);
                  if (v.length === 6) {
                    // auto-submit when the 6th digit lands
                    setTimeout(() => {
                      if (v.length === 6 && !busy) {
                        const form = e.target.form;
                        form?.requestSubmit();
                      }
                    }, 120);
                  }
                }}
                placeholder="••••••"
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
            {notice && (
              <p className="animate-fade-in rounded-xl border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || otp.length !== 6}
              className="btn-primary focus-ring w-full rounded-xl py-3 text-sm font-semibold"
            >
              {busy ? "Verifying…" : "Verify email"}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between text-xs text-mist">
            <span>
              Didn't get it? Check spam.
            </span>
            <button
              type="button"
              disabled={cooldown > 0 || !email}
              onClick={() => sendCode()}
              className="focus-ring rounded font-medium text-accent transition hover:text-white disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>

          <p className="mt-5 text-center text-xs text-mist">
            Wrong address?{" "}
            <Link
              to="/auth"
              className="focus-ring rounded text-accent transition hover:text-white"
            >
              Start over
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-mist">
          <button
            type="button"
            onClick={() => sendCode(true)}
            className="focus-ring rounded underline decoration-line underline-offset-4 transition hover:text-white"
          >
            Send me a new code first
          </button>
        </p>
      </main>
    </div>
  );
}
