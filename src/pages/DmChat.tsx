import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Conversation } from "../lib/types";
import ChatRoom from "../components/ChatRoom";
import { useMe } from "../hooks";
import { getSocket } from "../lib/socket";

export default function DmChatPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const { data } = useQuery({
    queryKey: ["dm-conversations"],
    queryFn: () => api<{ conversations: Conversation[] }>("/api/dm/conversations"),
    staleTime: 0,
  });

  const conv = data?.conversations.find((c) => c.id === id);
  const partnerName = conv?.partnerName || "Member";

  useEffect(() => {
    document.title = `${partnerName} · Omnivex`;
    const s = getSocket();
    const invalidate = () =>
      void qc.invalidateQueries({ queryKey: ["dm-conversations"] });
    s.on("dm:unread", invalidate);
    s.on("dm:conversation:new", invalidate);
    return () => {
      s.off("dm:unread", invalidate);
      s.off("dm:conversation:new", invalidate);
    };
  }, [partnerName, qc]);

  const header = (
    <header className="flex items-center gap-3 border-b border-line bg-black/40 px-3 py-3 backdrop-blur-md sm:px-5">
      <Link
        to="/app/dm"
        className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line text-mist transition hover:border-accent hover:text-white"
        aria-label="Back to messages"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </Link>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold">
        {partnerName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase())
          .join("") || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold leading-tight">
          {partnerName}
        </h1>
        <p className="text-xs text-mist">Direct message</p>
      </div>
    </header>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-9.5rem)] max-w-4xl flex-col md:h-[calc(100dvh-1.5rem)]">
      <ChatRoom
        scope="dm"
        roomId={id}
        myId={me?.user?.id || ""}
        header={header}
      />
    </div>
  );
}
