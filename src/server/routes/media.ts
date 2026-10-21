import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "../db";
import { conversationParticipants, groupMembers, uploads } from "../db/schema";
import { env } from "../env";
import { requireMember, type SessionUser } from "../middleware";

function uuid(): string {
  return crypto.randomUUID();
}

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
]);

const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;
const MAX_AUDIO = 8 * 1024 * 1024; // voice notes

function extFor(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/webm": "weba",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
  };
  return map[mime] || "bin";
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(env.uploadsDir, "incoming");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Unsupported file type") as never, "");
    }
    cb(null, `${uuid()}_${Date.now()}.${extFor(file.mimetype)}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO, files: 1 },
});

const router = Router();

/**
 * POST /api/uploads  (multipart: file, kind?, group_id?, conversation_id?)
 * Stores the file under DATA_DIR/uploads/<yyyy>/<mm>/ and records ACL metadata.
 */
router.post("/api/uploads", requireMember, (req: Request, res: Response) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const msg = err.message || "Upload failed";
      return res
        .status(400)
        .json({ error: /file too large/i.test(msg) ? "File is too large" : msg });
    }
    const file = req.file;
    const u = req.appUser as SessionUser;
    if (!file) return res.status(400).json({ error: "No file provided" });

    if (file.size > MAX_IMAGE && !file.mimetype.startsWith("video/")) {
      if (file.size > MAX_AUDIO) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: "File is too large" });
      }
    }

    const kind = String(req.body?.kind || "message") === "avatar" ? "avatar" : "message";
    const now = new Date();
    const rel = path
      .join(
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, "0"),
        path.basename(file.path),
      )
      .replace(/\\/g, "/");
    const dest = path.join(env.uploadsDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file.path, dest);

    const id = uuid();
    const groupId =
      kind === "avatar" && typeof req.body?.group_id === "string"
        ? req.body.group_id
        : typeof req.body?.group_id === "string"
          ? req.body.group_id
          : null;
    const convId =
      typeof req.body?.conversation_id === "string" && req.body.conversation_id
        ? req.body.conversation_id
        : null;

    db.insert(uploads)
      .values({
        id,
        owner_id: u.id,
        path: rel,
        mime: file.mimetype,
        size: file.size,
        kind,
        group_id: groupId,
        conversation_id: convId,
        created_at: now,
      })
      .run();

    res.status(201).json({
      id,
      path: rel,
      url: `/media/${rel}`,
      mime: file.mimetype,
      size: file.size,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Media serving with authentication + ACL + Range                     */
/* ------------------------------------------------------------------ */

async function canAccessMedia(u: SessionUser, rec: {
  owner_id: string;
  kind: string;
  group_id: string | null;
  conversation_id: string | null;
}): Promise<boolean> {
  if (u.is_admin) return true;
  if (rec.owner_id === u.id) return true;
  if (rec.kind === "avatar") return true; // avatars visible to all signed-in members
  if (rec.group_id) {
    const m = await db.query.groupMembers.findFirst({
      where: and(
        eq(groupMembers.group_id, rec.group_id),
        eq(groupMembers.user_id, u.id),
      ),
    });
    return Boolean(m);
  }
  if (rec.conversation_id) {
    const p = await db.query.conversationParticipants.findFirst({
      where: and(
        eq(
          conversationParticipants.conversation_id,
          rec.conversation_id,
        ),
        eq(conversationParticipants.user_id, u.id),
      ),
    });
    return Boolean(p);
  }
  return false;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  weba: "audio/webm",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

/** GET /media/<relative path> — requires session; supports HTTP Range for playback. */
router.get("/media/*path", async (req: Request, res: Response) => {
  const u = req.appUser;
  const raw = (req.params as Record<string, string | string[]>).path;
  const rel = decodeURIComponent(
    (Array.isArray(raw) ? raw.join("/") : String(raw || "")).replace(/^\//, ""),
  );
  if (!rel) return res.status(404).json({ error: "Not found" });

  // path traversal protection
  const abs = path.resolve(env.uploadsDir, rel);
  if (!abs.startsWith(path.resolve(env.uploadsDir) + path.sep)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });

  if (!u) return res.status(401).json({ error: "Sign in required" });

  const rec = sqlite
    .prepare(
      "SELECT owner_id, kind, group_id, conversation_id, mime FROM uploads WHERE path = ?",
    )
    .get(rel) as
    | {
        owner_id: string;
        kind: string;
        group_id: string | null;
        conversation_id: string | null;
        mime: string;
      }
    | undefined;

  if (rec && !(await canAccessMedia(u, rec))) {
    return res.status(403).json({ error: "Not allowed" });
  }

  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime = rec?.mime || MIME_BY_EXT[ext] || "application/octet-stream";
  const stat = fs.statSync(abs);

  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=86400");

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        res.status(416).end();
        return;
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      fs.createReadStream(abs, { start, end }).pipe(res);
      return;
    }
  }

  res.setHeader("Content-Length", String(stat.size));
  fs.createReadStream(abs).pipe(res);
});

export default router;
