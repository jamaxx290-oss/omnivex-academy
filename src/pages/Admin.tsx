import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  errorMessage,
  naira,
  relTime,
  fullTime,
  initials,
  type ApiError,
} from "../lib/api";
import type {
  AdminStats,
  AdminGroupRow,
  Announcement,
  GroupJoinRequest,
  MemberRow,
  PaymentRow,
} from "../lib/types";
import { useMe } from "../hooks";
import { broadcastEmail } from "../server/emailTemplates";

type Tab = "dashboard" | "members" | "groups" | "payments" | "email" | "settings" | "news";

const tabs: [Tab, string][] = [
  ["dashboard", "Dashboard"],
  ["members", "Members"],
  ["groups", "Groups"],
  ["payments", "Payments"],
  ["email", "Email"],
  ["settings", "Settings"],
  ["news", "Announcements"],
];

function useAdminGuard() {
  const { data, isLoading } = useMe();
  if (isLoading) return { ready: false, isAdmin: false };
  return { ready: true, isAdmin: Boolean(data?.user?.isAdmin) };
}

function StatusChip({ status, banned }: { status: string; banned?: boolean }) {
  const cls = banned
    ? "border-danger/40 bg-danger/10 text-danger"
    : status === "active"
      ? "border-success/40 bg-success/10 text-success"
      : status === "revoked"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-line bg-surface-2/60 text-mist";
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}
    >
      {banned ? "Banned" : status}
    </span>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { ready, isAdmin } = useAdminGuard();
  const { data: me } = useMe();

  useEffect(() => {
    document.title = "Admin · Omnivex Academy";
  }, []);

  if (ready && !isAdmin) {
    return (
      <div className="app-bg flex min-h-screen items-center justify-center px-6">
        <div className="card max-w-sm rounded-2xl p-8 text-center">
          <span className="text-3xl">🔒</span>
          <h1 className="mt-3 text-lg font-semibold">Admins only</h1>
          <p className="mt-2 text-sm text-mist">
            You need administrator access to view this page.
          </p>
          <Link
            to="/app/groups"
            className="btn-primary focus-ring mt-6 inline-block rounded-xl px-6 py-2.5 text-sm font-semibold"
          >
            Back to the academy
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-bg min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-black/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/app/groups"
              className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl border border-line text-mist transition hover:border-accent hover:text-white"
              aria-label="Back to app"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </Link>
            <div>
              <h1 className="text-sm font-semibold leading-tight sm:text-base">
                Admin panel
              </h1>
              <p className="hidden text-xs text-mist sm:block">
                Signed in as {me?.user?.name}
              </p>
            </div>
          </div>
          <span className="hidden rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-warning sm:block">
            Administrator
          </span>
        </div>
        <div className="scroll-thin mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`focus-ring shrink-0 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
                tab === key ? "bg-accent text-white" : "text-mist hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {tab === "dashboard" && <Dashboard />}
        {tab === "members" && <Members />}
        {tab === "groups" && <GroupsAdmin />}
        {tab === "payments" && <PaymentsAdmin />}
        {tab === "email" && <EmailAdmin />}
        {tab === "settings" && <SettingsAdmin />}
        {tab === "news" && <AnnouncementsAdmin />}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api<AdminStats>("/api/admin/stats"),
  });

  if (isLoading || !data) {
    return <div className="card h-40 animate-pulse rounded-2xl" />;
  }

  const stats = [
    { label: "Total members", value: String(data.totalMembers) },
    { label: "Active memberships", value: String(data.activeMembers) },
    { label: "Verified emails", value: String(data.verifiedMembers) },
    { label: "Groups", value: String(data.groupsCount) },
    { label: "Successful payments", value: String(data.payments.success) },
    { label: "Revenue", value: naira(data.payments.revenueKobo) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="card rounded-2xl p-4">
            <p className="text-xl font-bold tracking-tight sm:text-2xl">{s.value}</p>
            <p className="mt-1 text-xs text-mist">{s.label}</p>
          </div>
        ))}
      </div>

      {!data.paystackConfigured && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          Paystack keys are not configured — online checkout is disabled. Set
          PAYSTACK_SECRET_KEY (and the public key) in the environment, then restart.
        </p>
      )}

      <div className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Recent signups</h2>
        <ul className="mt-3 divide-y divide-line">
          {data.recentSignups.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm">{u.name}</span>
                <span className="block truncate text-xs text-mist">{u.email}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <StatusChip status={u.status} />
                <span className="hidden text-[10px] text-mist sm:block">
                  {relTime(u.createdAt)}
                </span>
              </span>
            </li>
          ))}
          {data.recentSignups.length === 0 && (
            <li className="py-3 text-sm text-mist">No signups yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

function Members() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-members", q, status, page],
    queryFn: () =>
      api<{ members: MemberRow[]; total: number; perPage: number }>(
        `/api/admin/members?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page}`,
      ),
  });

  async function act(id: string, action: string, expiresAt?: string) {
    setBusy(id + action);
    setError(null);
    try {
      await api(`/api/admin/members/${id}/action`, {
        method: "POST",
        body: { action, expiresAt },
      });
      await qc.invalidateQueries({ queryKey: ["admin-members"] });
      await qc.invalidateQueries({ queryKey: ["admin-stats"] });
      await qc.invalidateQueries({ queryKey: ["admin-member-detail"] });
    } catch (err) {
      const e = err as ApiError;
      setError(e.status === 403 ? "Admin session expired — sign in again." : errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input focus-ring text-sm"
          placeholder="Search name, email, or WhatsApp…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="input focus-ring text-sm sm:w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="none">None</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="card overflow-hidden rounded-2xl">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2/50" />
            ))}
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-mist">
                <tr>
                  <th className="px-4 py-3 font-semibold">Member</th>
                  <th className="px-4 py-3 font-semibold">WhatsApp</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(data?.members || []).map((m) => (
                  <tr key={m.id} className="hover:bg-surface-2/30">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDetailId(m.id)}
                        className="focus-ring flex items-center gap-2.5 rounded text-left"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold">
                          {initials(m.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{m.name}</span>
                          <span className="block truncate text-xs text-mist">
                            {m.email}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-mist">
                      {m.whatsappNumber || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={m.membershipStatus} banned={m.banned} />
                    </td>
                    <td className="px-4 py-3 text-xs text-mist">
                      {relTime(m.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {m.membershipStatus !== "active" ? (
                          <button
                            onClick={() => void act(m.id, "grant_membership")}
                            disabled={busy === m.id + "grant_membership"}
                            className="focus-ring rounded-lg border border-success/40 px-2 py-1 text-[11px] font-semibold text-success transition hover:bg-success/10 disabled:opacity-50"
                          >
                            Grant
                          </button>
                        ) : (
                          <button
                            onClick={() => void act(m.id, "revoke_membership")}
                            disabled={busy === m.id + "revoke_membership"}
                            className="focus-ring rounded-lg border border-warning/40 px-2 py-1 text-[11px] font-semibold text-warning transition hover:bg-warning/10 disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                        {m.banned ? (
                          <button
                            onClick={() => void act(m.id, "unban")}
                            className="focus-ring rounded-lg border border-line px-2 py-1 text-[11px] text-mist transition hover:text-white"
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (confirm(`Ban ${m.name}?`)) void act(m.id, "ban");
                            }}
                            className="focus-ring rounded-lg border border-danger/40 px-2 py-1 text-[11px] font-semibold text-danger transition hover:bg-danger/10"
                          >
                            Ban
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {(data?.members || []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-mist">
                      No members match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-mist">
          <span>
            Page {page} of {totalPages} · {data?.total || 0} members
          </span>
          <span className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="focus-ring rounded-lg border border-line px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="focus-ring rounded-lg border border-line px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </span>
        </div>
      )}

      {detailId && (
        <MemberDetail id={detailId} onClose={() => setDetailId(null)} onAct={act} />
      )}
    </div>
  );
}

function MemberDetail({
  id,
  onClose,
  onAct,
}: {
  id: string;
  onClose: () => void;
  onAct: (id: string, action: string, expiresAt?: string) => Promise<void>;
}) {
  const { data } = useQuery({
    queryKey: ["admin-member-detail", id],
    queryFn: () =>
      api<{
        member: MemberRow;
        payments: {
          reference: string;
          amountKobo: number;
          status: string;
          createdAt: string;
        }[];
      }>(`/api/admin/members/${id}`),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="card animate-pop flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-base font-semibold">Member details</h3>
          <button
            onClick={onClose}
            className="focus-ring rounded-lg px-2 py-1 text-mist hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!data ? (
          <div className="p-6 text-center text-sm text-mist">Loading…</div>
        ) : (
          <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-sm font-bold">
                {initials(data.member.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{data.member.name}</p>
                <p className="truncate text-sm text-mist">{data.member.email}</p>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-mist">Status</dt>
                <dd className="mt-0.5">
                  <StatusChip
                    status={data.member.membershipStatus}
                    banned={data.member.banned}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mist">Email</dt>
                <dd className="mt-0.5 text-xs">
                  {data.member.emailVerified ? "Verified ✓" : "Not verified"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mist">WhatsApp</dt>
                <dd className="mt-0.5 text-xs">
                  {data.member.whatsappNumber || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mist">Joined</dt>
                <dd className="mt-0.5 text-xs">
                  {fullTime(data.member.createdAt)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-mist">Expires</dt>
                <dd className="mt-0.5 text-xs">
                  {data.member.membershipExpiresAt
                    ? fullTime(data.member.membershipExpiresAt)
                    : "Never"}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              {!data.member.emailVerified && (
                <button
                  onClick={() => void onAct(id, "resend_verification")}
                  className="focus-ring rounded-lg border border-line px-3 py-1.5 text-xs text-mist transition hover:border-accent hover:text-white"
                >
                  Resend verification email
                </button>
              )}
              <button
                onClick={() => {
                  const v = prompt("Set expiry (YYYY-MM-DD):");
                  if (!v) return;
                  const iso = new Date(`${v}T23:59:59`).toISOString();
                  if (!Number.isNaN(Date.parse(iso))) {
                    void onAct(id, "set_expiry", iso);
                  }
                }}
                className="focus-ring rounded-lg border border-line px-3 py-1.5 text-xs text-mist transition hover:border-accent hover:text-white"
              >
                Set expiry
              </button>
              {!data.member.isAdmin && (
                <button
                  onClick={() => {
                    if (confirm(`Permanently delete ${data.member.name}?`)) {
                      void onAct(id, "delete").then(onClose);
                    }
                  }}
                  className="focus-ring rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/10"
                >
                  Delete account
                </button>
              )}
            </div>

            <h4 className="mt-6 text-sm font-semibold">Payments</h4>
            {data.payments.length === 0 ? (
              <p className="mt-2 text-xs text-mist">No payments recorded.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.payments.map((p) => (
                  <li
                    key={p.reference}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-xs"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-white">
                        {naira(p.amountKobo)} · {p.status}
                      </span>
                      <span className="block truncate text-mist">
                        {p.reference} · {relTime(p.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

function GroupsAdmin() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminGroupRow | null>(null);
  const [requestsFor, setRequestsFor] = useState<AdminGroupRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-groups"],
    queryFn: () => api<{ groups: AdminGroupRow[] }>("/api/admin/groups"),
  });

  async function archive(g: AdminGroupRow) {
    if (!confirm(`Archive “${g.name}”? It disappears for all members.`)) return;
    try {
      await api(`/api/admin/groups/${g.id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["admin-groups"] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function setMember(g: AdminGroupRow, userId: string, op: "add" | "remove") {
    try {
      await api(`/api/admin/groups/${g.id}/members`, {
        method: "POST",
        body: { userId, op },
      });
      await qc.invalidateQueries({ queryKey: ["admin-groups"] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-mist">
          {data?.groups.length || 0} group{(data?.groups.length || 0) === 1 ? "" : "s"}
        </p>
        <button
          onClick={() => setCreating(true)}
          className="btn-primary focus-ring rounded-xl px-4 py-2.5 text-xs font-semibold"
        >
          + New group
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {isLoading && <div className="card h-24 animate-pulse rounded-2xl" />}

      <div className="grid gap-3 md:grid-cols-2">
        {(data?.groups || []).map((g) => (
          <div key={g.id} className="card rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{g.name}</h3>
                <p className="mt-0.5 truncate text-xs text-mist">
                  {g.description || "No description"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  g.archived
                    ? "border-line bg-surface-2/60 text-mist"
                    : "border-success/40 bg-success/10 text-success"
                }`}
              >
                {g.archived ? "Archived" : "Live"}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mist">
              <span>{g.members.length} members</span>
              <span>{g.messageCount} messages</span>
              <span>
                {g.sendPolicy === "everyone" ? "Everyone can post" : "Admins only"}
              </span>
              <span>
                {g.joinPolicy === "open" ? "Open join" : "Request to join"}
              </span>
              <span>{relTime(g.createdAt)}</span>
              {g.pendingRequests > 0 && (
                <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                  {g.pendingRequests} pending
                </span>
              )}
            </div>

            {g.members.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {g.members.slice(0, 8).map((m) => (
                  <span
                    key={m.id}
                    className="group inline-flex items-center gap-1 rounded-full border border-line bg-surface-2/50 py-0.5 pl-2 pr-1 text-[10px]"
                    title={m.role}
                  >
                    {m.name}
                    <button
                      onClick={() => void setMember(g, m.id, "remove")}
                      className="focus-ring rounded-full px-1 text-mist hover:text-danger"
                      aria-label={`Remove ${m.name}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {g.members.length > 8 && (
                  <span className="text-[10px] text-mist">
                    +{g.members.length - 8} more
                  </span>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEditing(g)}
                className="focus-ring flex-1 rounded-xl border border-line py-2 text-xs font-medium text-mist transition hover:border-accent hover:text-white"
              >
                Edit
              </button>
              {g.pendingRequests > 0 && (
                <button
                  onClick={() => setRequestsFor(g)}
                  className="focus-ring rounded-xl border border-warning/40 px-3 py-2 text-xs font-semibold text-warning transition hover:bg-warning/10"
                >
                  Requests ({g.pendingRequests})
                </button>
              )}
              {!g.archived && (
                <button
                  onClick={() => void archive(g)}
                  className="focus-ring rounded-xl border border-danger/40 px-3 py-2 text-xs font-semibold text-danger transition hover:bg-danger/10"
                >
                  Archive
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {(data?.groups || []).length === 0 && !isLoading && (
        <div className="card rounded-2xl p-8 text-center">
          <h2 className="text-base font-semibold">No groups yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-mist">
            Create the first mentorship room — e.g. “Launch Lab”, “Cover Reviews”, or
            “AMS Ads”.
          </p>
        </div>
      )}

      {creating && (
        <GroupForm
          onClose={() => setCreating(false)}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["admin-groups"] })}
        />
      )}
      {editing && (
        <GroupForm
          group={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["admin-groups"] })}
        />
      )}
      {requestsFor && (
        <JoinRequestsPanel
          group={requestsFor}
          onClose={() => setRequestsFor(null)}
          onChanged={() => void qc.invalidateQueries({ queryKey: ["admin-groups"] })}
        />
      )}
    </div>
  );
}

function JoinRequestsPanel({
  group,
  onClose,
  onChanged,
}: {
  group: AdminGroupRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, refetch } = useQuery({
    queryKey: ["admin-group-requests", group.id],
    queryFn: () =>
      api<{ requests: GroupJoinRequest[] }>(`/api/admin/groups/${group.id}/requests`),
  });

  async function decide(userId: string, action: "approve" | "deny") {
    await api(`/api/admin/groups/${group.id}/requests`, {
      method: "POST",
      body: { userId, action },
    });
    await refetch();
    onChanged();
  }

  const pending = (data?.requests || []).filter((r) => r.status === "pending");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="card animate-pop flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Join requests</h3>
            <p className="text-xs text-mist">{group.name}</p>
          </div>
          <button
            onClick={onClose}
            className="focus-ring rounded-lg px-2 py-1 text-mist hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {pending.length === 0 && (
            <p className="py-6 text-center text-sm text-mist">
              No pending requests.
            </p>
          )}
          {pending.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.userName}</p>
                <p className="truncate text-xs text-mist">{r.userEmail}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => void decide(r.userId, "approve")}
                  className="focus-ring rounded-lg border border-success/40 px-2.5 py-1 text-xs font-semibold text-success transition hover:bg-success/10"
                >
                  Approve
                </button>
                <button
                  onClick={() => void decide(r.userId, "deny")}
                  className="focus-ring rounded-lg border border-danger/40 px-2.5 py-1 text-xs font-semibold text-danger transition hover:bg-danger/10"
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupForm({
  group,
  onClose,
  onSaved,
}: {
  group?: AdminGroupRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name || "");
  const [description, setDescription] = useState(group?.description || "");
  const [sendPolicy, setSendPolicy] = useState<"everyone" | "admins_only">(
    group?.sendPolicy || "everyone",
  );
  const [joinPolicy, setJoinPolicy] = useState<"open" | "request">(
    group?.joinPolicy || "open",
  );
  const [picturePath, setPicturePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: dir } = useQuery({
    queryKey: ["members-dir", ""],
    queryFn: () => api<{ members: { id: string; name: string }[] }>("/api/members"),
  });
  const { data: allMembers } = useQuery({
    queryKey: ["admin-all-members"],
    queryFn: () =>
      api<{ members: { id: string; name: string }[] }>(
        "/api/admin/members?perPage=1000",
      ),
  });

  const [picked, setPicked] = useState<Set<string>>(
    new Set(group?.members.map((m) => m.id) || []),
  );

  const candidates = allMembers?.members || dir?.members || [];

  async function pickPicture(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "avatar");
      const res = await api<{ path: string }>("/api/uploads", {
        method: "POST",
        body: fd,
      });
      setPicturePath(res.path);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (group) {
        await api(`/api/admin/groups/${group.id}`, {
          method: "PATCH",
          body: {
            name: name.trim(),
            description: description.trim() || null,
            sendPolicy,
            joinPolicy,
            ...(picturePath ? { picturePath } : {}),
          },
        });
      } else {
        await api("/api/admin/groups", {
          method: "POST",
          body: {
            name: name.trim(),
            description: description.trim() || null,
            sendPolicy,
            joinPolicy,
            memberIds: [...picked],
            ...(picturePath ? { picturePath } : {}),
          },
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="card animate-pop flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-base font-semibold">
            {group ? "Edit group" : "Create group"}
          </h3>
          <button
            onClick={onClose}
            className="focus-ring rounded-lg px-2 py-1 text-mist hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="scroll-thin flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label htmlFor="g-name" className="mb-1.5 block text-xs font-medium text-mist">
              Group name
            </label>
            <input
              id="g-name"
              className="input focus-ring"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Launch Lab"
              required
            />
          </div>
          <div>
            <label htmlFor="g-desc" className="mb-1.5 block text-xs font-medium text-mist">
              Description
            </label>
            <textarea
              id="g-desc"
              className="input focus-ring resize-none text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this room for?"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">
              Who can post
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["everyone", "Everyone"],
                  ["admins_only", "Admins only"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSendPolicy(v)}
                  className={`focus-ring rounded-xl border px-3 py-2.5 text-xs font-medium transition ${
                    sendPolicy === v
                      ? "border-accent bg-accent-soft text-white"
                      : "border-line text-mist hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">
              Who can join
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["open", "Everyone can join"],
                  ["request", "Request to join"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setJoinPolicy(v)}
                  className={`focus-ring rounded-xl border px-3 py-2.5 text-xs font-medium transition ${
                    joinPolicy === v
                      ? "border-accent bg-accent-soft text-white"
                      : "border-line text-mist hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-mist">
              {joinPolicy === "open"
                ? "Any signed-in member can open this room instantly."
                : "Members see the room but must request access, which you approve."}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">Picture</label>
            <div className="flex items-center gap-3">
              {picturePath ? (
                <img
                  src={`/media/${picturePath}`}
                  alt=""
                  className="h-12 w-12 rounded-xl object-cover"
                />
              ) : group?.pictureUrl ? (
                <img
                  src={group.pictureUrl}
                  alt=""
                  className="h-12 w-12 rounded-xl object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-sm font-bold">
                  {initials(name || "G")}
                </span>
              )}
              <label className="focus-ring cursor-pointer rounded-xl border border-line px-3 py-2 text-xs text-mist transition hover:border-accent hover:text-white">
                {uploading ? "Uploading…" : "Upload image"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void pickPicture(f);
                  }}
                />
              </label>
            </div>
          </div>

          {!group && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">
                Members ({picked.size} selected)
              </label>
              <div className="scroll-thin max-h-48 overflow-y-auto rounded-xl border border-line p-2">
                {candidates.length === 0 && (
                  <p className="px-2 py-3 text-xs text-mist">No members to add yet.</p>
                )}
                {candidates.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2/50"
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(m.id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(m.id);
                        else next.delete(m.id);
                        setPicked(next);
                      }}
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                    <span className="truncate text-sm">{m.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <div className="flex gap-2 pb-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost focus-ring flex-1 rounded-xl py-2.5 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="btn-primary focus-ring flex-1 rounded-xl py-2.5 text-sm font-semibold"
            >
              {busy ? "Saving…" : group ? "Save changes" : "Create group"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

function PaymentsAdmin() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-payments", status, q],
    queryFn: () =>
      api<{ payments: PaymentRow[] }>(
        `/api/admin/payments?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`,
      ),
  });

  async function reverify(reference: string) {
    setBusy(reference);
    setMsg(null);
    try {
      const res = await api<{ status: string }>(
        `/api/admin/payments/${encodeURIComponent(reference)}/reverify`,
        { method: "POST" },
      );
      setMsg(`${reference.slice(0, 12)}… → ${res.status}`);
      await qc.invalidateQueries({ queryKey: ["admin-payments"] });
      await qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input focus-ring text-sm"
          placeholder="Search reference, name, or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input focus-ring text-sm sm:w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </div>

      {msg && (
        <p className="rounded-xl border border-line bg-surface-2/50 px-3 py-2 text-xs text-mist">
          Re-verify: {msg}
        </p>
      )}

      <div className="card overflow-hidden rounded-2xl">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2/50" />
            ))}
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-mist">
                <tr>
                  <th className="px-4 py-3 font-semibold">Member</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(data?.payments || []).map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/30">
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium">{p.userName}</span>
                      <span className="block truncate text-xs text-mist">
                        {p.userEmail}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{naira(p.amountKobo)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          p.status === "success"
                            ? "border-success/40 bg-success/10 text-success"
                            : p.status === "pending"
                              ? "border-warning/40 bg-warning/10 text-warning"
                              : "border-danger/40 bg-danger/10 text-danger"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-mist">
                      {p.reference}
                    </td>
                    <td className="px-4 py-3 text-xs text-mist">
                      {relTime(p.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => void reverify(p.reference)}
                        disabled={busy === p.reference}
                        className="focus-ring rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-mist transition hover:border-accent hover:text-white disabled:opacity-50"
                      >
                        {busy === p.reference ? "…" : "Re-verify"}
                      </button>
                    </td>
                  </tr>
                ))}
                {(data?.payments || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-mist">
                      No payments match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function SettingsAdmin() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () =>
      api<{
        priceKobo: number | null;
        terms: { text: string; version: number };
        senderName: string;
        senderEmail: string;
        paystackConfigured: boolean;
      }>("/api/admin/settings"),
  });

  const [price, setPrice] = useState("");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data) {
      setPrice(
        data.priceKobo !== null ? String(data.priceKobo / 100) : "",
      );
      setTerms(data.terms.text);
    }
  }, [data?.priceKobo, data?.terms.version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {};
      const n = Number(price);
      if (!Number.isNaN(n) && n >= 0) body.priceNaira = n;
      if (terms !== (data?.terms.text || "")) body.termsText = terms;
      await api("/api/admin/settings", { method: "PUT", body });
      setMsg({ ok: true, text: "Settings saved. Terms version was bumped if changed." });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !data) {
    return <div className="card h-40 animate-pulse rounded-2xl" />;
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Membership pricing</h2>
        <p className="mt-1 text-xs text-mist">
          Charged once per member, in naira, through Paystack.
        </p>
        <div className="mt-4 max-w-xs">
          <label htmlFor="price" className="mb-1.5 block text-xs font-medium text-mist">
            Price (₦)
          </label>
          <input
            id="price"
            type="number"
            min={0}
            step="0.01"
            className="input focus-ring"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <p
          className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${
            data.paystackConfigured
              ? "border-success/40 bg-success/10 text-success"
              : "border-warning/40 bg-warning/10 text-warning"
          }`}
        >
          {data.paystackConfigured ? "Paystack configured" : "Paystack not configured"}
        </p>
      </div>

      <div className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">
          Academy terms{" "}
          <span className="font-normal text-mist">(v{data.terms.version})</span>
        </h2>
        <p className="mt-1 text-xs text-mist">
          Members must accept the current version before paying. Editing the text
          bumps the version.
        </p>
        <textarea
          className="input focus-ring mt-4 resize-none font-mono text-xs"
          rows={12}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
        />
      </div>

      {msg && (
        <p
          className={`rounded-xl border px-3 py-2.5 text-sm ${
            msg.ok
              ? "border-success/40 bg-success/10 text-success"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {msg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="btn-primary focus-ring rounded-xl px-6 py-2.5 text-sm font-semibold"
      >
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

function AnnouncementsAdmin() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: () =>
      api<{ announcements: Announcement[] }>("/api/admin/announcements"),
  });

  async function publish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ delivered: number }>("/api/admin/announcements", {
        method: "POST",
        body: { title: title.trim(), body: body.trim() },
      });
      setMsg({
        ok: true,
        text: `Announcement published to ${res.delivered} member${res.delivered === 1 ? "" : "s"}.`,
      });
      setTitle("");
      setBody("");
      await qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <form onSubmit={publish} className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Publish announcement</h2>
        <p className="mt-1 text-xs text-mist">
          Delivered in-app to every active member, and by push notification if
          they've enabled it.
        </p>
        <div className="mt-4 space-y-3">
          <input
            className="input focus-ring text-sm"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
            required
          />
          <textarea
            className="input focus-ring resize-none text-sm"
            rows={7}
            placeholder="Write the announcement…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            required
          />
          {msg && (
            <p
              className={`rounded-xl border px-3 py-2 text-sm ${
                msg.ok
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {msg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !title.trim() || !body.trim()}
            className="btn-primary focus-ring w-full rounded-xl py-2.5 text-sm font-semibold"
          >
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </form>

      <div className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Recent announcements</h2>
        <ul className="mt-3 space-y-3">
          {(data?.announcements || []).slice(0, 10).map((a) => (
            <li key={a.id} className="rounded-xl border border-line bg-surface-2/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{a.title}</p>
                <span className="shrink-0 text-[10px] text-mist">
                  {relTime(a.createdAt)}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-mist">
                {a.body}
              </p>
            </li>
          ))}
          {(data?.announcements || []).length === 0 && (
            <li className="py-4 text-sm text-mist">Nothing published yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Email (Resend broadcasts)                                           */
/* ------------------------------------------------------------------ */

type AdminSettingsInfo = {
  senderName: string;
  senderEmail: string;
  resendConfigured: boolean;
  resendWebhookConfigured: boolean;
  paystackConfigured: boolean;
  webhooks: { resend: string; paystack: string };
};

type BroadcastRow = {
  id: string;
  subject: string;
  createdAt: string;
  totalSent: number;
  sendFailed: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  pending: number;
};

/** Composer snippets: tap → branded HTML lands in the editor → paste text. */
const SNIPPETS: [string, string][] = [
  [
    "Hero title",
    `<h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:#0b1020;letter-spacing:-0.3px;">Your big title</h1>`,
  ],
  [
    "Heading",
    `<h2 style="margin:24px 0 0;font-size:18px;font-weight:700;color:#0b1020;">Section heading</h2>`,
  ],
  [
    "Paragraph",
    `<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#4b5266;">Write your text here…</p>`,
  ],
  [
    "Button",
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr><td align="center" bgcolor="#280dff" style="border-radius:11px;"><a href="https://omnivex.academy" style="display:inline-block;padding:13px 30px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:11px;">Call to action</a></td></tr></table>`,
  ],
  [
    "Bullets",
    `<p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:#4b5266;">• <strong>Point one</strong> — details</p>\n<p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:#4b5266;">• <strong>Point two</strong> — details</p>`,
  ],
  [
    "Card",
    `<div style="margin:18px 0 0;background:#f7f8fc;border:1px solid #e6e8f0;border-radius:12px;padding:18px 20px;font-size:14px;line-height:1.7;color:#4b5266;">Highlight box — great for dates, prices, or key info.</div>`,
  ],
  [
    "Callout",
    `<div style="margin:18px 0 0;border-left:4px solid #280dff;background:#efeaff;border-radius:0 10px 10px 0;padding:14px 18px;font-size:14px;line-height:1.7;color:#0b1020;"><strong>Good to know:</strong> write your note here.</div>`,
  ],
  [
    "Image",
    `<img src="https://placehold.co/456x240/0b1020/ffffff.png?text=Your+image" alt="" width="456" style="display:block;width:100%;max-width:456px;border-radius:12px;margin-top:18px;" />`,
  ],
  [
    "Divider",
    `<div style="height:22px;font-size:0;line-height:0;">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e6e8f0;font-size:0;line-height:0;">&nbsp;</td></tr></table><div style="height:6px;font-size:0;line-height:0;">&nbsp;</div>`,
  ],
  ["Spacer", `<div style="height:24px;font-size:0;line-height:0;">&nbsp;</div>`],
];

function EmailAdmin() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState<string>(
    SNIPPETS.map((s) => s[1]).slice(0, 3).join("\n"),
  );
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { data: settings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api<AdminSettingsInfo>("/api/admin/settings"),
  });
  const { data: sent } = useQuery({
    queryKey: ["admin-broadcasts"],
    queryFn: () => api<{ broadcasts: BroadcastRow[] }>("/api/admin/broadcasts"),
  });
  const { data: activity } = useQuery({
    queryKey: ["admin-email-activity"],
    queryFn: () =>
      api<{
        activity: {
          email: string;
          userName: string | null;
          broadcastId: string | null;
          status: string;
          updatedAt: string;
        }[];
      }>("/api/admin/email/activity"),
  });

  function insertSnippet(code: string) {
    const ta = taRef.current;
    if (!ta) {
      setHtml((h) => `${h}\n${code}`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = html.slice(0, start);
    const after = html.slice(end);
    const prefix = before && !before.endsWith("\n") ? "\n" : "";
    const next = `${before}${prefix}${code}${after}`;
    setHtml(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = before.length + prefix.length + code.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  const preview = broadcastEmail(
    subject.trim() || "Your subject appears here",
    html,
  ).html;

  async function send(testOnly: boolean) {
    if (!subject.trim() || !html.trim()) return;
    setBusy(testOnly ? "test" : "send");
    setMsg(null);
    try {
      const res = await api<{ sent: number; failed: number; mode: string }>(
        "/api/admin/broadcast",
        {
          method: "POST",
          body: {
            subject: subject.trim(),
            html,
            ...(testOnly && me?.user?.email
              ? { testEmail: me.user.email }
              : {}),
          },
        },
      );
      setMsg({
        ok: true,
        text: testOnly
          ? `Test sent to ${me?.user?.email} (${res.mode === "dev" ? "captured in dev_outbox — no RESEND_API_KEY" : "via Resend"}).`
          : `Broadcast sent to ${res.sent} member${res.sent === 1 ? "" : "s"}${res.failed ? `, ${res.failed} failed` : ""}.`,
      });
      await qc.invalidateQueries({ queryKey: ["admin-broadcasts"] });
      await qc.invalidateQueries({ queryKey: ["admin-email-activity"] });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Provider + webhook setup */}
      <div className="card rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Email provider · Resend</h2>
            <p className="mt-0.5 text-xs text-mist">
              Sender: {settings?.senderName || "Omnivex Academy"} &lt;{settings?.senderEmail || "hello@omnivex.manuskripta.xyz"}&gt;
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase">
            <span
              className={`rounded-full border px-2.5 py-1 ${
                settings?.resendConfigured
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-warning/40 bg-warning/10 text-warning"
              }`}
            >
              {settings?.resendConfigured ? "API key set" : "API key missing"}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 ${
                settings?.resendWebhookConfigured
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-warning/40 bg-warning/10 text-warning"
              }`}
            >
              {settings?.resendWebhookConfigured
                ? "Webhook secret set"
                : "Webhook secret missing"}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <WebhookCard
            label="Resend webhook URL"
            hint="Resend dashboard → Webhooks → add endpoint (sent, delivered, bounced, complained, failed)"
            url={settings?.webhooks.resend || ""}
          />
          <WebhookCard
            label="Paystack webhook URL"
            hint="Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL"
            url={settings?.webhooks.paystack || ""}
          />
        </div>
      </div>

      {/* Composer */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card rounded-2xl p-5">
          <h2 className="text-sm font-semibold">New broadcast</h2>
          <p className="mt-1 text-xs text-mist">
            Tap a block to drop branded HTML into the editor, then replace the
            placeholder text. Delivered through the premium Omnivex template to
            every active member.
          </p>

          <input
            className="input focus-ring mt-4 text-sm"
            placeholder="Email subject"
            value={subject}
            maxLength={200}
            onChange={(e) => setSubject(e.target.value)}
          />

          <div className="mt-3 flex flex-wrap gap-1.5">
            {SNIPPETS.map(([label, code]) => (
              <button
                key={label}
                type="button"
                onClick={() => insertSnippet(code)}
                className="focus-ring rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5 text-[11px] font-medium text-mist transition hover:border-accent hover:text-white"
              >
                + {label}
              </button>
            ))}
          </div>

          <textarea
            ref={taRef}
            className="input focus-ring mt-3 resize-y font-mono text-xs leading-relaxed"
            rows={14}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
          />

          {msg && (
            <p
              className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
                msg.ok
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {msg.text}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => void send(true)}
              disabled={busy !== null || !subject.trim() || !html.trim()}
              className="btn-ghost focus-ring rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {busy === "test" ? "Sending…" : "Send test to me"}
            </button>
            <button
              onClick={() => {
                if (
                  confirm("Send this broadcast to every active member now?")
                )
                  void send(false);
              }}
              disabled={busy !== null || !subject.trim() || !html.trim()}
              className="btn-primary focus-ring rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {busy === "send" ? "Sending…" : "Send broadcast"}
            </button>
          </div>
        </div>

        {/* Live preview */}
        <div className="card rounded-2xl p-5">
          <h2 className="text-sm font-semibold">Live preview</h2>
          <p className="mt-1 text-xs text-mist">Exactly what lands in the inbox.</p>
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={preview}
            className="mt-3 h-[560px] w-full rounded-xl border border-line bg-white"
          />
        </div>
      </div>

      {/* History */}
      <div className="card overflow-hidden rounded-2xl">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">Broadcast history</h2>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-[11px] uppercase tracking-wide text-mist">
              <tr>
                <th className="px-4 py-3 font-semibold">Subject</th>
                <th className="px-4 py-3 font-semibold">Sent</th>
                <th className="px-4 py-3 font-semibold">Delivered</th>
                <th className="px-4 py-3 font-semibold">Bounced</th>
                <th className="px-4 py-3 font-semibold">Pending</th>
                <th className="px-4 py-3 font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(sent?.broadcasts || []).map((b) => (
                <tr
                  key={b.id}
                  onClick={() => setDetailId(b.id)}
                  className="cursor-pointer hover:bg-surface-2/30"
                >
                  <td className="max-w-[240px] truncate px-4 py-3 font-medium">
                    {b.subject}
                  </td>
                  <td className="px-4 py-3 text-xs text-mist">{b.totalSent}</td>
                  <td className="px-4 py-3 text-xs text-success">{b.delivered}</td>
                  <td className="px-4 py-3 text-xs text-danger">
                    {b.bounced + b.failed + b.complained}
                  </td>
                  <td className="px-4 py-3 text-xs text-mist">{b.pending}</td>
                  <td className="px-4 py-3 text-xs text-mist">
                    {relTime(b.createdAt)}
                  </td>
                </tr>
              ))}
              {(sent?.broadcasts || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-mist">
                    No broadcasts sent yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent activity (incl. transactional OTP emails) */}
      <div className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Recent email activity</h2>
        <p className="mt-1 text-xs text-mist">
          Verification codes, password resets, and broadcasts — statuses update
          live from Resend webhooks.
        </p>
        <ul className="mt-3 divide-y divide-line">
          {(activity?.activity || []).map((a, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 py-2.5 text-xs"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-white">
                  {a.userName ? `${a.userName} · ` : ""}
                  {a.email}
                </span>
                {a.broadcastId && (
                  <span className="block truncate text-mist">Broadcast message</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    a.status === "delivered"
                      ? "border-success/40 bg-success/10 text-success"
                      : a.status === "bounced" ||
                          a.status === "failed" ||
                          a.status === "complained"
                        ? "border-danger/40 bg-danger/10 text-danger"
                        : "border-line bg-surface-2/60 text-mist"
                  }`}
                >
                  {a.status}
                </span>
                <span className="w-16 text-right text-mist">
                  {relTime(a.updatedAt)}
                </span>
              </span>
            </li>
          ))}
          {(activity?.activity || []).length === 0 && (
            <li className="py-4 text-sm text-mist">No email sent yet.</li>
          )}
        </ul>
      </div>

      {detailId && (
        <BroadcastDetail id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

function WebhookCard({
  label,
  hint,
  url,
}: {
  label: string;
  hint: string;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
      <p className="text-xs font-semibold text-white">{label}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-mist">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-mist">
          {url || "—"}
        </code>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
          className="focus-ring shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-mist transition hover:border-accent hover:text-white"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function BroadcastDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["admin-broadcast-detail", id],
    queryFn: () =>
      api<{
        broadcast: { subject: string; totalSent: number; createdAt: string };
        deliveries: { email: string; status: string; detail: string | null }[];
      }>(`/api/admin/broadcasts/${id}`),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="card animate-pop flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              {data?.broadcast.subject || "Broadcast"}
            </h3>
            <p className="text-xs text-mist">
              {data ? `${data.broadcast.totalSent} recipients` : "Loading…"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="focus-ring rounded-lg px-2 py-1 text-mist hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ul className="scroll-thin flex-1 divide-y divide-line overflow-y-auto px-4 py-2">
          {(data?.deliveries || []).map((d, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 py-2.5 text-xs"
            >
              <span className="min-w-0">
                <span className="block truncate text-white">{d.email}</span>
                {d.detail && (
                  <span className="block truncate text-mist">{d.detail}</span>
                )}
              </span>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  d.status === "delivered"
                    ? "border-success/40 bg-success/10 text-success"
                    : d.status === "bounced" ||
                        d.status === "failed" ||
                        d.status === "complained"
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : "border-line bg-surface-2/60 text-mist"
                }`}
              >
                {d.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
