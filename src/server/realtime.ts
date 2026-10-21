import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { conversationParticipants, groupMembers, user } from "./db/schema";
import { auth } from "./auth";
import type { SessionUser } from "./middleware";

let io: Server | null = null;

export function getIO(): Server | null {
  return io;
}

async function identify(socket: Socket): Promise<SessionUser | null> {
  const cookieHeader = socket.handshake.headers.cookie;
  if (!cookieHeader) return null;
  try {
    const session = await auth.api.getSession({
      headers: { cookie: cookieHeader } as never,
    });
    if (!session?.user?.id) return null;
    const row = await db.query.user.findFirst({
      where: eq(user.id, session.user.id),
    });
    return (row as unknown as SessionUser) ?? null;
  } catch {
    return null;
  }
}

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
    serveClient: false,
  });

  io.use(async (socket, next) => {
    const u = await identify(socket);
    if (!u || !u.emailVerified || u.banned_at) {
      return next(new Error("unauthorized"));
    }
    (socket.data as { user: SessionUser }).user = u;
    next();
  });

  io.on("connection", async (socket) => {
    const u = (socket.data as { user: SessionUser }).user;
    await socket.join(`user:${u.id}`);

    // Join group rooms for every group the user belongs to
    try {
      const memberships = await db
        .select({ group_id: groupMembers.group_id })
        .from(groupMembers)
        .where(eq(groupMembers.user_id, u.id));
      for (const m of memberships) await socket.join(`group:${m.group_id}`);

      const convs = await db
        .select({ conversation_id: conversationParticipants.conversation_id })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.user_id, u.id));
      for (const c of convs) await socket.join(`dm:${c.conversation_id}`);
    } catch (err) {
      console.warn("[socket] room join failed:", err);
    }

    // Re-validate membership when groups change elsewhere
    socket.on("groups:sync", async (cb?: (ids: string[]) => void) => {
      try {
        const memberships = await db
          .select({ group_id: groupMembers.group_id })
          .from(groupMembers)
          .where(eq(groupMembers.user_id, u.id));
        const ids = memberships.map((m) => m.group_id);
        if (typeof cb === "function") cb(ids);
      } catch {
        if (typeof cb === "function") cb([]);
      }
    });

    socket.on("leave:group", async (groupId: unknown) => {
      if (typeof groupId === "string") await socket.leave(`group:${groupId}`);
    });

    socket.on("join:group", async (groupId: unknown) => {
      if (typeof groupId !== "string") return;
      const member = await db.query.groupMembers.findFirst({
        where: and(
          eq(groupMembers.group_id, groupId),
          eq(groupMembers.user_id, u.id),
        ),
      });
      if (member) await socket.join(`group:${groupId}`);
    });

    socket.on("disconnect", () => {
      /* rooms are cleaned up automatically */
    });
  });

  return io;
}
