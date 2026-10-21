import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, fullTime, initials } from "../lib/api";
import { useMe, useSettings, pushSupported, subscribePush } from "../hooks";
import type { NotificationPrefs } from "../lib/types";
import { disconnectSocket } from "../lib/socket";

const prefLabels: [keyof NotificationPrefs, string, string][] = [
  ["push_enabled", "Push notifications", "Browser notifications on this device"],
  ["group_message_push", "Group activity", "New messages in your mentorship groups"],
  ["reply_push", "Replies", "When someone replies to your message"],
  ["dm_push", "Direct messages", "New private messages"],
  ["announcement_push", "Announcements", "Official academy updates"],
];

export default function ProfilePage() {
  const { data: me, refetch } = useMe();
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const nav = useNavigate();
  const user = me?.user;

  const [name, setName] = useState(user?.name || "");
  const [whatsapp, setWhatsapp] = useState(user?.whatsappNumber || "");
  const [country, setCountry] = useState(user?.country || "");
  const [stateRegion, setStateRegion] = useState(user?.stateRegion || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pushState, setPushState] = useState<"idle" | "busy" | "on" | "off">("idle");
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const { data: prefsRes } = useQuery({
    queryKey: ["notif-prefs"],
    queryFn: () => api<{ prefs: NotificationPrefs }>("/api/notifications/prefs"),
  });
  const prefs = prefsRes?.prefs;

  useEffect(() => {
    document.title = "Profile · Omnivex Academy";
    if (user) {
      setName(user.name);
      setWhatsapp(user.whatsappNumber || "");
      setCountry(user.country || "");
      setStateRegion(user.stateRegion || "");
      setGender(user.gender || "");
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    // Details are mandatory and cannot be cleared — only edited.
    if (!whatsapp.trim() || !country.trim() || !stateRegion.trim() || !gender) {
      setProfileMsg({
        ok: false,
        text: "All details are required and cannot be left empty.",
      });
      return;
    }
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      await api("/api/auth/update-user", {
        method: "POST",
        body: {
          name: name.trim(),
          whatsapp_number: whatsapp.trim(),
          country: country.trim(),
          state_region: stateRegion.trim(),
          gender,
        },
      });
      await refetch();
      setProfileMsg({ ok: true, text: "Profile updated." });
    } catch (err) {
      setProfileMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwMsg(null);
    try {
      await api("/api/me/password", {
        method: "POST",
        body: { currentPassword: curPw, newPassword: newPw },
      });
      setPwMsg({
        ok: true,
        text: "Password changed. For safety, please sign in again.",
      });
      setCurPw("");
      setNewPw("");
      setTimeout(async () => {
        disconnectSocket();
        try {
          await api("/api/auth/sign-out", { method: "POST" });
        } finally {
          await qc.invalidateQueries({ queryKey: ["me"] });
          nav("/auth?mode=signin");
        }
      }, 1500);
    } catch (err) {
      setPwMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setPwBusy(false);
    }
  }

  async function togglePref(key: keyof NotificationPrefs, value: boolean) {
    await api("/api/notifications/prefs", {
      method: "PUT",
      body: { [key]: value },
    });
    await qc.invalidateQueries({ queryKey: ["notif-prefs"] });
  }

  async function enablePush() {
    const publicKey = settings?.pushPublicKey;
    if (!publicKey) {
      setPushMsg("Push notifications aren't configured on this server yet.");
      return;
    }
    setPushState("busy");
    setPushMsg(null);
    const res = await subscribePush(publicKey);
    if (res.ok) {
      setPushState("on");
      setPushMsg("Push notifications enabled on this device.");
      await qc.invalidateQueries({ queryKey: ["notif-prefs"] });
    } else {
      setPushState("off");
      setPushMsg(
        res.error === "denied"
          ? "Notifications were blocked by your browser."
          : "Couldn't enable notifications on this device.",
      );
    }
  }

  const active = user?.membershipStatus === "active" || user?.isAdmin;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Profile</h1>
      <p className="mt-1 text-sm text-mist">Your account, membership, and alerts.</p>

      {/* Identity card */}
      <section className="card mt-5 overflow-hidden rounded-2xl">
        <div className="relative px-5 py-6">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{
              background:
                "radial-gradient(400px 120px at 50% 0%, rgba(40,13,255,0.35), transparent 70%)",
            }}
          />
          <div className="relative flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent text-xl font-bold">
              {initials(user?.name || "?")}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{user?.name}</h2>
              <p className="truncate text-sm text-mist">{user?.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                <span
                  className={`rounded-full border px-2 py-0.5 font-semibold uppercase ${
                    user?.emailVerified
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-warning/40 bg-warning/10 text-warning"
                  }`}
                >
                  {user?.emailVerified ? "Verified" : "Unverified"}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 font-semibold uppercase ${
                    active
                      ? "border-accent/50 bg-accent-soft text-white"
                      : "border-line bg-surface-2/60 text-mist"
                  }`}
                >
                  {user?.isAdmin
                    ? "Administrator"
                    : active
                      ? "Active member"
                      : "Membership inactive"}
                </span>
                {user?.createdAt && (
                  <span className="text-mist/70">
                    Joined {fullTime(user.createdAt).split(",")[0]}
                  </span>
                )}
              </div>
            </div>
          </div>

          {!active && (
            <button
              onClick={() => nav("/paywall")}
              className="btn-primary focus-ring relative mt-5 w-full rounded-xl py-3 text-sm font-semibold"
            >
              Activate membership
            </button>
          )}
          {user?.isAdmin && (
            <button
              onClick={() => nav("/admin")}
              className="focus-ring relative mt-5 w-full rounded-xl border border-warning/40 py-3 text-sm font-semibold text-warning transition hover:bg-warning/10"
            >
              Open admin panel
            </button>
          )}
        </div>
      </section>

      {/* Details form */}
      <section className="card mt-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Your details</h2>
        <form onSubmit={saveProfile} className="mt-4 space-y-4">
          <div>
            <label htmlFor="p-name" className="mb-1.5 block text-xs font-medium text-mist">
              Full name
            </label>
            <input
              id="p-name"
              className="input focus-ring"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="p-wa" className="mb-1.5 block text-xs font-medium text-mist">
                WhatsApp <span className="text-danger">*</span>
              </label>
              <input
                id="p-wa"
                className="input focus-ring"
                placeholder="+234…"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="p-country" className="mb-1.5 block text-xs font-medium text-mist">
                Country <span className="text-danger">*</span>
              </label>
              <input
                id="p-country"
                className="input focus-ring"
                placeholder="Nigeria"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="p-state" className="mb-1.5 block text-xs font-medium text-mist">
                State / region <span className="text-danger">*</span>
              </label>
              <input
                id="p-state"
                className="input focus-ring"
                placeholder="Lagos"
                value={stateRegion}
                onChange={(e) => setStateRegion(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label htmlFor="p-gender" className="mb-1.5 block text-xs font-medium text-mist">
              Gender <span className="text-danger">*</span>
            </label>
            <select
              id="p-gender"
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

          {profileMsg && (
            <p
              className={`rounded-xl border px-3 py-2.5 text-sm ${
                profileMsg.ok
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {profileMsg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={profileBusy}
            className="btn-primary focus-ring rounded-xl px-6 py-2.5 text-sm font-semibold"
          >
            {profileBusy ? "Saving…" : "Save changes"}
          </button>
        </form>
      </section>

      {/* Notifications */}
      <section className="card mt-4 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {pushSupported() && (
            <button
              onClick={() => void enablePush()}
              disabled={pushState === "busy"}
              className="focus-ring rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-mist transition hover:border-accent hover:text-white disabled:opacity-50"
            >
              {pushState === "busy"
                ? "Enabling…"
                : pushState === "on"
                  ? "Enabled ✓"
                  : "Enable push"}
            </button>
          )}
        </div>
        {pushMsg && <p className="mt-2 text-xs text-mist">{pushMsg}</p>}

        <ul className="mt-4 space-y-1">
          {prefLabels.map(([key, label, hint]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-4 rounded-xl px-1 py-2.5"
            >
              <span>
                <span className="block text-sm">{label}</span>
                <span className="block text-xs text-mist">{hint}</span>
              </span>
              <button
                role="switch"
                aria-checked={Boolean(prefs?.[key])}
                onClick={() => void togglePref(key, !prefs?.[key])}
                className={`focus-ring relative h-6 w-11 shrink-0 rounded-full transition ${
                  prefs?.[key] ? "bg-accent" : "bg-surface-3"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    prefs?.[key] ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Security */}
      <section className="card mt-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Change password</h2>
        <form onSubmit={changePassword} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cur" className="mb-1.5 block text-xs font-medium text-mist">
                Current password
              </label>
              <input
                id="cur"
                type="password"
                className="input focus-ring"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label htmlFor="new" className="mb-1.5 block text-xs font-medium text-mist">
                New password
              </label>
              <input
                id="new"
                type="password"
                className="input focus-ring"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          {pwMsg && (
            <p
              className={`rounded-xl border px-3 py-2.5 text-sm ${
                pwMsg.ok
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {pwMsg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={pwBusy}
            className="btn-ghost focus-ring rounded-xl px-6 py-2.5 text-sm font-semibold"
          >
            {pwBusy ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <div className="mt-6 pb-4">
        <button
          onClick={async () => {
            try {
              await api("/api/auth/sign-out", { method: "POST" });
            } finally {
              disconnectSocket();
              await qc.invalidateQueries({ queryKey: ["me"] });
              location.href = "/";
            }
          }}
          className="focus-ring w-full rounded-xl border border-danger/40 py-3 text-sm font-semibold text-danger transition hover:bg-danger/10"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
