import { getAuth } from "@clerk/express";
import type { RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";

export const requireAuth: RequestHandler = (req, res, next): void => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentification requise." });
    return;
  }

  res.locals.userId = userId;
  next();
};

export function getAuthenticatedUserId(res: Response): string {
  return res.locals.userId as string;
}

export async function ensureProfile(userId: string) {
  await db
    .insert(profilesTable)
    .values({ id: userId })
    .onConflictDoNothing({ target: profilesTable.id });

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, userId))
    .limit(1);

  return profile;
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
