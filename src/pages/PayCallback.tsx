import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../hooks";
import { getSocket } from "../lib/socket";

type VerifyResult = {
  status: string;
  message?: string;
  membershipStatus?: string;
};

export default function PayCallbackPage() {
  const [params] = useSearchParams();
  const reference = params.get("reference");
  const qc = useQueryClient();
  const { refetch } = useMe();

  const [state, setState] = useState<"checking" | "success" | "pending" | "failed">(
    "checking",
  );
  const [message, setMessage] = useState<string>("");
  const attempts = useRef(0);
  const timers = useRef<number[]>([]);

  async function verify() {
    if (!reference) {
      setState("failed");
      setMessage("Missing payment reference.");
      return;
    }
    setState("checking");
    try {
      const res = await api<VerifyResult>(
        `/api/payments/verify/${encodeURIComponent(reference)}`,
        { method: "POST" },
      );
      if (res.status === "success") {
        setState("success");
        setMessage(res.message || "Payment confirmed.");
        await refetch();
        await qc.invalidateQueries({ queryKey: ["pay-status"] });
        return;
      }
      if (res.status === "pending" || res.status === "processing") {
        attempts.current += 1;
        if (attempts.current < 5) {
          const t = window.setTimeout(verify, 2500);
          timers.current.push(t);
        } else {
          setState("pending");
          setMessage(
            "Your payment is still processing. We'll activate your membership automatically once Paystack confirms it.",
          );
        }
        return;
      }
      setState("failed");
      setMessage(res.message || `Payment ${res.status}.`);
    } catch (err) {
      const msg = errorMessage(err);
      attempts.current += 1;
      if (attempts.current < 3) {
        const t = window.setTimeout(verify, 3000);
        timers.current.push(t);
      } else {
        setState("failed");
        setMessage(msg);
      }
    }
  }

  useEffect(() => {
    document.title = "Payment status · Omnivex Academy";
    void verify();
    const socket = getSocket();
    const onUpdate = (payload: { reference?: string; status?: string }) => {
      if (payload.reference === reference && payload.status === "success") {
        setState("success");
        setMessage("Payment confirmed.");
        void refetch();
        void qc.invalidateQueries({ queryKey: ["pay-status"] });
      }
    };
    socket.on("payment:updated", onUpdate);
    const localTimers = timers.current;
    return () => {
      socket.off("payment:updated", onUpdate);
      localTimers.forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  return (
    <div className="app-bg flex min-h-screen items-center justify-center px-5">
      <div className="card animate-fade-up w-full max-w-md rounded-2xl p-7 text-center">
        {state === "checking" && (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-line border-t-accent" />
            <h1 className="mt-5 text-lg font-semibold">Verifying your payment…</h1>
            <p className="mt-2 text-sm text-mist">
              We're confirming reference{" "}
              <span className="font-medium text-white">{reference || "—"}</span> with
              Paystack. This takes a few seconds.
            </p>
          </>
        )}

        {state === "success" && (
          <>
            <span className="text-4xl">🎉</span>
            <h1 className="mt-3 text-xl font-semibold">Membership activated</h1>
            <p className="mt-2 text-sm text-mist">
              Payment confirmed — the mentorship rooms are open.
            </p>
            <Link
              to="/app/groups"
              className="btn-primary focus-ring mt-6 inline-block rounded-xl px-7 py-3 text-sm font-semibold"
            >
              Enter the academy
            </Link>
          </>
        )}

        {state === "pending" && (
          <>
            <span className="text-4xl">⏳</span>
            <h1 className="mt-3 text-xl font-semibold">Payment processing</h1>
            <p className="mt-2 text-sm leading-relaxed text-mist">{message}</p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={() => {
                  attempts.current = 0;
                  void verify();
                }}
                className="btn-primary focus-ring rounded-xl py-3 text-sm font-semibold"
              >
                Check again
              </button>
              <Link
                to="/app/groups"
                className="btn-ghost focus-ring rounded-xl py-3 text-sm font-semibold"
              >
                Go to the academy
              </Link>
            </div>
          </>
        )}

        {state === "failed" && (
          <>
            <span className="text-4xl">⚠️</span>
            <h1 className="mt-3 text-xl font-semibold">We couldn't verify payment</h1>
            <p className="mt-2 text-sm leading-relaxed text-danger">{message}</p>
            <p className="mt-2 text-xs text-mist">
              If you were charged, an administrator can re-verify reference{" "}
              <span className="font-medium text-white">{reference || "—"}</span>.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={() => {
                  attempts.current = 0;
                  void verify();
                }}
                className="btn-primary focus-ring rounded-xl py-3 text-sm font-semibold"
              >
                Try again
              </button>
              <Link
                to="/paywall"
                className="btn-ghost focus-ring rounded-xl py-3 text-sm font-semibold"
              >
                Back to payment
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
