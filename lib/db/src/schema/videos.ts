import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { channelsTable } from "./channels";

export const videoVisibilityEnum = pgEnum("video_visibility", [
  "public",
  "unlisted",
  "private",
]);

export const videoStatusEnum = pgEnum("video_status", [
  "processing",
  "ready",
  "failed",
]);

export const videosTable = pgTable(
  "videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channelsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("Autre"),
    visibility: videoVisibilityEnum("visibility").notNull().default("public"),
    status: videoStatusEnum("status").notNull().default("processing"),
    thumbnailUrl: text("thumbnail_url"),
    playlistUrl: text("playlist_url"),
    durationSeconds: integer("duration_seconds"),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("videos_discovery_idx").on(
      table.status,
      table.visibility,
      table.createdAt,
    ),
    index("videos_channel_idx").on(table.channelId, table.createdAt),
    index("videos_category_idx").on(table.category),
  ],
);

export const insertVideoSchema = createInsertSchema(videosTable);
export const selectVideoSchema = createSelectSchema(videosTable);
export type Video = typeof videosTable.$inferSelect;
