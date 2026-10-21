import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** Lazily connects the shared socket (cookie-authenticated server side). */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
