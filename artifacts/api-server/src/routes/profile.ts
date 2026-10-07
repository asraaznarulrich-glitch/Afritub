import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  UpdateMyProfileBody,
  UpdateMyProfileResponse,
  GetMyProfileResponse,
} from "@workspace/api-zod";
import { db, profilesTable } from "@workspace/db";
import {
  ensureProfile,
  getAuthenticatedUserId,
  requireAuth,
} from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/me", requireAuth, async (_req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(res);
  const profile = await ensureProfile(userId);
  res.json(GetMyProfileResponse.parse(profile));
});

router.patch("/me", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Profil invalide");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = getAuthenticatedUserId(res);
  await ensureProfile(userId);
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Aucun champ à modifier." });
    return;
  }
  if (
    parsed.data.displayName !== undefined &&
    parsed.data.displayName.trim().length === 0
  ) {
    res.status(400).json({ error: "Le nom affiché ne peut pas être vide." });
    return;
  }

  const [profile] = await db
    .update(profilesTable)
    .set({
      ...parsed.data,
      ...(parsed.data.displayName !== undefined
        ? { displayName: parsed.data.displayName.trim() }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(profilesTable.id, userId))
    .returning();

  res.json(UpdateMyProfileResponse.parse(profile));
});

export default router;
