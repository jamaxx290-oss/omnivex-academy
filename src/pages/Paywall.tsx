import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage, naira, relTime } from "../lib/api";
import { useMe, useSettings } from "../hooks";

type PayStatus = {
  configured: boolean;
  membershipStatus: string;
  payments: {
    reference: string;
    amountKobo: number;
    currency: string;
    status: string;
    channel: string | null;
    createdAt: string;
    verifiedAt: string | null;
  }[];
};

const perks = [
  "Unlimited access to everything Omnivex Academy offers",
  "High-priority premium KDP mentorship",
  "Direct messages with mentors and peers",
  "Voice notes, images, and video in every chat",
  "Announcements and launch reviews as they happen",
];

/** The terms are a must-read: the continue button stays greyed out this long. */
const READ_SECONDS = 30;

function Requirement({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <span className="flex items-start gap-2 text-xs leading-relaxed">
      <span
        className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
          done ? "bg-success text-black" : "bg-surface-3 text-mist"
        }`}
        aria-hidden="true"
      >
        {done ? "✓" : ""}
      </span>
      <span className={done ? "text-white" : "text-mist"}>{children}</span>
    </span>
  );
}

function statusChip(status: string) {
  const map: Record<string, string> = {
    success: "border-success/40 bg-success/10 text-success",
    pending: "border-warning/40 bg-warning/10 text-warning",
    failed: "border-danger/40 bg-danger/10 text-danger",
    abandoned: "border-danger/40 bg-danger/10 text-danger",
  };
  return map[status] || "border-line bg-surface-2/60 text-mist";
}

export default function PaywallPage() {
  const { data: settings } = useSettings();
  const { data: me } = useMe();
  /** "checkout" opens the card as a payment gate, "view" only to re-read. */
  const [termsOpen, setTermsOpen] = useState<false | "checkout" | "view">(false);
  const [agreed, setAgreed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(READ_SECONDS);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const termsRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["pay-status"],
    queryFn: () => api<PayStatus>("/api/payments/status"),
  });

  const user = me?.user;
  const isActive = user?.membershipStatus === "active" || user?.isAdmin;
  const price = settings?.priceKobo ?? null;

  useEffect(() => {
    document.title = "Activate membership · Omnivex Academy";
  }, []);

  /* Each time the card opens: reset the reading timer and scroll state. */
  useEffect(() => {
    if (!termsOpen) return;
    setSecondsLeft(READ_SECONDS);
    setReachedEnd(false);
    setProgress(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const left = Math.max(
        0,
        READ_SECONDS - Math.round((Date.now() - startedAt) / 1000),
      );
      setSecondsLeft(left);
      if (left === 0) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [termsOpen]);

  /* Terms short enough to fit on screen need no scrolling to be read. */
  useEffect(() => {
    if (!termsOpen || !settings?.termsText) return;
    const el = termsRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 4) {
      setReachedEnd(true);
      setProgress(100);
    }
  }, [termsOpen, settings?.termsText]);

  function handleTermsScroll() {
    const el = termsRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max <= 0 ? 100 : Math.min(100, Math.round((el.scrollTop / max) * 100));
    setProgress(pct);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setReachedEnd(true);
  }

  const canAgree = reachedEnd && secondsLeft === 0;

  async function startCheckout() {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ authorizationUrl: string }>("/api/payments/initialize", {
        method: "POST",
        body: { termsVersion: settings?.termsVersion ?? 1 },
      });
      if (!res.authorizationUrl) throw new Error("No checkout URL returned");
      location.assign(res.authorizationUrl);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  /** Payment is gated behind the unskippable terms card. */
  function handlePay() {
    setError(null);
    if (!agreed) {
      setTermsOpen("checkout");
      return;
    }
    void startCheckout();
  }

  function agreeAndContinue() {
    if (!canAgree) return;
    const reason = termsOpen;
    setAgreed(true);
    setTermsOpen(false);
    if (reason === "checkout") void startCheckout();
  }

  return (
    <div className="app-bg min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link to="/" className="focus-ring flex items-center gap-2 rounded-xl">
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl ring-1 ring-white/10" />
          <span className="text-[15px] font-semibold tracking-tight">Omnivex Academy</span>
        </Link>
        <Link
          to="/"
          className="focus-ring rounded-xl text-sm text-mist transition hover:text-white"
        >
          Exit
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-20 pt-4">
        {isActive ? (
          <div className="card animate-fade-up mx-auto max-w-md rounded-2xl p-8 text-center">
            <span className="text-4xl">🎉</span>
            <h1 className="mt-3 text-xl font-semibold">Membership is active</h1>
            <p className="mt-2 text-sm text-mist">
              You're all set — the mentorship rooms are open.
            </p>
            <Link
              to="/app/groups"
              className="btn-primary focus-ring mt-6 inline-block rounded-xl px-7 py-3 text-sm font-semibold"
            >
              Enter the academy
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-5">
            {/* Pricing card */}
            <section className="card animate-fade-up rounded-2xl p-6 sm:p-8 md:col-span-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/50 bg-accent-soft px-3 py-1 text-xs font-medium text-white">
                Membership
              </span>
              <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                Unlock the full academy
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-mist">
                One payment. Every room, every mentor, every announcement — plus
                high-priority premium KDP mentorship. No subscriptions, no tiers.
              </p>

              <div className="mt-6 flex items-end gap-2">
                <span className="text-4xl font-black tracking-tight sm:text-5xl">
                  {price !== null ? naira(price) : "—"}
                </span>
                <span className="pb-1.5 text-sm text-mist">one-time</span>
              </div>

              <ul className="mt-6 space-y-2.5">
                {perks.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-mist">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] text-white">
                      ✓
                    </span>
                    {p}
                  </li>
                ))}
              </ul>

              {data && !data.configured && (
                <p className="mt-6 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
                  Online checkout is being configured. If you've already paid, an
                  administrator will activate your account shortly.
                </p>
              )}

              <div className="mt-6 space-y-3">
                <p className="rounded-xl border border-line bg-surface-2/40 px-3.5 py-3 text-xs leading-relaxed text-mist">
                  {agreed ? (
                    <>You've accepted the academy terms (v{settings?.termsVersion ?? 1}).</>
                  ) : (
                    <>
                      Payment starts with a required terms card — scroll through it, then
                      agree to continue. You can also{" "}
                      <button
                        type="button"
                        onClick={() => setTermsOpen("view")}
                        className="focus-ring rounded font-medium text-accent underline underline-offset-2 transition hover:text-white"
                      >
                        read the academy terms
                      </button>{" "}
                      (v{settings?.termsVersion ?? 1}) first.
                    </>
                  )}
                </p>

                {error && (
                  <p
                    role="alert"
                    className="animate-fade-in rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                  >
                    {error}
                  </p>
                )}

                <button
                  onClick={handlePay}
                  disabled={busy || !data?.configured || price === null}
                  className="btn-primary focus-ring w-full rounded-xl py-3.5 text-sm font-semibold"
                >
                  {busy ? "Opening Paystack…" : `Pay ${price !== null ? naira(price) : ""} with Paystack`}
                </button>
                <p className="text-center text-[11px] text-mist">
                  Secured by Paystack · cards, bank transfer & USSD
                </p>
              </div>
            </section>

            {/* History / info */}
            <aside className="space-y-4 md:col-span-2">
              <div className="card rounded-2xl p-5">
                <h2 className="text-sm font-semibold">What you get</h2>
                <ul className="mt-3 space-y-3 text-xs leading-relaxed text-mist">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] text-white">
                      ✓
                    </span>
                    <span>Unlimited access to all mentorship groups, calls, and
                    academy content.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] text-white">
                      ✓
                    </span>
                    <span>High-priority premium KDP mentorship — direct access to
                    advanced publishing guidance when you need it.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] text-white">
                      ✓
                    </span>
                    <span>Direct messages with mentors and peers.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] text-white">
                      ✓
                    </span>
                    <span>Announcements and launch reviews as they happen.</span>
                  </li>
                </ul>
              </div>

              <div className="card rounded-2xl p-5">
                {user && (
                  <button
                    type="button"
                    onClick={() => {
                      api("/api/auth/sign-out", { method: "POST" }).finally(() => {
                        window.location.href = "/";
                      });
                    }}
                    className="focus-ring w-full rounded-xl border border-danger/40 py-3 text-sm font-semibold text-danger transition hover:bg-danger/10"
                  >
                    Sign out
                  </button>
                )
                }
              </div>

              <div className="card rounded-2xl p-5">
                <h2 className="text-sm font-semibold">Your payments</h2>
                {!data || data.payments.length === 0 ? (
                  <p className="mt-3 text-xs text-mist">No payments yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2.5">
                    {data.payments.map((p) => (
                      <li
                        key={p.reference}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-white">
                            {naira(p.amountKobo)}
                          </span>
                          <span className="block truncate text-[11px] text-mist">
                            {relTime(p.createdAt)} · {p.reference.slice(0, 10)}…
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusChip(p.status)}`}
                        >
                          {p.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="card rounded-2xl p-5">
                <h2 className="text-sm font-semibold">Need help?</h2>
                <p className="mt-2 text-xs leading-relaxed text-mist">
                  If your payment was charged but not activated, an admin can re-verify
                  it. Keep your reference number handy.
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Unskippable terms card — blocks the page until it is read and agreed */}
      {termsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/85 backdrop-blur-sm sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Academy terms — required before payment"
            className="card animate-pop flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
          >
            <div className="border-b border-line px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">Membership terms</h3>
                <span className="shrink-0 rounded-full border border-accent/50 bg-accent-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide">
                  Must read to continue
                </span>
              </div>
              <p className="mt-1 text-xs text-mist">
                Version {settings?.termsVersion ?? 1} · this step can't be skipped
              </p>
            </div>

            <div className="h-1 w-full bg-surface-3">
              <div
                className="h-full bg-gradient-to-r from-accent to-[#9b7bff] transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div
              ref={termsRef}
              onScroll={handleTermsScroll}
              className="scroll-thin flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-mist"
            >
              {settings?.termsText || "Terms are not available yet."}
            </div>

            <div className="border-t border-line px-5 py-4">
              <div className="mb-3 space-y-1.5">
                <Requirement done={reachedEnd}>
                  {reachedEnd
                    ? "You've reached the end of the terms"
                    : "Scroll through the entire terms"}
                </Requirement>
                <Requirement done={secondsLeft === 0}>
                  {secondsLeft === 0
                    ? "Reading time complete"
                    : `Reading time remaining — ${secondsLeft}s`}
                </Requirement>
              </div>

              <button
                onClick={agreeAndContinue}
                disabled={!canAgree}
                className="btn-primary focus-ring w-full rounded-xl py-3.5 text-sm font-semibold"
              >
                {canAgree ? "Agree & continue" : `Agree & continue (${secondsLeft}s)`}
              </button>
              <p className="mt-2 text-center text-[11px] text-mist">
                Payment begins only after you agree.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
