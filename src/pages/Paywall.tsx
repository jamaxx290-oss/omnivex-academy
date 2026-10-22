import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage, naira, fullTime, relTime } from "../lib/api";
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
  "Unlimited access to every mentorship group",
  "Direct messages with mentors and peers",
  "Voice notes, images, and video in every chat",
  "Announcements and launch reviews as they happen",
];

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
  const { data: me, refetch: refetchMe } = useMe();
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function startCheckout() {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ authorizationUrl: string }>("/api/payments/initialize", {
        method: "POST",
      });
      if (!res.authorizationUrl) throw new Error("No checkout URL returned");
      location.assign(res.authorizationUrl);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
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
                One payment. Every room, every mentor, every announcement — no
                subscriptions, no tiers.
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
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className="text-xs leading-relaxed text-mist">
                    I have read and agree to the{" "}
                    <button
                      type="button"
                      onClick={() => setShowTerms(true)}
                      className="focus-ring rounded font-medium text-accent underline underline-offset-2 transition hover:text-white"
                    >
                      academy terms
                    </button>{" "}
                    (v{settings?.termsVersion ?? 1}).
                  </span>
                </label>

                {error && (
                  <p
                    role="alert"
                    className="animate-fade-in rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                  >
                    {error}
                  </p>
                )}

                <button
                  onClick={startCheckout}
                  disabled={!agreed || busy || !data?.configured || price === null}
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
                <h2 className="text-sm font-semibold">What happens next</h2>
                <ol className="mt-3 space-y-3 text-xs leading-relaxed text-mist">
                  <li>
                    <span className="font-semibold text-white">1.</span> Pay securely in
                    naira on Paystack's checkout.
                  </li>
                  <li>
                    <span className="font-semibold text-white">2.</span> You're redirected
                    back — we verify the transaction server-side.
                  </li>
                  <li>
                    <span className="font-semibold text-white">3.</span> Membership
                    activates instantly and the rooms open.
                  </li>
                </ol>
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

      {/* Terms dialog */}
      {showTerms && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setShowTerms(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Academy terms"
            className="card animate-pop flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h3 className="text-base font-semibold">Academy terms</h3>
                <p className="text-xs text-mist">
                  Version {settings?.termsVersion ?? 1} · updated{" "}
                  {settings ? fullTime(new Date().toISOString()) : "recently"}
                </p>
              </div>
              <button
                onClick={() => setShowTerms(false)}
                className="focus-ring rounded-lg px-2 py-1 text-mist transition hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-mist">
              {settings?.termsText || "Terms are not available yet."}
            </div>
            <div className="border-t border-line px-5 py-4">
              <button
                onClick={() => {
                  setAgreed(true);
                  setShowTerms(false);
                }}
                className="btn-primary focus-ring w-full rounded-xl py-3 text-sm font-semibold"
              >
                I agree to these terms
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
