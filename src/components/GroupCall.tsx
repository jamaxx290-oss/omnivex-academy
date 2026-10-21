import { useEffect, useRef } from "react";
import type { CallState } from "../lib/types";
import { initials } from "../lib/api";

type Props = {
  call: CallState;
  myId: string;
  isAdmin: boolean;
  selfMuted: boolean;
  adminMuted: boolean;
  handRaised: boolean;
  micBusy: boolean;
  error: string | null;
  remoteStreams: Record<string, MediaStream>;
  lastHand: { name: string; at: number } | null;
  audioBlocked: boolean;
  onToggleMic: () => void;
  onToggleHand: () => void;
  onAdminSetMute: (userId: string, muted: boolean) => void;
  onLeave: () => void;
  onEnd: () => void;
  onBindAudio: (userId: string, el: HTMLAudioElement | null) => void;
  onEnableAudio: () => void;
};

function RemoteAudio({
  stream,
  onMount,
}: {
  stream: MediaStream;
  onMount: (el: HTMLAudioElement | null) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => {
      /* blocked until a user gesture — handled by the enable-audio button */
    });
    onMount(el);
    return () => onMount(null);
  }, [stream, onMount]);
  return <audio ref={ref} autoPlay playsInline className="hidden" />;
}

export default function GroupCall({
  call,
  myId,
  isAdmin,
  selfMuted,
  adminMuted,
  handRaised,
  micBusy,
  error,
  remoteStreams,
  lastHand,
  audioBlocked,
  onToggleMic,
  onToggleHand,
  onAdminSetMute,
  onLeave,
  onEnd,
  onBindAudio,
  onEnableAudio,
}: Props) {
  const speakerCount = call.participants.filter((p) => p.publishing).length;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/90 backdrop-blur-md">
      {/* Remote voices */}
      {Object.entries(remoteStreams).map(([userId, stream]) => (
        <RemoteAudio
          key={userId}
          stream={stream}
          onMount={(el) => onBindAudio(userId, el)}
        />
      ))}

      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line/60 px-4 py-3 sm:px-6">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">Live class</h2>
          <p className="text-[11px] text-mist">
            {call.participants.length} in call · {speakerCount} speaking
          </p>
        </div>
      </header>

      {/* Raised-hand toast */}
      {lastHand && Date.now() - lastHand.at < 6000 && (
        <div className="animate-pop mx-auto mt-3 rounded-full border border-warning/50 bg-warning/10 px-4 py-1.5 text-xs font-medium text-warning">
          ✋ {lastHand.name} raised their hand
        </div>
      )}

      {audioBlocked && (
        <button
          onClick={onEnableAudio}
          className="focus-ring mx-auto mt-3 rounded-full border border-accent bg-accent-soft px-4 py-1.5 text-xs font-semibold"
        >
          🔊 Tap to enable call sound
        </button>
      )}

      {error && (
        <p className="mx-auto mt-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {/* Participants */}
      <ul className="scroll-thin mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-4">
        {call.participants.map((p) => {
          const isMe = p.userId === myId;
          const canAdminMute = isAdmin && !isMe;
          return (
            <li
              key={p.userId}
              className={`mb-2 flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${
                p.publishing
                  ? "border-accent/60 bg-accent-soft/60"
                  : "border-line bg-surface-2/50"
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold">
                {initials(p.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {p.name}
                  {isMe && <span className="text-mist"> (you)</span>}
                </span>
                <span className="text-[10px] text-mist">
                  {p.publishing
                    ? "Speaking"
                    : p.adminMuted
                      ? "🔇 Muted by host"
                      : "Muted"}
                </span>
              </span>
              {p.handRaised && (
                <span className="text-base" title="Hand raised">
                  ✋
                </span>
              )}
              {canAdminMute ? (
                <button
                  onClick={() => onAdminSetMute(p.userId, !p.adminMuted)}
                  className={`focus-ring shrink-0 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                    p.adminMuted
                      ? "border-warning/60 text-warning hover:border-warning"
                      : "border-line text-mist hover:border-danger hover:text-danger"
                  }`}
                  title={
                    p.adminMuted
                      ? "Allow this person to unmute"
                      : "Mute this person (they can't unmute until you allow it)"
                  }
                >
                  {p.adminMuted ? "Unmute" : "Mute"}
                </button>
              ) : (
                <span
                  className={`shrink-0 text-sm ${
                    p.publishing ? "text-accent" : "text-mist/60"
                  }`}
                >
                  {p.selfMuted || p.adminMuted ? "🔇" : "🎤"}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Controls */}
      <div className="border-t border-line/60 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-md items-center justify-center gap-3">
          <button
            onClick={onToggleMic}
            disabled={micBusy}
            className={`focus-ring flex h-14 w-14 items-center justify-center rounded-full border transition disabled:opacity-60 ${
              adminMuted
                ? "border-warning/60 bg-warning/10 text-warning"
                : selfMuted
                  ? "border-line bg-surface-2 text-mist"
                  : "border-accent bg-accent-soft text-white"
            }`}
            title={
              adminMuted
                ? "The host muted you — you can't unmute until they allow it"
                : selfMuted
                  ? "Unmute your microphone"
                  : "Mute your microphone"
            }
          >
            {selfMuted || adminMuted ? "🔇" : "🎤"}
          </button>

          <button
            onClick={onToggleHand}
            className={`focus-ring flex h-14 w-14 items-center justify-center rounded-full border text-lg transition ${
              handRaised
                ? "border-warning bg-warning/15 text-warning"
                : "border-line bg-surface-2 text-mist hover:border-warning/60 hover:text-warning"
            }`}
            title={handRaised ? "Lower your hand" : "Raise your hand"}
          >
            ✋
          </button>

          <button
            onClick={onLeave}
            className="focus-ring flex h-14 items-center justify-center rounded-full border border-danger/60 bg-danger/15 px-5 text-sm font-semibold text-danger transition hover:bg-danger/25"
          >
            Leave
          </button>

          {isAdmin && (
            <button
              onClick={onEnd}
              className="focus-ring flex h-14 items-center justify-center rounded-full border border-danger bg-danger px-5 text-sm font-semibold text-white transition hover:bg-danger/80"
              title="End the call for everyone"
            >
              End
            </button>
          )}
        </div>
        <p className="mx-auto mt-3 max-w-md text-center text-[11px] text-mist">
          {adminMuted
            ? "The host muted you. Ask them to allow you to speak, then unmute yourself."
            : "Everyone joins muted — tap the mic to speak. Raise your hand ✋ to ask a question."}
        </p>
      </div>
    </div>
  );
}
