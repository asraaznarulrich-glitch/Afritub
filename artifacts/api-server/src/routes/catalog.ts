import { and, count, desc, eq } from "drizzle-orm";
import { rm } from "node:fs/promises";
import path from "node:path";
import { Router, type IRouter } from "express";
import {
  DeleteVideoParams,
  GetVideoParams,
  GetVideoResponse,
  ListMyVideosResponse,
  ListVideoCategoriesResponse,
  SearchVideosQueryParams,
  SearchVideosResponse,
  UpdateVideoBody,
  UpdateVideoParams,
  UpdateVideoResponse,
} from "@workspace/api-zod";
import {
  channelsTable,
  db,
  videosTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import {
  getAuthenticatedUserId,
  requireAuth,
} from "../middlewares/require-auth";
import { getVideoSummary, listVideoSummaries } from "../lib/video-queries";
import { OUTPUT_DIR } from "../lib/video-storage";

const router: IRouter = Router();

router.get("/videos", async (req, res): Promise<void> => {
  const parsed = SearchVideosQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await listVideoSummaries({
    q: parsed.data.q,
    category: parsed.data.category,
    sort: parsed.data.sort,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
  res.json(SearchVideosResponse.parse(result));
});

router.get("/me/videos", requireAuth, async (_req, res): Promise<void> => {
  const ownerId = getAuthenticatedUserId(res);
  const result = await listVideoSummaries({
    ownerId,
    page: 1,
    pageSize: 50,
    sort: "recent",
  });
  res.json(ListMyVideosResponse.parse(result));
});

router.get("/videos/:videoId", async (req, res): Promise<void> => {
  const params = GetVideoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const video = await getVideoSummary(params.data.videoId);
  const viewerId = getAuth(req).userId;
  if (!video) {
    res.status(404).json({ error: "Vidéo introuvable." });
    return;
  }
  if (
    (video.status !== "ready" || video.visibility === "private") &&
    video.ownerId !== viewerId
  ) {
    res.status(404).json({ error: "Vidéo introuvable." });
    return;
  }
  res.json(GetVideoResponse.parse(video));
});

router.patch(
  "/videos/:videoId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateVideoParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateVideoBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Aucun champ à modifier." });
      return;
    }
    if (parsed.data.title !== undefined && parsed.data.title.trim().length === 0) {
      res.status(400).json({ error: "Le titre ne peut pas être vide." });
      return;
    }

    const userId = getAuthenticatedUserId(res);
    const [ownedVideo] = await db
      .select({ id: videosTable.id })
      .from(videosTable)
      .innerJoin(channelsTable, eq(videosTable.channelId, channelsTable.id))
      .where(
        and(
          eq(videosTable.id, params.data.videoId),
          eq(channelsTable.ownerId, userId),
        ),
      )
      .limit(1);
    if (!ownedVideo) {
      res.status(404).json({ error: "Vidéo introuvable ou non autorisée." });
      return;
    }

    await db
      .update(videosTable)
      .set({
        ...parsed.data,
        ...(parsed.data.title !== undefined
          ? { title: parsed.data.title.trim() }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(videosTable.id, ownedVideo.id));
    const updated = await getVideoSummary(ownedVideo.id);
    res.json(UpdateVideoResponse.parse(updated));
  },
);

router.delete(
  "/videos/:videoId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteVideoParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const userId = getAuthenticatedUserId(res);
    const [ownedVideo] = await db
      .select({ id: videosTable.id })
      .from(videosTable)
      .innerJoin(channelsTable, eq(videosTable.channelId, channelsTable.id))
      .where(
        and(
          eq(videosTable.id, params.data.videoId),
          eq(channelsTable.ownerId, userId),
        ),
      )
      .limit(1);
    if (!ownedVideo) {
      res.status(404).json({ error: "Vidéo introuvable ou non autorisée." });
      return;
    }

    await db.delete(videosTable).where(eq(videosTable.id, ownedVideo.id));
    await rm(path.join(OUTPUT_DIR, ownedVideo.id), {
      recursive: true,
      force: true,
    }).catch((error: unknown) => {
      req.log.error(
        { err: error, videoId: ownedVideo.id },
        "Impossible de supprimer les segments HLS de la vidéo",
      );
    });
    req.log.info({ videoId: ownedVideo.id, ownerId: userId }, "Vidéo supprimée");
    res.sendStatus(204);
  },
);

router.get("/categories", async (_req, res): Promise<void> => {
  const categories = await db
    .select({
      name: videosTable.category,
      videoCount: count(),
    })
    .from(videosTable)
    .where(
      and(
        eq(videosTable.status, "ready"),
        eq(videosTable.visibility, "public"),
      ),
    )
    .groupBy(videosTable.category)
    .orderBy(desc(count()));
  res.json(ListVideoCategoriesResponse.parse(categories));
});

export default router;
