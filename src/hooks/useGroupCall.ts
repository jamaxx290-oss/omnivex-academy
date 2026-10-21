import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { getSocket } from "../lib/socket";
import type { CallState } from "../lib/types";

type PeerEntry = {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};

/** Deterministic perfect-negotiation roles between two users. */
function politeFor(a: string, b: string): boolean {
  return a > b;
}

/** Short two-tone chime for raised hands (no audio asset needed). */
function playHandBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.setValueAtTime(1318.5, t0 + 0.13);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.55);
    window.setTimeout(() => void ctx.close().catch(() => {}), 900);
  } catch {
    /* sound unavailable */
  }
}

/**
 * Group audio call state for one group.
 *
 * Topology: a light mesh where connections exist only to people who are
 * actually speaking, so a 30-person class where 3 people talk costs the
 * listeners almost nothing. Everyone joins muted; mic permission is only
 * requested the first time someone unmutes. A host admin-mute forces the
 * mic off and blocks self-unmute until the host lifts it.
 */
export function useGroupCall(groupId: string, myId: string) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<CallState | null>(null);
  const [selfMuted, setSelfMuted] = useState(true);
  const [adminMuted, setAdminMuted] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [lastHand, setLastHand] = useState<{ name: string; at: number } | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const joinedRef = useRef(false);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const cleanupPeers = useCallback(() => {
    for (const { pc } of peersRef.current.values()) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    peersRef.current.clear();
    setRemoteStreams({});
    audioElsRef.current.clear();
  }, []);

  const ensurePeer = useCallback(
    (peerId: string): PeerEntry => {
      const socket = socketRef.current;
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const entry: PeerEntry = { pc, makingOffer: false, ignoreOffer: false };
      peersRef.current.set(peerId, entry);
      const polite = politeFor(myId, peerId);
      const signal = (data: Record<string, unknown>) => {
        socket?.emit("call:signal", { groupId, to: peerId, data });
      };
      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          signal({ sdp: pc.localDescription });
        } catch (err) {
          console.warn("[call] negotiation failed:", err);
        } finally {
          entry.makingOffer = false;
        }
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) signal({ candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track]);
        setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
      };
      const local = localStreamRef.current;
      if (local) {
        for (const track of local.getTracks()) pc.addTrack(track, local);
      }
      return entry;
    },
    [groupId, myId],
  );

  const dropPeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (entry) {
      try {
        entry.pc.close();
      } catch {
        /* ignore */
      }
      peersRef.current.delete(peerId);
    }
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const stopLocal = useCallback(() => {
    for (const t of localStreamRef.current?.getTracks() || []) t.stop();
    localStreamRef.current = null;
  }, []);

  const leave = useCallback(() => {
    if (joinedRef.current) socketRef.current?.emit("call:leave", groupId);
    joinedRef.current = false;
    setJoined(false);
    cleanupPeers();
    stopLocal();
    setSelfMuted(true);
    setAdminMuted(false);
    setHandRaised(false);
    setRoster(null);
    setError(null);
  }, [groupId, cleanupPeers, stopLocal]);

  /* Socket listeners (registered for the lifetime of this group page). */
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const onRoster = (snap: CallState) => {
      if (snap.groupId !== groupId) return;
      setRoster(snap);
    };
    const onPeerMic = (p: { userId: string; publishing: boolean }) => {
      if (!joinedRef.current || p.userId === myId) return;
      if (p.publishing) ensurePeer(p.userId); // connect to receive their voice
    };
    const onPeerJoined = (p: { userId: string }) => {
      if (!joinedRef.current || p.userId === myId) return;
      ensurePeer(p.userId);
    };
    const onPeerLeft = (p: { userId: string }) => {
      if (p.userId !== myId) dropPeer(p.userId);
    };
    const onHand = (p: { userId: string; name: string; raised: boolean }) => {
      if (!joinedRef.current || p.userId === myId || !p.raised) return;
      playHandBeep();
      setLastHand({ name: p.name, at: Date.now() });
    };
    const onForcedMute = (p: { groupId: string }) => {
      if (p.groupId !== groupId) return;
      for (const t of localStreamRef.current?.getTracks() || []) t.enabled = false;
      setSelfMuted(true);
    };
    const onSignal = async (msg: {
      from: string;
      data: {
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      };
    }) => {
      if (!joinedRef.current || !msg?.from || !msg.data) return;
      const entry = ensurePeer(msg.from);
      const { pc } = entry;
      try {
        if (msg.data.sdp) {
          const offerCollision =
            msg.data.sdp.type === "offer" &&
            (entry.makingOffer || pc.signalingState !== "stable");
          entry.ignoreOffer = !politeFor(myId, msg.from) && offerCollision;
          if (entry.ignoreOffer) return;
          await pc.setRemoteDescription(msg.data.sdp);
          if (msg.data.sdp.type === "offer") {
            await pc.setLocalDescription();
            socket.emit("call:signal", {
              groupId,
              to: msg.from,
              data: { sdp: pc.localDescription },
            });
          }
        } else if (msg.data.candidate) {
          try {
            await pc.addIceCandidate(msg.data.candidate);
          } catch (err) {
            if (!entry.ignoreOffer) throw err;
          }
        }
      } catch (err) {
        console.warn("[call] signal error:", err);
      }
    };
    const onCallEnded = (p: { groupId: string }) => {
      if (p.groupId !== groupId) return;
      joinedRef.current = false;
      setJoined(false);
      cleanupPeers();
      stopLocal();
      setRoster(null);
      setSelfMuted(true);
      setAdminMuted(false);
      setHandRaised(false);
    };

    socket.on("call:roster", onRoster);
    socket.on("call:peer:mic", onPeerMic);
    socket.on("call:peer:joined", onPeerJoined);
    socket.on("call:peer:left", onPeerLeft);
    socket.on("call:hand", onHand);
    socket.on("call:forced-mute", onForcedMute);
    socket.on("call:signal", onSignal);
    socket.on("call:ended", onCallEnded);
    return () => {
      socket.off("call:roster", onRoster);
      socket.off("call:peer:mic", onPeerMic);
      socket.off("call:peer:joined", onPeerJoined);
      socket.off("call:peer:left", onPeerLeft);
      socket.off("call:hand", onHand);
      socket.off("call:forced-mute", onForcedMute);
      socket.off("call:signal", onSignal);
      socket.off("call:ended", onCallEnded);
    };
  }, [groupId, myId, ensurePeer, dropPeer, cleanupPeers, stopLocal]);

  /* Mirror my authoritative flags from the roster (server is the source of truth). */
  useEffect(() => {
    const me = roster?.participants.find((p) => p.userId === myId);
    if (!me) return;
    setSelfMuted(me.selfMuted);
    setAdminMuted(me.adminMuted);
    setHandRaised(me.handRaised);
    for (const t of localStreamRef.current?.getTracks() || []) {
      t.enabled = me.publishing;
    }
  }, [roster, myId]);

  const join = useCallback(async () => {
    if (joinedRef.current) return;
    const socket = getSocket();
    socketRef.current = socket;
    setJoining(true);
    setError(null);
    const ack = await new Promise<{
      ok?: boolean;
      call?: CallState;
      error?: string;
    }>((resolve) => {
      const timer = window.setTimeout(
        () => resolve({ error: "Connection timed out" }),
        8000,
      );
      socket.emit("call:join", groupId, (r: {
        ok?: boolean;
        call?: CallState;
        error?: string;
      }) => {
        window.clearTimeout(timer);
        resolve(r || { error: "Join failed" });
      });
    });
    if (!ack.ok || !ack.call) {
      setError(ack.error || "Could not join the call");
      setJoining(false);
      return;
    }
    setRoster(ack.call);
    joinedRef.current = true;
    setJoined(true);
    setJoining(false);
    // Connect to everyone who is already speaking.
    for (const p of ack.call.participants) {
      if (p.userId !== myId && p.publishing) ensurePeer(p.userId);
    }
  }, [groupId, myId, ensurePeer]);

  const toggleMic = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || !joinedRef.current || micBusy) return;
    const me = roster?.participants.find((p) => p.userId === myId);
    if (me?.adminMuted) return; // host-blocked
    setMicBusy(true);
    setError(null);
    try {
      if (!localStreamRef.current) {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
      }
      const turningOn = selfMuted;
      for (const t of localStreamRef.current.getTracks()) t.enabled = turningOn;
      if (turningOn) {
        for (const { pc } of peersRef.current.values()) {
          const senders = pc.getSenders();
          for (const track of localStreamRef.current.getTracks()) {
            if (!senders.some((s) => s.track === track)) {
              pc.addTrack(track, localStreamRef.current);
            }
          }
        }
      }
      socket.emit("call:mic", { groupId, on: turningOn });
      setSelfMuted(!turningOn);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Microphone unavailable: ${err.message}`
          : "Microphone unavailable",
      );
    } finally {
      setMicBusy(false);
    }
  }, [groupId, myId, roster, selfMuted, micBusy]);

  const toggleHand = useCallback(() => {
    if (!joinedRef.current) return;
    const raised = !handRaised;
    socketRef.current?.emit("call:hand", { groupId, raised });
    setHandRaised(raised);
  }, [groupId, handRaised]);

  const adminSetMute = useCallback(
    (userId: string, muted: boolean) => {
      socketRef.current?.emit("call:admin-mic", { groupId, userId, muted });
    },
    [groupId],
  );

  const bindAudioEl = useCallback((userId: string, el: HTMLAudioElement | null) => {
    if (el) audioElsRef.current.set(userId, el);
    else audioElsRef.current.delete(userId);
  }, []);

  /** Play all remote audio (browser blocked autoplay fallback). */
  const enableAudio = useCallback(() => {
    for (const el of audioElsRef.current.values()) {
      void el.play().catch(() => setAudioBlocked(true));
    }
    setAudioBlocked(false);
  }, []);

  useEffect(() => {
    return () => {
      if (joinedRef.current) {
        socketRef.current?.emit("call:leave", groupId);
        joinedRef.current = false;
      }
      cleanupPeers();
      stopLocal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  return {
    joined,
    joining,
    error,
    roster,
    selfMuted,
    adminMuted,
    handRaised,
    micBusy,
    remoteStreams,
    lastHand,
    audioBlocked,
    join,
    leave,
    toggleMic,
    toggleHand,
    adminSetMute,
    bindAudioEl,
    enableAudio,
  };
}
