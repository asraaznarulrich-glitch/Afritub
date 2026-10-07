import {
  and,
  count,
  desc,
  eq,
  ilike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  channelsTable,
  commentsTable,
  db,
  videoLikesTable,
  videosTable,
} from "@workspace/db";

const videoSummaryFields = {
  id: videosTable.id,
  channelId: videosTable.channelId,
  channelName: channelsTable.name,
  channelHandle: channelsTable.handle,
  title: videosTable.title,
  description: videosTable.description,
  category: videosTable.category,
  visibility: videosTable.visibility,
  status: videosTable.status,
  thumbnailUrl: videosTable.thumbnailUrl,
  playlistUrl: videosTable.playlistUrl,
  durationSeconds: videosTable.durationSeconds,
  viewCount: videosTable.viewCount,
  likeCount: sql<number>`(
    select count(*)::int
    from ${videoLikesTable}
    where ${videoLikesTable.videoId} = ${videosTable.id}
  )`,
  commentCount: sql<number>`(
    select count(*)::int
    from ${commentsTable}
    where ${commentsTable.videoId} = ${videosTable.id}
  )`,
  createdAt: videosTable.createdAt,
  updatedAt: videosTable.updatedAt,
};

export type VideoListOptions = {
  page?: number;
  pageSize?: number;
  q?: string;
  category?: string;
  sort?: "recent" | "popular";
  channelId?: string;
  ownerId?: string;
};

export async function listVideoSummaries(options: VideoListOptions = {}) {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const filters: SQL[] = [];

  if (options.ownerId) {
    filters.push(eq(channelsTable.ownerId, options.ownerId));
  } else {
    filters.push(eq(videosTable.status, "ready"));
    filters.push(eq(videosTable.visibility, "public"));
  }

  if (options.channelId) {
    filters.push(eq(videosTable.channelId, options.channelId));
  }
  if (options.category) {
    filters.push(eq(videosTable.category, options.category));
  }
  if (options.q?.trim()) {
    const term = `%${options.q.trim()}%`;
    const matchingText = or(
      ilike(videosTable.title, term),
      ilike(videosTable.description, term),
      ilike(channelsTable.name, term),
    );
    if (matchingText) filters.push(matchingText);
  }

  const where = and(...filters);
  const rows = await db
    .select(videoSummaryFields)
    .from(videosTable)
    .innerJoin(channelsTable, eq(videosTable.channelId, channelsTable.id))
    .where(where)
    .orderBy(
      options.sort === "popular"
        ? desc(videosTable.viewCount)
        : desc(videosTable.createdAt),
      desc(videosTable.createdAt),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ total }] = await db
    .select({ total: count() })
    .from(videosTable)
    .innerJoin(channelsTable, eq(videosTable.channelId, channelsTable.id))
    .where(where);

  return { items: rows, page, pageSize, total };
}

export async function getVideoSummary(videoId: string) {
  const [video] = await db
    .select({
      ...videoSummaryFields,
      ownerId: channelsTable.ownerId,
    })
    .from(videosTable)
    .innerJoin(channelsTable, eq(videosTable.channelId, channelsTable.id))
    .where(eq(videosTable.id, videoId))
    .limit(1);

  return video;
}
