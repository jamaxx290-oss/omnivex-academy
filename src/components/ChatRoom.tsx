import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { api, errorMessage, clockTime, fullTime } from "../lib/api";
import type { ChatMessage } from "../lib/types";
import { getSocket } from "../lib/socket";

type Props = {
  scope: "group" | "dm";
  roomId: string;
  header: ReactNode;
  myId: string;
  canSend?: boolean;
  mutedNotice?: string;
};

const QUICK_EMOJI = [
  "😀", "😂", "🔥", "🎉", "👍", "🙏", "💯", "📚",
  "✅", "🚀", "❤️", "😮", "🤔", "👏", "💡", "⭐",
];

function typeFromMime(mime: string): "image" | "video" | "audio" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "audio";
}

function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (sameDay(iso, today.toISOString())) return "Today";
  if (sameDay(iso, yest.toISOString())) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function ChatRoom({
  scope,
  roomId,
  header,
  myId,
  canSend = true,
  mutedNotice,
}: Props) {
  const base = scope === "group" ? `/api/groups/${roomId}` : `/api/dm/${roomId}`;
  const event = scope === "group" ? "group:message" : "dm:message";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef(0);
  const recTimerRef = useRef<number | null>(null);
  const pinnedRef = useRef(true);
  const readTimerRef = useRef<number | null>(null);
  const [params] = useSearchParams();

  /* ---------------- data ---------------- */

  const markRead = useCallback(() => {
    if (readTimerRef.current) return;
    readTimerRef.current = window.setTimeout(() => {
      readTimerRef.current = null;
      void api(`${base}/read`, { method: "POST" }).catch(() => {});
    }, 600);
  }, [base]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await api<{ messages: ChatMessage[]; hasMore: boolean }>(
        `${base}/messages?limit=50`,
      );
      setMessages(res.messages);
      setHasMore(res.hasMore);
      markRead();
    } catch (err) {
      setLoadErr(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [base, markRead]);

  const loadOlder = useCallback(async () => {
    const first = messages[0];
    if (!first) return;
    try {
      const res = await api<{ messages: ChatMessage[]; hasMore: boolean }>(
        `${base}/messages?limit=50&before=${encodeURIComponent(first.id)}`,
      );
      const el = scrollRef.current;
      const prevHeight = el?.scrollHeight || 0;
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...res.messages.filter((m) => !known.has(m.id)), ...prev];
      });
      setHasMore(res.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (err) {
      setNotice(errorMessage(err));
    }
  }, [base, messages]);

  useEffect(() => {
    pinnedRef.current = true;
    setShowJump(false);
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, roomId]);

  /* realtime */
  useEffect(() => {
    const s = getSocket();
    const onMessage = (msg: ChatMessage) => {
      const match =
        scope === "group" ? msg.groupId === roomId : msg.conversationId === roomId;
      if (!match) return;
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
      if (pinnedRef.current) {
        requestAnimationFrame(() =>
          bottomRef.current?.scrollIntoView({ block: "end" }),
        );
        markRead();
      } else {
        setShowJump(true);
      }
    };
    const onDeleted = (payload: { id: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.id
            ? { ...m, deleted: true, body: null, mediaUrl: null }
            : m,
        ),
      );
    };
    s.on(event, onMessage);
    s.on("message:deleted", onDeleted);
    return () => {
      s.off(event, onMessage);
      s.off("message:deleted", onDeleted);
    };
  }, [scope, roomId, event, markRead]);

  /* scroll pinning */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinnedRef.current = atBottom;
    if (atBottom) {
      setShowJump(false);
      markRead();
    }
  }, [markRead]);

  useLayoutEffect(() => {
    if (loading) return;
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, loading]);

  /* deep link ?jump=<messageId> (notification / reply links) */
  useEffect(() => {
    const jump = params.get("jump");
    if (!jump || !messages.length) return;
    void (async () => {
      const found = await jumpTo(jump);
      if (found) {
        setFlashId(jump);
        window.setTimeout(() => setFlashId(null), 1800);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, messages.length > 0]);

  async function jumpTo(id: string): Promise<boolean> {
    const inView = () => {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
      }
      return false;
    };
    if (inView()) return true;
    // pull older pages until we find it
    for (let i = 0; i < 8 && hasMore; i++) {
      const first = messages[0];
      if (!first) break;
      const res = await api<{ messages: ChatMessage[]; hasMore: boolean }>(
        `${base}/messages?limit=100&before=${encodeURIComponent(first.id)}`,
      );
      const known = new Set(messages.map((m) => m.id));
      const fresh = res.messages.filter((m) => !known.has(m.id));
      setMessages((prev) => [...fresh, ...prev]);
      setHasMore(res.hasMore);
      await new Promise((r) => setTimeout(r, 60));
      if (res.messages.some((m) => m.id === id)) {
        requestAnimationFrame(() => inView());
        return true;
      }
    }
    // last resort: fetch the single message
    try {
      const res = await api<{ message: ChatMessage }>(`/api/messages/${id}`);
      if (
        res.message &&
        (scope === "group"
          ? res.message.groupId === roomId
          : res.message.conversationId === roomId)
      ) {
        setMessages((prev) =>
          prev.some((m) => m.id === id) ? prev : [...prev, res.message],
        );
        requestAnimationFrame(() => inView());
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /* ---------------- sending ---------------- */

  async function send(payload: {
    body?: string;
    type?: "text" | "image" | "video" | "audio";
    mediaPath?: string;
    durationMs?: number;
  }) {
    setSending(true);
    try {
      const res = await api<{ message: ChatMessage }>(`${base}/messages`, {
        method: "POST",
        body: {
          type: payload.type || "text",
          body: payload.body,
          mediaPath: payload.mediaPath,
          durationMs: payload.durationMs,
          replyToId: replyTo?.id,
          clientId: crypto.randomUUID?.() || String(Date.now()),
        },
      });
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message],
      );
      setReplyTo(null);
      pinnedRef.current = true;
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setEmojiOpen(false);
    await send({ body: text, type: "text" });
    taRef.current?.focus();
  }

  async function uploadFile(file: File) {
    if (uploading || !file) return;
    setNotice(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (scope === "group") fd.append("group_id", roomId);
      else fd.append("conversation_id", roomId);
      const res = await api<{ path: string; mime: string }>("/api/uploads", {
        method: "POST",
        body: fd,
      });
      await send({
        type: typeFromMime(res.mime || file.type),
        mediaPath: res.path,
        body: draft.trim() || undefined,
      });
      setDraft("");
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  /* ---------------- voice recording ---------------- */

  function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("Voice recording isn't supported on this device.");
      return;
    }
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";
        const rec = new MediaRecorder(stream, { mimeType: mime });
        chunksRef.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const durationMs = Date.now() - recStartRef.current;
          const blob = new Blob(chunksRef.current, { type: mime });
          if (blob.size < 800) return; // discarded empty take
          const ext = mime.includes("mp4") ? "m4a" : "webm";
          const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime });
          void uploadFile(file);
        };
        rec.start();
        recorderRef.current = rec;
        recStartRef.current = Date.now();
        setRecording(true);
        setRecSeconds(0);
        recTimerRef.current = window.setInterval(() => {
          setRecSeconds(Math.floor((Date.now() - recStartRef.current) / 1000));
        }, 500);
      } catch {
        setNotice("Microphone access was denied.");
      }
    })();
  }

  function stopRecording(discard = false) {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    const rec = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!rec) return;
    if (discard) {
      chunksRef.current = [];
      recStartRef.current = Date.now() - 1; // <800ms ⇒ discarded
    }
    rec.stop();
  }

  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      recorderRef.current?.state === "recording" && recorderRef.current.stop();
    };
  }, []);

  /* textarea auto-grow */
  function onDraftChange(v: string) {
    if (v.length > 4000) v = v.slice(0, 4000);
    setDraft(v);
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    }
  }

  /* ---------------- render ---------------- */

  const showComposer = canSend && !mutedNotice;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scroll-thin absolute inset-0 overflow-y-auto px-3 py-4 sm:px-5"
        >
          {loading && (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
            </div>
          )}

          {!loading && loadErr && (
            <div className="mx-auto mt-10 max-w-sm rounded-xl border border-danger/40 bg-danger/10 p-4 text-center text-sm text-danger">
              {loadErr}
              <button
                onClick={() => void loadInitial()}
                className="focus-ring mt-3 block w-full rounded-lg border border-danger/40 py-2 text-xs font-semibold"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !loadErr && hasMore && (
            <div className="mb-3 text-center">
              <button
                onClick={() => void loadOlder()}
                className="focus-ring rounded-full border border-line bg-surface-2/70 px-4 py-1.5 text-xs text-mist transition hover:border-accent hover:text-white"
              >
                Load earlier messages
              </button>
            </div>
          )}

          {!loading && !loadErr && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <span className="text-3xl">💬</span>
              <p className="mt-3 text-sm font-medium">No messages yet</p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-mist">
                Say hello, share your launch plan, or send a voice note — this room is
                yours.
              </p>
            </div>
          )}

          {!loading &&
            messages.map((m, i) => {
              const prev = messages[i - 1];
              const showDay = !prev || !sameDay(prev.createdAt, m.createdAt);
              const grouped =
                !showDay &&
                prev &&
                prev.senderId === m.senderId &&
                new Date(m.createdAt).getTime() -
                  new Date(prev.createdAt).getTime() <
                  180_000;
              return (
                <div key={m.id}>
                  {showDay && (
                    <div className="my-4 flex items-center gap-3">
                      <span className="h-px flex-1 bg-line" />
                      <span className="text-[11px] font-medium text-mist">
                        {dayLabel(m.createdAt)}
                      </span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <MessageBubble
                    m={m}
                    myId={myId}
                    grouped={Boolean(grouped)}
                    flash={flashId === m.id}
                    showSender={scope === "group" && !grouped}
                    onReply={() => {
                      setReplyTo(m);
                      taRef.current?.focus();
                    }}
                    onJump={(id) => {
                      void jumpTo(id).then((ok) => {
                        if (ok) {
                          setFlashId(id);
                          window.setTimeout(() => setFlashId(null), 1800);
                        }
                      });
                    }}
                  />
                </div>
              );
            })}

          <div ref={bottomRef} className="h-1" />
        </div>

        {showJump && (
          <button
            onClick={() => {
              pinnedRef.current = true;
              bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
              setShowJump(false);
            }}
            className="focus-ring absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-accent bg-surface px-4 py-2 text-xs font-semibold shadow-lg"
          >
            ↓ New messages
          </button>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-line bg-black/50 px-3 py-3 backdrop-blur-md sm:px-5">
        {mutedNotice && !canSend ? (
          <p className="rounded-xl border border-line bg-surface-2/50 px-3 py-3 text-center text-xs text-mist">
            {mutedNotice}
          </p>
        ) : (
          <>
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
                <span className="h-8 w-0.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-white">
                    Replying to {replyTo.senderName}
                  </span>
                  <span className="block truncate text-[11px] text-mist">
                    {replyTo.deleted
                      ? "Message deleted"
                      : replyTo.body || `Sent a ${replyTo.type}`}
                  </span>
                </span>
                <button
                  onClick={() => setReplyTo(null)}
                  className="focus-ring rounded px-1.5 text-mist hover:text-white"
                  aria-label="Cancel reply"
                >
                  ✕
                </button>
              </div>
            )}

            {notice && (
              <p className="mb-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {notice}
              </p>
            )}

            {recording ? (
              <div className="flex items-center gap-3 rounded-2xl border border-danger/50 bg-danger/10 px-4 py-2.5">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
                <span className="flex-1 text-sm font-medium">
                  Recording… {Math.floor(recSeconds / 60)}:
                  {String(recSeconds % 60).padStart(2, "0")}
                </span>
                <button
                  onClick={() => stopRecording(true)}
                  className="focus-ring rounded-lg px-3 py-1.5 text-xs text-mist hover:text-white"
                >
                  Discard
                </button>
                <button
                  onClick={() => stopRecording(false)}
                  disabled={sending || uploading}
                  className="btn-primary focus-ring rounded-lg px-4 py-1.5 text-xs font-semibold"
                >
                  Send
                </button>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadFile(f);
                  }}
                />
                <input
                  ref={camRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadFile(f);
                  }}
                />

                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || sending}
                  className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-mist transition hover:border-accent hover:text-white disabled:opacity-50"
                  aria-label="Attach file"
                  title="Attach image, video, or audio"
                >
                  {uploading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7.821l-6.364 6.364a2.5 2.5 0 1 0 3.536 3.536l6.364-6.364a4.5 4.5 0 1 0-6.364-6.364L5.636 11.45a6.5 6.5 0 0 0 9.192 9.192" />
                    </svg>
                  )}
                </button>

                <button
                  onClick={() => camRef.current?.click()}
                  disabled={uploading || sending}
                  className="focus-ring hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-mist transition hover:border-accent hover:text-white disabled:opacity-50 sm:flex"
                  aria-label="Take a photo"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 10.076 3h3.848a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 18.07 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                </button>

                <div className="relative min-w-0 flex-1">
                  <textarea
                    ref={taRef}
                    rows={1}
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendText();
                      }
                    }}
                    placeholder="Write a message…"
                    className="input focus-ring max-h-[140px] resize-none py-2.5 pr-10 text-sm"
                  />
                  <button
                    onClick={() => setEmojiOpen((o) => !o)}
                    className="focus-ring absolute bottom-2 right-2 rounded-lg px-1 text-base transition hover:scale-110"
                    aria-label="Emoji"
                  >
                    😊
                  </button>

                  {emojiOpen && (
                    <div className="animate-pop absolute bottom-12 right-0 z-20 grid w-64 grid-cols-8 gap-1 rounded-xl border border-line bg-surface p-2 shadow-2xl">
                      {QUICK_EMOJI.map((e) => (
                        <button
                          key={e}
                          onClick={() => {
                            onDraftChange(draft + e);
                            taRef.current?.focus();
                          }}
                          className="focus-ring rounded-lg p-1.5 text-lg transition hover:bg-surface-2"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {draft.trim() || replyTo ? (
                  <button
                    onClick={() => void sendText()}
                    disabled={sending || !draft.trim()}
                    className="btn-primary focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-50"
                    aria-label="Send"
                  >
                    {sending ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    ) : (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
                      </svg>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={startRecording}
                    disabled={uploading || sending}
                    className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-mist transition hover:border-accent hover:text-white disabled:opacity-50"
                    aria-label="Record voice note"
                    title="Record a voice note"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bubble                                                              */
/* ------------------------------------------------------------------ */

function MessageBubble({
  m,
  myId,
  grouped,
  flash,
  showSender,
  onReply,
  onJump,
}: {
  m: ChatMessage;
  myId: string;
  grouped: boolean;
  flash: boolean;
  showSender: boolean;
  onReply: () => void;
  onJump: (id: string) => void;
}) {
  const mine = m.senderId === myId;
  const initials = m.senderName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div
      id={`msg-${m.id}`}
      className={`group flex gap-2.5 ${grouped ? "mt-1" : "mt-3"} ${
        flash ? "jump-flash" : ""
      }`}
    >
      <div className="w-8 shrink-0">
        {!grouped && (
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ${
              mine ? "bg-accent" : "bg-surface-3 text-white"
            }`}
          >
            {initials || "?"}
          </span>
        )}
      </div>

      <div className="min-w-0 max-w-[min(78%,42rem)]">
        {showSender && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="truncate text-xs font-semibold text-white">
              {m.senderName}
            </span>
            <time
              className="text-[10px] text-mist"
              dateTime={m.createdAt}
              title={fullTime(m.createdAt)}
            >
              {clockTime(m.createdAt)}
            </time>
          </div>
        )}

        <div
          className={`relative w-fit rounded-2xl border px-3 py-2 ${
            mine
              ? "rounded-br-md border-accent/50 bg-accent-soft"
              : "rounded-bl-md border-line bg-surface-2/70"
          }`}
        >
          {m.replyTo && (
            <button
              onClick={() => onJump(m.replyTo!.id)}
              className="focus-ring mb-1.5 flex w-full max-w-xs items-start gap-2 rounded-lg border-l-2 border-accent bg-black/40 px-2 py-1.5 text-left transition hover:bg-black/60"
            >
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold text-accent">
                  {m.replyTo.deleted ? "Deleted message" : m.replyTo.senderName}
                </span>
                <span className="block truncate text-[11px] text-mist">
                  {m.replyTo.deleted
                    ? "Message deleted"
                    : m.replyTo.body || `Sent a ${m.replyTo.type}`}
                </span>
              </span>
            </button>
          )}

          {m.deleted ? (
            <p className="text-sm italic text-mist">Message deleted</p>
          ) : m.type === "text" ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {linkify(m.body || "")}
            </p>
          ) : m.type === "image" && m.mediaUrl ? (
            <a href={m.mediaUrl} target="_blank" rel="noreferrer">
              <img
                src={m.mediaUrl}
                alt=""
                loading="lazy"
                className="max-h-80 w-full max-w-xs cursor-pointer rounded-xl object-cover"
              />
            </a>
          ) : m.type === "video" && m.mediaUrl ? (
            <video
              src={m.mediaUrl}
              controls
              playsInline
              className="max-h-80 w-full max-w-xs rounded-xl bg-black"
            />
          ) : m.type === "audio" && m.mediaUrl ? (
            <div className="w-[min(18rem,70vw)]">
              <audio src={m.mediaUrl} controls className="w-full" />
              {m.durationMs ? (
                <p className="mt-1 text-[10px] text-mist">
                  🎤 {Math.max(1, Math.round(m.durationMs / 1000))}s voice note
                </p>
              ) : null}
            </div>
          ) : m.mediaUrl ? (
            <a
              href={m.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-sm underline decoration-accent underline-offset-2"
            >
              Open attachment
            </a>
          ) : (
            <p className="text-sm italic text-mist">Media unavailable</p>
          )}

          {grouped && (
            <time
              className="mt-1 block text-right text-[10px] text-mist opacity-0 transition group-hover:opacity-100"
              dateTime={m.createdAt}
            >
              {clockTime(m.createdAt)}
            </time>
          )}
        </div>

        <div className="mt-0.5 flex gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={onReply}
            className="focus-ring rounded px-1 text-[10px] font-medium text-mist hover:text-white"
          >
            Reply
          </button>
          {!grouped && (
            <time
              className="px-1 text-[10px] text-mist md:hidden"
              dateTime={m.createdAt}
            >
              {clockTime(m.createdAt)}
            </time>
          )}
        </div>
      </div>
    </div>
  );
}

function linkify(text: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a
        key={i}
        href={p}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline underline-offset-2 hover:text-white"
      >
        {p}
      </a>
    ) : (
      p
    ),
  );
}
