import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../hooks";
import type { Me } from "../lib/types";

function destinationFor(user: Me, next: string | null): string {
  if (next && next.startsWith("/")) return next;
  if (!user.emailVerified) return "/verify";
  if (user.banned) return "/banned";
  if (user.membershipStatus === "active" || user.isAdmin) return "/app/groups";
  return "/paywall";
}

export default function AuthPage() {
  const [params] = useSearchParams();
  const next = params.get("next");
  const initialMode = params.get("mode") === "signin" ? "signin" : "register";
  const [mode, setMode] = useState<"register" | "signin">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [country, setCountry] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [gender, setGender] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { refetch } = useMe();

  useEffect(() => {
    document.title = mode === "register" ? "Create account · Omnivex Academy" : "Sign in · Omnivex Academy";
  }, [mode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      if (name.trim().length < 2) return setError("Please enter your full name");
      if (password.length < 8) return setError("Password must be at least 8 characters");
      if (!whatsapp.trim()) return setError("WhatsApp number is required");
      if (!country.trim()) return setError("Country is required");
      if (!stateRegion.trim()) return setError("State / region is required");
      if (!gender) return setError("Please select your gender");
    } else if (!password) {
      return setError("Enter your password");
    }

    setBusy(true);
    try {
      if (mode === "register") {
        await api("/api/auth/sign-up/email", {
          method: "POST",
          body: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
            whatsapp_number: whatsapp.trim(),
            country: country.trim(),
            state_region: stateRegion.trim(),
            gender,
          },
        });
        const qs = new URLSearchParams({ email: email.trim().toLowerCase() });
        if (next) qs.set("next", next);
        nav(`/verify?${qs.toString()}`, { replace: true });
      } else {
        await api("/api/auth/sign-in/email", {
          method: "POST",
          body: { email: email.trim().toLowerCase(), password },
        });
        const { data } = await refetch();
        const user = data?.user;
        if (!user) throw new Error("Could not load your account");
        nav(destinationFor(user, next), { replace: true });
      }
    } catch (err) {
      const msg = errorMessage(err);
      setError(
        /invalid|incorrect/i.test(msg)
          ? mode === "register"
            ? msg
            : "Email or password is incorrect"
          : msg,
      );
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
        <Link
          to="/"
          className="focus-ring rounded-xl text-sm text-mist transition hover:text-white"
        >
          Back home
        </Link>
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-5 pb-16 pt-6 md:grid-cols-2 md:items-center md:pt-14">
        {/* Value panel */}
        <section className="hidden md:block">
          <h1 className="text-3xl font-bold leading-tight tracking-tight">
            {mode === "register" ? (
              <>
                Join the authors
                <br />
                <span className="text-accent">shipping on KDP.</span>
              </>
            ) : (
              <>
                Welcome back to
                <br />
                <span className="text-accent">the academy.</span>
              </>
            )}
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-mist">
            Live mentorship rooms, direct message your accountability partners,
            and follow announcements — all in one private community.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-mist">
            {[
              "6-digit email code — no social logins required",
              "Pay once in naira, activate instantly",
              "Voice notes, images, and video in every chat",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] text-white">
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* Form card */}
        <section className="card animate-fade-up w-full max-w-md rounded-2xl p-6 sm:p-8 md:mx-auto">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-2/60 p-1">
            {(
              [
                ["register", "Create account"],
                ["signin", "Sign in"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key);
                  setError(null);
                }}
                className={`focus-ring rounded-lg px-3 py-2 text-sm font-medium transition ${
                  mode === key ? "bg-accent text-white" : "text-mist hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <h2 className="text-xl font-semibold tracking-tight">
            {mode === "register" ? "Create your account" : "Sign in to continue"}
          </h2>
          <p className="mt-1.5 text-sm text-mist">
            {mode === "register"
              ? "We'll email you a 6-digit code to verify."
              : "Use the email and password for your account."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "register" && (
              <div>
                <label htmlFor="name" className="mb-1.5 block text-xs font-medium text-mist">
                  Full name
                </label>
                <input
                  id="name"
                  className="input focus-ring"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Amaka Okonkwo"
                  autoComplete="name"
                  required
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-mist">
                Email address
              </label>
              <input
                id="email"
                type="email"
                className="input focus-ring"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-xs font-medium text-mist">
                  Password
                </label>
                {mode === "signin" && (
                  <Link
                    to="/forgot-password"
                    className="focus-ring rounded text-xs text-accent transition hover:text-white"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <input
                id="password"
                type="password"
                className="input focus-ring"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
              />
            </div>

            {mode === "register" && (
              <>
                <div>
                  <label htmlFor="whatsapp" className="mb-1.5 block text-xs font-medium text-mist">
                    WhatsApp number <span className="text-danger">*</span>
                  </label>
                  <input
                    id="whatsapp"
                    className="input focus-ring"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+234 801 234 5678"
                    autoComplete="tel"
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="country" className="mb-1.5 block text-xs font-medium text-mist">
                      Country <span className="text-danger">*</span>
                    </label>
                    <input
                      id="country"
                      className="input focus-ring"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="Nigeria"
                      autoComplete="country-name"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="state" className="mb-1.5 block text-xs font-medium text-mist">
                      State / region <span className="text-danger">*</span>
                    </label>
                    <input
                      id="state"
                      className="input focus-ring"
                      value={stateRegion}
                      onChange={(e) => setStateRegion(e.target.value)}
                      placeholder="Lagos"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="gender" className="mb-1.5 block text-xs font-medium text-mist">
                    Gender <span className="text-danger">*</span>
                  </label>
                  <select
                    id="gender"
                    className="input focus-ring"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other / prefer not to say</option>
                  </select>
                </div>
              </>
            )}

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
              {busy
                ? "Please wait…"
                : mode === "register"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs leading-relaxed text-mist">
            {mode === "register" ? (
              <>
                Already a member?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="focus-ring rounded text-accent transition hover:text-white"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to Omnivex?{" "}
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className="focus-ring rounded text-accent transition hover:text-white"
                >
                  Create an account
                </button>
              </>
            )}
          </p>
        </section>
      </main>
    </div>
  );
}
