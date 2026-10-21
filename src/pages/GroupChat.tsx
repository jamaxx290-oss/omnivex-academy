import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import type { CallState, GroupDetail } from "../lib/types";
import ChatRoom from "../components/ChatRoom";
import GroupCall from "../components/GroupCall";
import { useMe } from "../hooks";
import { useGroupCall } from "../hooks/useGroupCall";
import { getSocket } from "../lib/socket";

export default function GroupChatPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [showMembers, setShowMembers] = useState(false);
  const [dmBusy, setDmBusy] = useState<string | null>(null);
  const [dmErr, setDmErr] = useState<string | null>(null);

  const { data: group, isLoading } = useQuery({
    queryKey: ["group", id],
    queryFn: () => api<GroupDetail>(`/api/groups/${id}`),
    enabled: Boolean(id),
  });

  const { data: callData, refetch: refetchCall } = useQuery({
    queryKey: ["group-call", id],
    queryFn: () => api<{ call: CallState | null }>(`/api/groups/${id}/call`),
    enabled: Boolean(id) && Boolean(me?.user),
  });
  const activeCall = callData?.call ?? null;
  const call = useGroupCall(id, me?.user?.id || "");
  const [callBusy, setCallBusy] = useState(false);
  const [callErr, setCallErr] = useState<string | null>(null);

  useEffect(() => {
    const s = getSocket();
    const refresh = () => void refetchCall();
    s.on("call:started", refresh);
    s.on("call:ended", refresh);
    return () => {
      s.off("call:started", refresh);
      s.off("call:ended", refresh);
    };
  }, [refetchCall]);

  async function startClass() {
    setCallBusy(true);
    setCallErr(null);
    try {
      await api(`/api/groups/${id}/call`, { method: "POST" });
      await call.join();
      await refetchCall();
    } catch (err) {
      setCallErr(errorMessage(err));
    } finally {
      setCallBusy(false);
    }
  }

  useEffect(() => {
    document.title = `${group?.name || "Group"} · Omnivex`;
    const s = getSocket();
    const invalidate = () => void qc.invalidateQueries({ queryKey: ["group", id] });
    s.on("group:updated", invalidate);
    s.on("group:archived", () => nav("/app/groups"));
    return () => {
      s.off("group:updated", invalidate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.name, id]);

  async function startDm(userId: string) {
    setDmBusy(userId);
    setDmErr(null);
    try {
      const res = await api<{ id: string }>("/api/dm/conversations", {
        method: "POST",
        body: { userId },
      });
      nav(`/app/dm/${res.id}`);
    } catch (err) {
      setDmErr(errorMessage(err));
    } finally {
      setDmBusy(null);
    }
  }

  if (isLoading || !group) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
  }

  // Locked view: the group exists, but the user is not a member yet.
  if (!group.isMember) {
    const pending = group.joinRequest === "pending";
    return (
      <div className="mx-auto flex h-[calc(100dvh-9.5rem)] max-w-md flex-col items-center justify-center px-6 text-center md:h-[calc(100dvh-1.5rem)]">
        <span className="text-4xl">🔒</span>
        <h1 className="mt-4 text-xl font-bold tracking-tight">{group.name}</h1>
        {group.description && (
          <p className="mt-2 text-sm text-mist">{group.description}</p>
        )}
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-mist">
          {pending
            ? "You've requested to join this room. An admin will review your request shortly."
            : group.joinPolicy === "request"
              ? "This is a members-only room. Request access and an admin will approve you."
              : "This is a members-only room. Join to see its contents and take part."}
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            to="/app/groups"
            className="btn-ghost focus-ring rounded-xl px-5 py-2.5 text-sm font-medium"
          >
            Back to groups
          </Link>
          {!pending && (
            <button
              onClick={async () => {
                await api(`/api/groups/${id}/join`, { method: "POST" });
                await qc.invalidateQueries({ queryKey: ["group", id] });
                await qc.invalidateQueries({ queryKey: ["groups"] });
              }}
              className="btn-primary focus-ring rounded-xl px-5 py-2.5 text-sm font-semibold"
            >
              {group.joinPolicy === "request" ? "Request to join" : "Join group"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const header = (
    <header className="border-b border-line bg-black/40 backdrop-blur-md">
      <div className="flex items-center gap-3 px-3 py-3 sm:px-5">
        <Link
          to="/app/groups"
          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line text-mist transition hover:border-accent hover:text-white"
          aria-label="Back to groups"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight">{group.name}</h1>
          <button
            onClick={() => setShowMembers(true)}
            className="focus-ring rounded text-xs text-mist transition hover:text-white"
          >
            {group.members.length} member{group.members.length === 1 ? "" : "s"}
            {group.sendPolicy === "admins_only" ? " · announcements only" : ""}
          </button>
        </div>
        {me?.user?.isAdmin && !activeCall && !call.joined && (
          <button
            onClick={() => void startClass()}
            disabled={callBusy}
            className="focus-ring shrink-0 rounded-xl border border-danger/60 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/20 disabled:opacity-50"
          >
            {callBusy ? "Starting…" : "Start class"}
          </button>
        )}
      </div>
      {activeCall && !call.joined && (
        <div className="flex items-center gap-3 border-t border-danger/30 bg-danger/10 px-3 py-2 sm:px-5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
          </span>
          <p className="min-w-0 flex-1 truncate text-xs">
            🔴 Live class in progress
            {activeCall.startedByName ? ` — started by ${activeCall.startedByName}` : ""}
            {callErr && <span className="text-danger"> · {callErr}</span>}
          </p>
          <button
            onClick={() => void call.join()}
            disabled={call.joining}
            className="focus-ring shrink-0 rounded-lg bg-danger px-3 py-1 text-xs font-semibold text-white transition hover:bg-danger/80 disabled:opacity-50"
          >
            {call.joining ? "Joining…" : "Join"}
          </button>
        </div>
      )}
    </header>
  );

  return (
    <>
      <div className="mx-auto flex h-[calc(100dvh-9.5rem)] max-w-4xl flex-col md:h-[calc(100dvh-1.5rem)]">
        <ChatRoom
          scope="group"
          roomId={id}
          myId={me?.user?.id || ""}
          header={header}
          canSend={group.canSend}
          isAdmin={Boolean(me?.user?.isAdmin)}
          mutedNotice={
            group.canSend ? undefined : "Only admins can post in this group"
          }
        />
      </div>

      {call.joined && me?.user && call.roster && (
        <GroupCall
          call={call.roster}
          myId={me.user.id}
          isAdmin={Boolean(me.user.isAdmin)}
          selfMuted={call.selfMuted}
          adminMuted={call.adminMuted}
          handRaised={call.handRaised}
          micBusy={call.micBusy}
          error={call.error}
          remoteStreams={call.remoteStreams}
          lastHand={call.lastHand}
          audioBlocked={call.audioBlocked}
          onToggleMic={() => void call.toggleMic()}
          onToggleHand={call.toggleHand}
          onAdminSetMute={call.adminSetMute}
          onLeave={() => {
            call.leave();
            void refetchCall();
          }}
          onEnd={() => {
            void api(`/api/groups/${id}/call/end`, { method: "POST" })
              .then(() => {
                call.leave();
                void refetchCall();
              })
              .catch((err) => setCallErr(errorMessage(err)));
          }}
          onBindAudio={call.bindAudioEl}
          onEnableAudio={call.enableAudio}
        />
      )}

      {showMembers && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setShowMembers(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="card animate-pop flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h3 className="text-base font-semibold">Members</h3>
                <p className="text-xs text-mist">{group.name}</p>
              </div>
              <button
                onClick={() => setShowMembers(false)}
                className="focus-ring rounded-lg px-2 py-1 text-mist hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {dmErr && (
              <p className="mx-5 mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {dmErr}
              </p>
            )}
            <ul className="scroll-thin flex-1 overflow-y-auto px-3 py-3">
              {group.members.map((m) => {
                const isMe = m.id === me?.user?.id;
                return (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2/50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold">
                      {m.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join("") || "?"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.name}
                        {isMe && <span className="text-mist"> (you)</span>}
                      </span>
                      {m.role === "admin" && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-warning">
                          Admin
                        </span>
                      )}
                    </span>
                    {!isMe && (
                      <button
                        onClick={() => void startDm(m.id)}
                        disabled={dmBusy === m.id}
                        className="focus-ring shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs text-mist transition hover:border-accent hover:text-white disabled:opacity-50"
                      >
                        {dmBusy === m.id ? "…" : "Message"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
