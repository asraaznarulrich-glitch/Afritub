import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { channelsTable } from "./channels";
import { profilesTable } from "./profiles";

export const channelSubscriptionsTable = pgTable(
  "channel_subscriptions",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channelsTable.id, { onDelete: "cascade" }),
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.subscriberId] }),
  ],
);

export const insertChannelSubscriptionSchema =
  createInsertSchema(channelSubscriptionsTable);
export const selectChannelSubscriptionSchema =
  createSelectSchema(channelSubscriptionsTable);
