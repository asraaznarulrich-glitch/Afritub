import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";

export const channelsTable = pgTable(
  "channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    description: text("description").notNull().default(""),
    avatarUrl: text("avatar_url"),
    bannerUrl: text("banner_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("channels_handle_unique").on(table.handle)],
);

export const insertChannelSchema = createInsertSchema(channelsTable);
export const selectChannelSchema = createSelectSchema(channelsTable);
export type Channel = typeof channelsTable.$inferSelect;
