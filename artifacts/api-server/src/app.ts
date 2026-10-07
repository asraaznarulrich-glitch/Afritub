import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { and, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { channelsTable, db, videosTable } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { OUTPUT_DIR } from "./lib/video-storage";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
const frontendOrigins = new Set(
  (process.env.FRONTEND_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    const allowUnconfiguredDevelopmentOrigin =
      process.env.NODE_ENV !== "production" && frontendOrigins.size === 0;

    if (
      !origin ||
      frontendOrigins.has(origin) ||
      allowUnconfiguredDevelopmentOrigin
    ) {
      callback(null, true);
      return;
    }

    const error = new Error(`CORS origin is not allowed: ${origin}`);
    error.name = "CorsOriginError";
    callback(error);
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86_400,
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.set("trust proxy", 1);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use(
  "/api/output",
  async (req, res, next): Promise<void> => {
    const [videoId] = req.path.split("/").filter(Boolean);
    if (
      !videoId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        videoId,
      )
    ) {
      res.status(404).json({ error: "Vidéo introuvable." });
      return;
    }

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
    if (!video || video.status !== "ready") {
      res.status(404).json({ error: "Vidéo introuvable." });
      return;
    }

    if (video.visibility === "private") {
      const { userId } = getAuth(req);
      if (userId !== video.ownerId) {
        res.status(404).json({ error: "Vidéo introuvable." });
        return;
      }
      res.locals.privateVideoAsset = true;
    }
    next();
  },
  express.static(OUTPUT_DIR, {
    fallthrough: true,
    setHeaders(response, filePath) {
      const extension = path.extname(filePath).toLowerCase();
      if (extension === ".m3u8") {
        response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      } else if (extension === ".ts") {
        response.setHeader("Content-Type", "video/mp2t");
      }
      if (response.locals.privateVideoAsset) {
        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("Vary", "Origin, Cookie, Authorization");
      } else {
        response.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
      }
    },
  }),
);

app.use("/api", router);

app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (
      error instanceof Error &&
      (error.name === "MulterError" ||
        error.name === "UploadValidationError")
    ) {
      const status =
        "code" in error && error.code === "LIMIT_FILE_SIZE"
          ? 413
          : error.name === "MulterError"
            ? 400
            : 415;
      req.log.warn({ err: error }, "Requête d’upload refusée");
      res.status(status).json({ error: error.message });
      return;
    }

    if (error instanceof Error && error.name === "CorsOriginError") {
      req.log.warn({ err: error }, "Origine CORS refusée");
      res.status(403).json({ error: "Origine non autorisée." });
      return;
    }

    req.log.error({ err: error }, "Erreur API non gérée");
    res.status(500).json({ error: "Erreur interne du serveur." });
  },
);

export default app;
