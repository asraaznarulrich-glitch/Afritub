import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";
import { videosTable } from "./videos";

export const videoLikesTable = pgTable(
  "video_likes",
  {
    videoId: uuid("video_id")
      .notNull()
      .references(() => videosTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.videoId, table.userId] })],
);

export const insertVideoLikeSchema = createInsertSchema(videoLikesTable);
export const selectVideoLikeSchema = createSelectSchema(videoLikesTable);
