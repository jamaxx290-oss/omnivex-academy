import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, relTime } from "../lib/api";
import type { GroupSummary } from "../lib/types";
import { getSocket } from "../lib/socket";
import { initials } from "../lib/api";

export default function GroupsPage() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: () => api<{ groups: GroupSummary[] }>("/api/groups"),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    document.title = "Groups · Omnivex Academy";
    const s = getSocket();
    const invalidate = () => void qc.invalidateQueries({ queryKey: ["groups"] });
    s.on("group:activity", invalidate);
    s.on("group:added", invalidate);
    s.on("group:updated", invalidate);
    s.on("group:archived", invalidate);
    s.on("announcement:new", invalidate);
    return () => {
      s.off("group:activity", invalidate);
      s.off("group:added", invalidate);
      s.off("group:updated", invalidate);
      s.off("group:archived", invalidate);
      s.off("announcement:new", invalidate);
    };
  }, [qc]);

  const groups = data?.groups || [];

  async function join(g: GroupSummary) {
    setBusyId(g.id);
    try {
      await api(`/api/groups/${g.id}/join`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["groups"] });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Mentorship groups
          </h1>
          <p className="mt-1 text-sm text-mist">
            Your rooms — reviews, launches, and accountability.
          </p>
        </div>
        <Link
          to="/app/announcements"
          className="focus-ring shrink-0 rounded-xl border border-line px-3 py-2 text-xs font-medium text-mist transition hover:border-accent hover:text-white"
        >
          Announcements
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-20 animate-pulse rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <div className="card rounded-2xl p-8 text-center">
          <span className="text-3xl">🚪</span>
          <h2 className="mt-3 text-base font-semibold">No groups yet</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-mist">
            When mentors publish mentorship rooms, they will appear here so you
            can join or request access. Your direct messages are already live.
          </p>
          <Link
            to="/app/dm"
            className="btn-ghost focus-ring mt-5 inline-block rounded-xl px-5 py-2.5 text-sm font-medium"
          >
            Open messages
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => {
          const locked = !g.isMember;
          const pending = g.joinRequest === "pending";
          const inner = (
            <>
              {g.pictureUrl ? (
                <img
                  src={g.pictureUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sm font-bold">
                  {initials(g.name)}
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{g.name}</span>
                  {g.role === "admin" && (
                    <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">
                      Admin
                    </span>
                  )}
                  {g.sendPolicy === "admins_only" && (
                    <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-mist">
                      Read-only
                    </span>
                  )}
                  {locked && (
                    <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-mist">
                      {g.joinPolicy === "request" ? "Request" : "Invite"}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-mist">
                  {locked ? (
                    g.description || "Members-only room"
                  ) : g.lastMessage ? (
                    <>
                      <span className="font-medium text-white/80">
                        {g.lastMessage.senderName.split(" ")[0]}:
                      </span>{" "}
                      {g.lastMessage.type !== "text" && !g.lastMessage.body
                        ? `Sent a ${g.lastMessage.type}`
                        : g.lastMessage.body}
                    </>
                  ) : (
                    g.description || "No messages yet"
                  )}
                </span>
              </span>

              <span className="flex shrink-0 flex-col items-end gap-1">
                {!locked && (
                  <span className="text-[10px] text-mist">
                    {g.lastMessage ? relTime(g.lastMessage.at) : ""}
                  </span>
                )}
                {locked ? (
                  <span className="text-[10px] text-mist/60">
                    {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                  </span>
                ) : g.unread > 0 ? (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold">
                    {g.unread > 99 ? "99+" : g.unread}
                  </span>
                ) : (
                  <span className="text-[10px] text-mist/60">
                    {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                  </span>
                )}
              </span>
            </>
          );

          if (locked) {
            return (
              <div
                key={g.id}
                className="card flex items-center gap-3.5 rounded-2xl p-4"
              >
                {inner}
                {pending ? (
                  <span className="focus-ring shrink-0 cursor-default rounded-xl border border-line px-3 py-2 text-xs font-medium text-mist">
                    Requested ✓
                  </span>
                ) : (
                  <button
                    onClick={() => void join(g)}
                    disabled={busyId === g.id}
                    className="btn-primary focus-ring shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {busyId === g.id
                      ? "…"
                      : g.joinPolicy === "request"
                        ? "Request"
                        : "Join"}
                  </button>
                )}
              </div>
            );
          }

          return (
            <Link
              key={g.id}
              to={`/app/groups/${g.id}`}
              className="card focus-ring group flex items-center gap-3.5 rounded-2xl p-4 transition hover:border-accent"
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
