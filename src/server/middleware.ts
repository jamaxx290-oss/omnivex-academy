import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { user } from "./db/schema";
import { auth } from "./auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  is_admin: boolean;
  membership_status: string;
  membership_expires_at: Date | null;
  banned_at: Date | null;
  whatsapp_number: string | null;
  country: string | null;
  state_region: string | null;
  gender: string | null;
  image: string | null;
  createdAt: Date;
};

declare module "express-serve-static-core" {
  interface Request {
    appUser?: SessionUser | null;
    session?: Awaited<ReturnType<typeof auth.api.getSession>>;
  }
}

export function hasActiveMembership(u: SessionUser): boolean {
  if (u.is_admin) return true;
  if (u.banned_at) return false;
  if (u.membership_status !== "active") return false;
  if (u.membership_expires_at && u.membership_expires_at.getTime() < Date.now())
    return false;
  return true;
}

/** Loads the full application user for the Better Auth session, if any. */
export async function loadUser(
  req: Request,
): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers: req.headers as never });
    if (!session?.user?.id) return null;
    const row = await db.query.user.findFirst({
      where: eq(user.id, session.user.id),
    });
    return (row as unknown as SessionUser) ?? null;
  } catch {
    return null;
  }
}

/** Attaches req.appUser (null when anonymous). Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  loadUser(req)
    .then((u) => {
      req.appUser = u;
      next();
    })
    .catch(() => {
      req.appUser = null;
      next();
    });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.appUser) {
    return res.status(401).json({ error: "Not signed in" });
  }
  next();
}

export function requireVerified(req: Request, res: Response, next: NextFunction) {
  const u = req.appUser;
  if (!u) return res.status(401).json({ error: "Not signed in" });
  if (!u.emailVerified) {
    return res.status(403).json({ error: "Email not verified", code: "EMAIL_UNVERIFIED" });
  }
  if (u.banned_at) {
    return res.status(403).json({ error: "Account suspended", code: "BANNED" });
  }
  next();
}

/** Verified + active membership (admins bypass). */
export function requireMember(req: Request, res: Response, next: NextFunction) {
  const u = req.appUser;
  if (!u) return res.status(401).json({ error: "Not signed in" });
  if (!u.emailVerified) {
    return res.status(403).json({ error: "Email not verified", code: "EMAIL_UNVERIFIED" });
  }
  if (u.banned_at) {
    return res.status(403).json({ error: "Account suspended", code: "BANNED" });
  }
  if (!hasActiveMembership(u)) {
    return res.status(403).json({ error: "Membership required", code: "MEMBERSHIP_REQUIRED" });
  }
  next();
}

/**
 * Administrator guard. The role is read from the database on every request;
 * there is no client-side path that can grant it.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = req.appUser;
  if (!u) return res.status(401).json({ error: "Not signed in" });
  if (!u.is_admin) {
    return res.status(403).json({ error: "Admin access required", code: "FORBIDDEN" });
  }
  next();
}
