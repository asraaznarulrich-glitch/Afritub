import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { OUTPUT_DIR } from "./lib/video-storage";

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
  methods: ["GET", "HEAD", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
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
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  "/api/output",
  express.static(OUTPUT_DIR, {
    fallthrough: true,
    setHeaders(response, filePath) {
      const extension = path.extname(filePath).toLowerCase();
      if (extension === ".m3u8") {
        response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      } else if (extension === ".ts") {
        response.setHeader("Content-Type", "video/mp2t");
      }
      response.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
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
