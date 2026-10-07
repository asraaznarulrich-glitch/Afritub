import { and, count, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateChannelBody,
  CreateChannelResponse,
  GetChannelByHandleParams,
  GetChannelByHandleResponse,
  GetChannelSubscriptionStateParams,
  GetChannelSubscriptionStateResponse,
  GetChannelParams,
  GetChannelResponse,
  ListChannelVideosParams,
  ListChannelVideosResponse,
  ListMyChannelsResponse,
  ListMySubscriptionsResponse,
  SubscribeToChannelParams,
  SubscribeToChannelResponse,
  UnsubscribeFromChannelParams,
  UnsubscribeFromChannelResponse,
  UpdateChannelBody,
  UpdateChannelParams,
  UpdateChannelResponse,
} from "@workspace/api-zod";
import {
  channelSubscriptionsTable,
  channelsTable,
  db,
  videosTable,
} from "@workspace/db";
import {
  ensureProfile,
  getAuthenticatedUserId,
  isUniqueConstraintViolation,
  requireAuth,
} from "../middlewares/require-auth";
import { listVideoSummaries } from "../lib/video-queries";

const router: IRouter = Router();

async function getChannelPayload(channel: typeof channelsTable.$inferSelect) {
  const [subscriberResult, videoResult] = await Promise.all([
    db
      .select({ total: count() })
      .from(channelSubscriptionsTable)
      .where(eq(channelSubscriptionsTable.channelId, channel.id)),
    db
      .select({ total: count() })
      .from(videosTable)
      .where(
        and(
          eq(videosTable.channelId, channel.id),
          eq(videosTable.status, "ready"),
          eq(videosTable.visibility, "public"),
        ),
      ),
  ]);

  return {
    ...channel,
    subscriberCount: subscriberResult[0]?.total ?? 0,
    videoCount: videoResult[0]?.total ?? 0,
  };
}

router.get("/me/channels", requireAuth, async (_req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(res);
  await ensureProfile(userId);
  const channels = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.ownerId, userId))
    .orderBy(channelsTable.createdAt);
  const results = await Promise.all(channels.map(getChannelPayload));
  res.json(ListMyChannelsResponse.parse(results));
});

router.get(
  "/me/subscriptions",
  requireAuth,
  async (_req, res): Promise<void> => {
    const subscriberId = getAuthenticatedUserId(res);
    const subscriptions = await db
      .select({ channelId: channelSubscriptionsTable.channelId })
      .from(channelSubscriptionsTable)
      .where(eq(channelSubscriptionsTable.subscriberId, subscriberId))
      .orderBy(desc(channelSubscriptionsTable.createdAt));
    if (subscriptions.length === 0) {
      res.json(ListMySubscriptionsResponse.parse([]));
      return;
    }

    const channels = await db
      .select()
      .from(channelsTable)
      .where(inArray(
        channelsTable.id,
        subscriptions.map((subscription) => subscription.channelId),
      ));
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));
    const results = await Promise.all(
      subscriptions.map((subscription) => {
        const channel = channelById.get(subscription.channelId);
        if (!channel) {
          throw new Error("Subscribed channel is missing from the database.");
        }
        return getChannelPayload(channel);
      }),
    );
    res.json(ListMySubscriptionsResponse.parse(results));
  },
);

router.post("/channels", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateChannelBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Création de chaîne invalide");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = getAuthenticatedUserId(res);
  const name = parsed.data.name.trim();
  if (name.length === 0) {
    res.status(400).json({ error: "Le nom de la chaîne ne peut pas être vide." });
    return;
  }
  await ensureProfile(userId);
  try {
    const [channel] = await db
      .insert(channelsTable)
      .values({
        ownerId: userId,
        name,
        handle: parsed.data.handle,
        description: parsed.data.description ?? "",
        avatarUrl: parsed.data.avatarUrl ?? null,
        bannerUrl: parsed.data.bannerUrl ?? null,
      })
      .returning();
    req.log.info({ channelId: channel.id, ownerId: userId }, "Chaîne créée");
    res.status(201).json(
      CreateChannelResponse.parse(await getChannelPayload(channel)),
    );
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      res.status(409).json({ error: "Cet identifiant de chaîne est déjà pris." });
      return;
    }
    throw error;
  }
});

router.get(
  "/channels/by-handle/:handle",
  async (req, res): Promise<void> => {
    const params = GetChannelByHandleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [channel] = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.handle, params.data.handle))
      .limit(1);
    if (!channel) {
      res.status(404).json({ error: "Chaîne introuvable." });
      return;
    }

    res.json(
      GetChannelByHandleResponse.parse(await getChannelPayload(channel)),
    );
  },
);

router.get(
  "/channels/:channelId/videos",
  async (req, res): Promise<void> => {
    const params = ListChannelVideosParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [channel] = await db
      .select({ id: channelsTable.id })
      .from(channelsTable)
      .where(eq(channelsTable.id, params.data.channelId))
      .limit(1);
    if (!channel) {
      res.status(404).json({ error: "Chaîne introuvable." });
      return;
    }
    const videos = await listVideoSummaries({
      channelId: channel.id,
      page: 1,
      pageSize: 20,
    });
    res.json(ListChannelVideosResponse.parse(videos));
  },
);

router.get("/channels/:channelId", async (req, res): Promise<void> => {
  const params = GetChannelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [channel] = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.id, params.data.channelId))
    .limit(1);
  if (!channel) {
    res.status(404).json({ error: "Chaîne introuvable." });
    return;
  }
  res.json(GetChannelResponse.parse(await getChannelPayload(channel)));
});

router.patch(
  "/channels/:channelId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateChannelParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateChannelBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Aucun champ à modifier." });
      return;
    }
    if (parsed.data.name !== undefined && parsed.data.name.trim().length === 0) {
      res.status(400).json({ error: "Le nom de la chaîne ne peut pas être vide." });
      return;
    }

    const userId = getAuthenticatedUserId(res);
    try {
      const [channel] = await db
        .update(channelsTable)
        .set({
          ...parsed.data,
          ...(parsed.data.name !== undefined
            ? { name: parsed.data.name.trim() }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(channelsTable.id, params.data.channelId),
            eq(channelsTable.ownerId, userId),
          ),
        )
        .returning();
      if (!channel) {
        res.status(404).json({ error: "Chaîne introuvable ou non autorisée." });
        return;
      }
      res.json(UpdateChannelResponse.parse(await getChannelPayload(channel)));
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        res.status(409).json({ error: "Cet identifiant de chaîne est déjà pris." });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/channels/:channelId/subscription",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetChannelSubscriptionStateParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const subscriberId = getAuthenticatedUserId(res);
    const [channel] = await db
      .select({ id: channelsTable.id })
      .from(channelsTable)
      .where(eq(channelsTable.id, params.data.channelId))
      .limit(1);
    if (!channel) {
      res.status(404).json({ error: "Chaîne introuvable." });
      return;
    }
    const [subscription, result] = await Promise.all([
      db
        .select({ channelId: channelSubscriptionsTable.channelId })
        .from(channelSubscriptionsTable)
        .where(
          and(
            eq(channelSubscriptionsTable.channelId, channel.id),
            eq(channelSubscriptionsTable.subscriberId, subscriberId),
          ),
        )
        .limit(1),
      db
        .select({ subscriberCount: count() })
        .from(channelSubscriptionsTable)
        .where(eq(channelSubscriptionsTable.channelId, channel.id)),
    ]);
    res.json(
      GetChannelSubscriptionStateResponse.parse({
        subscribed: subscription.length > 0,
        subscriberCount: result[0]?.subscriberCount ?? 0,
      }),
    );
  },
);

router.put(
  "/channels/:channelId/subscription",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = SubscribeToChannelParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const subscriberId = getAuthenticatedUserId(res);
    await ensureProfile(subscriberId);
    const [channel] = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.id, params.data.channelId))
      .limit(1);
    if (!channel) {
      res.status(404).json({ error: "Chaîne introuvable." });
      return;
    }
    if (channel.ownerId === subscriberId) {
      res.status(400).json({ error: "Vous ne pouvez pas suivre votre propre chaîne." });
      return;
    }

    await db
      .insert(channelSubscriptionsTable)
      .values({ channelId: channel.id, subscriberId })
      .onConflictDoNothing();
    const [result] = await db
      .select({ subscriberCount: count() })
      .from(channelSubscriptionsTable)
      .where(eq(channelSubscriptionsTable.channelId, channel.id));
    res.json(
      SubscribeToChannelResponse.parse({
        subscribed: true,
        subscriberCount: result?.subscriberCount ?? 0,
      }),
    );
  },
);

router.delete(
  "/channels/:channelId/subscription",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UnsubscribeFromChannelParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const subscriberId = getAuthenticatedUserId(res);
    await db
      .delete(channelSubscriptionsTable)
      .where(
        and(
          eq(channelSubscriptionsTable.channelId, params.data.channelId),
          eq(channelSubscriptionsTable.subscriberId, subscriberId),
        ),
      );
    const [result] = await db
      .select({ subscriberCount: count() })
      .from(channelSubscriptionsTable)
      .where(eq(channelSubscriptionsTable.channelId, params.data.channelId));
    res.json(
      UnsubscribeFromChannelResponse.parse({
        subscribed: false,
        subscriberCount: result?.subscriberCount ?? 0,
      }),
    );
  },
);

export default router;
