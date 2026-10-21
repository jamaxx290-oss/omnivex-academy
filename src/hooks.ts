import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./lib/api";
import type { Me, PublicSettings } from "./lib/types";
import { getSocket } from "./lib/socket";

/** Current signed-in user (null when anonymous). */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: Me | null }>("/api/me"),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api<PublicSettings>("/api/settings"),
    staleTime: 60_000,
  });
}

/** Live unread notification badge. */
export function useUnreadNotifications(initial = 0) {
  const [unread, setUnread] = useState(initial);
  useEffect(() => {
    setUnread(initial);
  }, [initial]);
  useEffect(() => {
    const s = getSocket();
    const handler = (payload: { unread?: number }) => {
      if (typeof payload.unread === "number") setUnread(payload.unread);
    };
    s.on("notification:new", handler);
    return () => {
      s.off("notification:new", handler);
    };
  }, []);
  return [unread, setUnread] as const;
}

/** Marks all notifications read and refreshes caches. */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return async () => {
    await api("/api/notifications/read-all", { method: "POST" });
    await qc.invalidateQueries({ queryKey: ["notifications"] });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Subscribes this browser to web push for the signed-in user. */
export async function subscribePush(
  publicKey: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "unsupported" };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, error: "denied" };

    const reg = await navigator.serviceWorker.register("/sw.js");
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = sub.toJSON();
    await api("/api/push/subscribe", {
      method: "POST",
      body: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh || "", auth: json.keys?.auth || "" },
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  try {
    await api("/api/push/unsubscribe", { method: "DELETE", body: { endpoint } });
  } catch {
    /* best effort */
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
