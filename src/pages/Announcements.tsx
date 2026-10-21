import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fullTime, relTime } from "../lib/api";
import type { Announcement } from "../lib/types";

export default function AnnouncementsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => api<{ announcements: Announcement[] }>("/api/announcements"),
  });

  useEffect(() => {
    document.title = "Announcements · Omnivex Academy";
  }, []);

  const items = data?.announcements || [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Announcements
        </h1>
        <p className="mt-1 text-sm text-mist">
          Official updates from the Omnivex team.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-24 animate-pulse rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="card rounded-2xl p-8 text-center">
          <span className="text-3xl">📣</span>
          <h2 className="mt-3 text-base font-semibold">Nothing new yet</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-mist">
            Official academy news — schedule changes, live sessions, and launch
            reviews — will appear here.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {items.map((a) => (
          <article
            key={a.id}
            className="card relative overflow-hidden rounded-2xl p-5"
          >
            <span className="absolute inset-y-0 left-0 w-1 bg-accent" />
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold leading-snug">{a.title}</h2>
              <time
                className="shrink-0 text-[10px] text-mist"
                dateTime={a.createdAt}
                title={fullTime(a.createdAt)}
              >
                {relTime(a.createdAt)}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-mist">
              {a.body}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
