import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";
import { videosTable } from "./videos";

export const commentsTable = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videosTable.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("comments_video_idx").on(table.videoId, table.createdAt)],
);

export const insertCommentSchema = createInsertSchema(commentsTable);
export const selectCommentSchema = createSelectSchema(commentsTable);
export type Comment = typeof commentsTable.$inferSelect;
