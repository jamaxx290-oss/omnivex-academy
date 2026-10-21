import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, relTime, fullTime } from "../lib/api";
import type { AppNotification } from "../lib/types";
import { getSocket } from "../lib/socket";
import { useMarkAllRead } from "../hooks";

const icons: Record<string, string> = {
  reply: "↩️",
  dm: "✉️",
  announcement: "📣",
  system: "⚙️",
  payment: "💳",
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const markAll = useMarkAllRead();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      api<{ notifications: AppNotification[]; unread: number }>(
        "/api/notifications",
      ),
  });

  useEffect(() => {
    document.title = "Alerts · Omnivex Academy";
    const s = getSocket();
    const invalidate = () =>
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    s.on("notification:new", invalidate);
    s.on("announcement:new", invalidate);
    return () => {
      s.off("notification:new", invalidate);
      s.off("announcement:new", invalidate);
    };
  }, [qc]);

  const items = data?.notifications || [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Alerts</h1>
          <p className="mt-1 text-sm text-mist">
            Replies, messages, and academy announcements.
          </p>
        </div>
        {(data?.unread || 0) > 0 && (
          <button
            onClick={() => void markAll()}
            className="focus-ring shrink-0 rounded-xl border border-line px-3 py-2 text-xs font-medium text-mist transition hover:border-accent hover:text-white"
          >
            Mark all read
          </button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-16 animate-pulse rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="card rounded-2xl p-8 text-center">
          <span className="text-3xl">🔕</span>
          <h2 className="mt-3 text-base font-semibold">You're all caught up</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-mist">
            Replies to your messages, new DMs, and announcements will show up here.
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {items.map((n) => {
          const inner = (
            <span className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2/80 text-lg">
                {icons[n.type] || "🔔"}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm ${n.read ? "text-mist" : "font-semibold text-white"}`}
                >
                  {n.title}
                </span>
                {n.body && (
                  <span className="mt-0.5 block truncate text-xs text-mist">{n.body}</span>
                )}
                <span className="mt-1 block text-[10px] text-mist/70" title={fullTime(n.createdAt)}>
                  {relTime(n.createdAt)}
                </span>
              </span>
              {!n.read && (
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
              )}
            </span>
          );

          return n.link ? (
            <button
              key={n.id}
              onClick={() => {
                void markAll();
                nav(n.link!);
              }}
              className="card focus-ring w-full rounded-2xl p-3.5 text-left transition hover:border-accent"
            >
              {inner}
            </button>
          ) : (
            <div key={n.id} className="card rounded-2xl p-3.5">
              {inner}
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <p className="mt-6 text-center text-xs text-mist">
          Looking for academy news?{" "}
          <Link
            to="/app/announcements"
            className="focus-ring rounded text-accent transition hover:text-white"
          >
            Read announcements
          </Link>
        </p>
      )}
    </div>
  );
}
