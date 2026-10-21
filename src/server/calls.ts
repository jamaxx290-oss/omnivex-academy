import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { calls, groupMembers, user } from "./db/schema";

function uuid(): string {
  return crypto.randomUUID();
}

export type CallParticipant = {
  userId: string;
  name: string;
  /** The participant turned their own mic off. */
  selfMuted: boolean;
  /** The host forced their mic off — they cannot unmute until the host lifts it. */
  adminMuted: boolean;
  handRaised: boolean;
  /** Currently sending audio (mic on and not admin-muted). */
  publishing: boolean;
};

export type CallState = {
  id: string;
  groupId: string;
  startedBy: string;
  createdAt: number;
  participants: Map<string, CallParticipant>;
};

/** Active call per group (groupId → state). Lives in memory on purpose:
 *  a call is a live thing; a server restart ends it, while the durable
 *  start/end record is kept in the `calls` table. */
const activeCalls = new Map<string, CallState>();

export type CallSnapshot = {
  id: string;
  groupId: string;
  startedBy: string;
  startedByName: string | null;
  createdAt: string;
  participants: {
    userId: string;
    name: string;
    selfMuted: boolean;
    adminMuted: boolean;
    handRaised: boolean;
    publishing: boolean;
  }[];
};

export async function startCall(
  groupId: string,
  startedBy: string,
): Promise<CallState> {
  const existing = activeCalls.get(groupId);
  if (existing) return existing;
  const id = uuid();
  await db.insert(calls).values({
    id,
    group_id: groupId,
    started_by: startedBy,
    created_at: new Date(),
    ended_at: null,
  });
  const state: CallState = {
    id,
    groupId,
    startedBy,
    createdAt: Date.now(),
    participants: new Map(),
  };
  activeCalls.set(groupId, state);
  return state;
}

export async function endCall(groupId: string): Promise<CallState | null> {
  const state = activeCalls.get(groupId);
  if (!state) return null;
  activeCalls.delete(groupId);
  await db
    .update(calls)
    .set({ ended_at: new Date() })
    .where(and(eq(calls.id, state.id), isNull(calls.ended_at)));
  return state;
}

export function getActiveCall(groupId: string): CallState | null {
  return activeCalls.get(groupId) || null;
}

/** Closes calls left open by a previous process (sockets died with it). */
export async function closeStaleCalls(): Promise<void> {
  try {
    await db
      .update(calls)
      .set({ ended_at: new Date() })
      .where(isNull(calls.ended_at));
  } catch (err) {
    console.warn("[calls] failed to close stale calls:", err);
  }
  activeCalls.clear();
}

export async function addParticipant(
  state: CallState,
  userId: string,
): Promise<CallParticipant> {
  const existing = state.participants.get(userId);
  if (existing) return existing;
  const row = await db.query.user.findFirst({ where: eq(user.id, userId) });
  const p: CallParticipant = {
    userId,
    name: row?.name || "Member",
    selfMuted: true, // everyone joins muted
    adminMuted: false,
    handRaised: false,
    publishing: false,
  };
  state.participants.set(userId, p);
  return p;
}

export function removeParticipant(state: CallState, userId: string): void {
  state.participants.delete(userId);
}

/** Members of a group (for notifications). */
export async function groupMemberIds(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ user_id: groupMembers.user_id })
    .from(groupMembers)
    .where(eq(groupMembers.group_id, groupId));
  return rows.map((r) => r.user_id);
}

export async function snapshot(state: CallState): Promise<CallSnapshot> {
  const row = await db.query.user.findFirst({
    where: eq(user.id, state.startedBy),
  });
  return {
    id: state.id,
    groupId: state.groupId,
    startedBy: state.startedBy,
    startedByName: row?.name || null,
    createdAt: new Date(state.createdAt).toISOString(),
    participants: [...state.participants.values()].map((p) => ({
      userId: p.userId,
      name: p.name,
      selfMuted: p.selfMuted,
      adminMuted: p.adminMuted,
      handRaised: p.handRaised,
      publishing: p.publishing,
    })),
  };
}
