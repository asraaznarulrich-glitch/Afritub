import { getAuth } from "@clerk/express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateVideoCommentBody,
  CreateVideoCommentParams,
  CreateVideoCommentResponse,
  DeleteCommentParams,
  GetVideoLikeStateParams,
  GetVideoLikeStateResponse,
  LikeVideoParams,
  LikeVideoResponse,
  ListVideoCommentsParams,
  ListVideoCommentsResponse,
  RecordVideoViewParams,
  RecordVideoViewResponse,
  UnlikeVideoParams,
  UnlikeVideoResponse,
} from "@workspace/api-zod";
import {
  channelsTable,
  commentsTable,
  db,
  profilesTable,
  videoLikesTable,
  videosTable,
  videoViewsTable,
} from "@workspace/db";
import {
  ensureProfile,
  getAuthenticatedUserId,
  requireAuth,
} from "../middlewares/require-auth";

const router: IRouter = Router();

async function canViewVideo(
  videoId: string,
  viewerId: string | null | undefined,
): Promise<boolean> {
  const [video] = await db
    .select({
      status: videosTable.status,
      visibility: videosTable.visibility,
      ownerId: channelsTable.ownerId,
    })
    .from(videosTable)
    .innerJoin(channelsTable, eq(videosTable.channelId, channelsTable.id))
    .where(eq(videosTable.id, videoId))
    .limit(1);

  if (!video) return false;
  if (video.status !== "ready" && video.ownerId !== viewerId) return false;
  return video.visibility !== "private" || video.ownerId === viewerId;
}

async function countLikes(videoId: string): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(videoLikesTable)
    .where(eq(videoLikesTable.videoId, videoId));
  return result?.total ?? 0;
}

router.get(
  "/videos/:videoId/comments",
  async (req, res): Promise<void> => {
    const params = ListVideoCommentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!await canViewVideo(params.data.videoId, getAuth(req).userId)) {
      res.status(404).json({ error: "Vidéo introuvable." });
      return;
    }

    const comments = await db
      .select({
        id: commentsTable.id,
        videoId: commentsTable.videoId,
        authorId: commentsTable.authorId,
        authorDisplayName: profilesTable.displayName,
        content: commentsTable.content,
        createdAt: commentsTable.createdAt,
      })
      .from(commentsTable)
      .innerJoin(profilesTable, eq(commentsTable.authorId, profilesTable.id))
      .where(eq(commentsTable.videoId, params.data.videoId))
      .orderBy(desc(commentsTable.createdAt))
      .limit(100);
    res.json(ListVideoCommentsResponse.parse(comments));
  },
);

router.post(
  "/videos/:videoId/comments",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateVideoCommentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateVideoCommentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const content = parsed.data.content.trim();
    if (content.length === 0) {
      res.status(400).json({ error: "Le commentaire ne peut pas être vide." });
      return;
    }

    const authorId = getAuthenticatedUserId(res);
    if (!await canViewVideo(params.data.videoId, authorId)) {
      res.status(404).json({ error: "Vidéo introuvable." });
      return;
    }
    const profile = await ensureProfile(authorId);
    const [comment] = await db
      .insert(commentsTable)
      .values({
        videoId: params.data.videoId,
        authorId,
        content,
      })
      .returning();
    req.log.info(
      { commentId: comment.id, videoId: comment.videoId, authorId },
      "Commentaire créé",
    );
    res.status(201).json(
      CreateVideoCommentResponse.parse({
        ...comment,
        authorDisplayName: profile.displayName,
      }),
    );
  },
);

router.delete(
  "/comments/:commentId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteCommentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const userId = getAuthenticatedUserId(res);
    const [comment] = await db
      .select({
        id: commentsTable.id,
        authorId: commentsTable.authorId,
        ownerId: channelsTable.ownerId,
      })
      .from(commentsTable)
      .innerJoin(videosTable, eq(commentsTable.videoId, videosTable.id))
      .innerJoin(channelsTable, eq(videosTable.channelId, channelsTable.id))
      .where(eq(commentsTable.id, params.data.commentId))
      .limit(1);
    if (!comment) {
      res.status(404).json({ error: "Commentaire introuvable." });
      return;
    }
    if (comment.authorId !== userId && comment.ownerId !== userId) {
      res.status(403).json({ error: "Vous ne pouvez pas supprimer ce commentaire." });
      return;
    }
    await db.delete(commentsTable).where(eq(commentsTable.id, comment.id));
    res.sendStatus(204);
  },
);

router.get(
  "/videos/:videoId/likes",
  async (req, res): Promise<void> => {
    const params = GetVideoLikeStateParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const viewerId = getAuth(req).userId;
    if (!await canViewVideo(params.data.videoId, viewerId)) {
      res.status(404).json({ error: "Vidéo introuvable." });
      return;
    }
    const like = viewerId
      ? await db
          .select({ userId: videoLikesTable.userId })
          .from(videoLikesTable)
          .where(
            and(
              eq(videoLikesTable.videoId, params.data.videoId),
              eq(videoLikesTable.userId, viewerId),
            ),
          )
          .limit(1)
      : [];
    res.json(
      GetVideoLikeStateResponse.parse({
        liked: like.length > 0,
        likeCount: await countLikes(params.data.videoId),
      }),
    );
  },
);

router.post(
  "/videos/:videoId/likes",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = LikeVideoParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const userId = getAuthenticatedUserId(res);
    if (!await canViewVideo(params.data.videoId, userId)) {
      res.status(404).json({ error: "Vidéo introuvable." });
      return;
    }
    await ensureProfile(userId);
    await db
      .insert(videoLikesTable)
      .values({ videoId: params.data.videoId, userId })
      .onConflictDoNothing();
    res.json(
      LikeVideoResponse.parse({
        liked: true,
        likeCount: await countLikes(params.data.videoId),
      }),
    );
  },
);

router.delete(
  "/videos/:videoId/likes",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UnlikeVideoParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const userId = getAuthenticatedUserId(res);
    if (!await canViewVideo(params.data.videoId, userId)) {
      res.status(404).json({ error: "Vidéo introuvable." });
      return;
    }
    await db
      .delete(videoLikesTable)
      .where(
        and(
          eq(videoLikesTable.videoId, params.data.videoId),
          eq(videoLikesTable.userId, userId),
        ),
      );
    res.json(
      UnlikeVideoResponse.parse({
        liked: false,
        likeCount: await countLikes(params.data.videoId),
      }),
    );
  },
);

router.post(
  "/videos/:videoId/views",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = RecordVideoViewParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const viewerId = getAuthenticatedUserId(res);
    if (!await canViewVideo(params.data.videoId, viewerId)) {
      res.status(404).json({ error: "Vidéo introuvable." });
      return;
    }
    await ensureProfile(viewerId);
    const [newView] = await db
      .insert(videoViewsTable)
      .values({ videoId: params.data.videoId, viewerId })
      .onConflictDoNothing()
      .returning();
    if (newView) {
      await db
        .update(videosTable)
        .set({ viewCount: sql`${videosTable.viewCount} + 1` })
        .where(eq(videosTable.id, params.data.videoId));
    }
    const [video] = await db
      .select({ viewCount: videosTable.viewCount })
      .from(videosTable)
      .where(eq(videosTable.id, params.data.videoId))
      .limit(1);
    res.json(
      RecordVideoViewResponse.parse({
        counted: Boolean(newView),
        viewCount: video?.viewCount ?? 0,
      }),
    );
  },
);

export default router;
