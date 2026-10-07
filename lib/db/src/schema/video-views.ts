import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";
import { videosTable } from "./videos";

export const videoViewsTable = pgTable(
  "video_views",
  {
    videoId: uuid("video_id")
      .notNull()
      .references(() => videosTable.id, { onDelete: "cascade" }),
    viewerId: text("viewer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.videoId, table.viewerId] })],
);

export const insertVideoViewSchema = createInsertSchema(videoViewsTable);
export const selectVideoViewSchema = createSelectSchema(videoViewsTable);
