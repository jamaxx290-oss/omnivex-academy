import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { groups } from "../db/schema";
import { requireMember, type SessionUser } from "../middleware";
import { getIO } from "../realtime";
import { notify } from "../notifications";
import {
  startCall,
  endCall,
  getActiveCall,
  snapshot,
  groupMemberIds,
  type CallSnapshot,
} from "../calls";
import { isGroupMember } from "./groups";

const router = Router();

async function activeSnapshot(groupId: string): Promise<CallSnapshot | null> {
  const state = getActiveCall(groupId);
  return state ? snapshot(state) : null;
}

/**
 * POST /api/groups/:id/call — start a group call.
 * Only platform admins can initiate; every group member is notified.
 */
router.post(
  "/groups/:id/call",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    if (!u.is_admin) {
      return res
        .status(403)
        .json({ error: "Only the admin can start a call", code: "FORBIDDEN" });
    }
    const groupId = String(req.params.id);
    const g = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
    if (!g || g.archived_at) {
      return res.status(404).json({ error: "Group not found" });
    }

    const existing = getActiveCall(groupId);
    if (existing) {
      return res.status(200).json({
        call: await snapshot(existing),
        alreadyActive: true,
      });
    }

    await startCall(groupId, u.id);
    const call = await activeSnapshot(groupId);

    getIO()
      ?.to(`group:${groupId}`)
      .emit("call:started", {
        call,
        startedByName: u.name,
        groupName: g.name,
      });

    // Notify every member of this group (in-app bell + push per their prefs).
    const memberIds = await groupMemberIds(groupId);
    for (const id of memberIds) {
      if (id === u.id) continue;
      void notify({
        userId: id,
        type: "system",
        actorId: u.id,
        title: `Live class started in ${g.name}`,
        body: `${u.name} started a live call. Tap to join.`,
        link: `/app/groups/${groupId}`,
        pushBody: `${u.name} started a live class in ${g.name} — tap to join`,
      });
    }

    res.status(201).json({ call });
  },
);

/** GET /api/groups/:id/call — the active call for members of the group. */
router.get(
  "/groups/:id/call",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const groupId = String(req.params.id);
    const g = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
    if (!g || g.archived_at) {
      return res.status(404).json({ error: "Group not found" });
    }
    if (!u.is_admin && !(await isGroupMember(groupId, u.id))) {
      return res
        .status(403)
        .json({ error: "Not a member of this group", code: "FORBIDDEN" });
    }
    res.json({ call: await activeSnapshot(groupId) });
  },
);

/** POST /api/groups/:id/call/end — end the call for everyone (admin only). */
router.post(
  "/groups/:id/call/end",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    if (!u.is_admin) {
      return res
        .status(403)
        .json({ error: "Only the admin can end a call", code: "FORBIDDEN" });
    }
    const groupId = String(req.params.id);
    const state = getActiveCall(groupId);
    if (!state) return res.status(404).json({ error: "No active call" });
    await endCall(groupId);
    getIO()
      ?.to(`call:${groupId}`)
      .to(`group:${groupId}`)
      .emit("call:ended", { groupId, callId: state.id });
    res.json({ ok: true });
  },
);

export default router;
