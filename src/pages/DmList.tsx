import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, relTime } from "../lib/api";
import type { Conversation } from "../lib/types";
import { getSocket } from "../lib/socket";
import { useMe } from "../hooks";

export default function DmListPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["dm-conversations"],
    queryFn: () => api<{ conversations: Conversation[] }>("/api/dm/conversations"),
  });

  const { data: directory, isFetching: dirLoading } = useQuery({
    queryKey: ["members-dir", q],
    queryFn: () =>
      api<{ members: { id: string; name: string }[] }>(
        `/api/members${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
    enabled: composing,
  });

  useEffect(() => {
    document.title = "Messages · Omnivex Academy";
    const s = getSocket();
    const invalidate = () =>
      void qc.invalidateQueries({ queryKey: ["dm-conversations"] });
    s.on("dm:message", invalidate);
    s.on("dm:unread", invalidate);
    s.on("dm:conversation:new", invalidate);
    return () => {
      s.off("dm:message", invalidate);
      s.off("dm:unread", invalidate);
      s.off("dm:conversation:new", invalidate);
    };
  }, [qc]);

  async function start(userId: string) {
    setBusy(userId);
    setError(null);
    try {
      const res = await api<{ id: string }>("/api/dm/conversations", {
        method: "POST",
        body: { userId },
      });
      await qc.invalidateQueries({ queryKey: ["dm-conversations"] });
      location.href = `/app/dm/${res.id}`;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const conversations = data?.conversations || [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Messages</h1>
          <p className="mt-1 text-sm text-mist">Private chats with your peers.</p>
        </div>
        <button
          onClick={() => {
            setComposing(true);
            setQ("");
          }}
          className="btn-primary focus-ring shrink-0 rounded-xl px-4 py-2.5 text-xs font-semibold"
        >
          + New chat
        </button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-16 animate-pulse rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && conversations.length === 0 && (
        <div className="card rounded-2xl p-8 text-center">
          <span className="text-3xl">✉️</span>
          <h2 className="mt-3 text-base font-semibold">No conversations yet</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-mist">
            Start a private chat with a mentor or accountability partner — voice
            notes, photos, and video all work here.
          </p>
          <button
            onClick={() => setComposing(true)}
            className="btn-ghost focus-ring mt-5 rounded-xl px-5 py-2.5 text-sm font-medium"
          >
            Start a chat
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        {conversations.map((c) => (
          <Link
            key={c.id}
            to={`/app/dm/${c.id}`}
            className="card focus-ring group flex items-center gap-3 rounded-2xl p-3.5 transition hover:border-accent"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold">
              {c.partnerName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join("") || "?"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {c.partnerName}
              </span>
              <span className="mt-0.5 block truncate text-xs text-mist">
                {c.lastMessage ? (
                  <>
                    {c.lastMessage.mine && <span className="text-mist/70">You: </span>}
                    {c.lastMessage.type !== "text" && !c.lastMessage.body
                      ? `Sent a ${c.lastMessage.type}`
                      : c.lastMessage.body}
                  </>
                ) : (
                  "Say hello 👋"
                )}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[10px] text-mist">
                {c.lastMessage ? relTime(c.lastMessage.at) : ""}
              </span>
              {c.unread > 0 && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold">
                  {c.unread}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>

      {/* New chat sheet */}
      {composing && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setComposing(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="card animate-pop flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h3 className="text-base font-semibold">New message</h3>
              <button
                onClick={() => setComposing(false)}
                className="focus-ring rounded-lg px-2 py-1 text-mist hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="border-b border-line px-4 py-3">
              <input
                autoFocus
                className="input focus-ring text-sm"
                placeholder="Search members…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            {error && (
              <p className="mx-4 mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}

            <ul className="scroll-thin flex-1 overflow-y-auto px-3 py-2">
              {dirLoading && (
                <li className="px-3 py-6 text-center text-sm text-mist">Searching…</li>
              )}
              {!dirLoading && (directory?.members || []).length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-mist">
                  No members match “{q}”.
                </li>
              )}
              {(directory?.members || []).map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => void start(m.id)}
                    disabled={busy === m.id}
                    className="focus-ring flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-surface-2/50 disabled:opacity-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold">
                      {m.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join("") || "?"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m.id === me?.user?.id ? `${m.name} (you)` : m.name}
                    </span>
                    {busy === m.id && (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
