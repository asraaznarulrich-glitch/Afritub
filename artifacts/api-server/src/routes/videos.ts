import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink, access } from "node:fs/promises";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { UploadVideoBody, UploadVideoResponse } from "@workspace/api-zod";
import { channelsTable, db, videosTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { OUTPUT_DIR, UPLOADS_DIR } from "../lib/video-storage";
import {
  ensureProfile,
  getAuthenticatedUserId,
  requireAuth,
} from "../middlewares/require-auth";
import { getVideoSummary } from "../lib/video-queries";

const router: IRouter = Router();
const maxUploadSizeMb = Number(process.env.MAX_UPLOAD_SIZE_MB ?? 1024);
const maxUploadSizeBytes = maxUploadSizeMb * 1024 * 1024;

if (!Number.isFinite(maxUploadSizeBytes) || maxUploadSizeBytes <= 0) {
  throw new Error("MAX_UPLOAD_SIZE_MB must be a positive number.");
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      mkdir(UPLOADS_DIR, { recursive: true })
        .then(() => callback(null, UPLOADS_DIR))
        .catch((error: unknown) => callback(error as Error, UPLOADS_DIR));
    },
    filename(_req, _file, callback) {
      callback(null, `${randomUUID()}.upload`);
    },
  }),
  limits: {
    fileSize: maxUploadSizeBytes,
    files: 1,
  },
  fileFilter(_req, file, callback) {
    if (
      file.mimetype.startsWith("video/") ||
      file.mimetype === "application/octet-stream"
    ) {
      callback(null, true);
      return;
    }

    const error = new Error("Le fichier envoyé doit être une vidéo.");
    error.name = "UploadValidationError";
    callback(error);
  },
});

function getPublicPlaylistUrl(
  req: Request,
  videoId: string,
): string {
  const configuredApiUrl = process.env.PUBLIC_API_URL?.replace(/\/+$/, "");
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0].trim();
  const requestHost = forwardedHost || req.get("host");
  const apiUrl =
    configuredApiUrl ?? `${req.protocol}://${requestHost}/api`;
  return `${apiUrl}/output/${videoId}/playlist.m3u8`;
}

async function transcodeUploadedVideo(
  req: Request,
  res: Response,
): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({
      error: "Aucun fichier vidéo reçu. Envoyez le fichier dans le champ « video ».",
    });
    return;
  }

  const parsed = UploadVideoBody.safeParse({
    ...req.body,
    video: new Blob(),
  });
  if (!parsed.success) {
    await unlink(file.path).catch(() => undefined);
    req.log.warn({ errors: parsed.error.message }, "Métadonnées vidéo invalides");
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.title.trim().length === 0) {
    await unlink(file.path).catch(() => undefined);
    res.status(400).json({ error: "Le titre ne peut pas être vide." });
    return;
  }

  const userId = getAuthenticatedUserId(res);
  const [channel] = await db
    .select()
    .from(channelsTable)
    .where(
      and(
        eq(channelsTable.id, parsed.data.channelId),
        eq(channelsTable.ownerId, userId),
      ),
    )
    .limit(1);
  if (!channel) {
    await unlink(file.path).catch(() => undefined);
    res.status(403).json({ error: "La chaîne n’existe pas ou ne vous appartient pas." });
    return;
  }

  const videoId = path.basename(file.filename, ".upload");
  const videoOutputDir = path.join(OUTPUT_DIR, videoId);
  const playlistPath = path.join(videoOutputDir, "playlist.m3u8");
  const segmentPattern = path.join(videoOutputDir, "segment_%05d.ts");
  let videoRecordCreated = false;

  req.log.info(
    {
      videoId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    },
    "Réception de la vidéo terminée",
  );

  try {
    await ensureProfile(userId);
    let durationSeconds: number | null = null;
    try {
      const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
        ffmpeg.ffprobe(file.path, (error, data) => {
          if (error) reject(error);
          else resolve(data);
        });
      });
      const duration = metadata.format.duration;
      if (typeof duration === "number" && Number.isFinite(duration)) {
        durationSeconds = Math.max(0, Math.round(duration));
      }
    } catch (probeError) {
      req.log.warn(
        { err: probeError, videoId },
        "Impossible de lire la durée avant l’encodage",
      );
    }

    await db.insert(videosTable).values({
      id: videoId,
      channelId: channel.id,
      title: parsed.data.title.trim(),
      description: parsed.data.description ?? "",
      category: parsed.data.category?.trim() || "Autre",
      visibility: parsed.data.visibility ?? "public",
      status: "processing",
      durationSeconds,
    });
    videoRecordCreated = true;
    req.log.info(
      { videoId, channelId: channel.id, ownerId: userId },
      "Fiche vidéo créée, conversion en attente",
    );

    await mkdir(videoOutputDir, { recursive: true });
    req.log.info({ videoId }, "Début de la conversion HLS");

    await new Promise<void>((resolve, reject) => {
      let lastLoggedProgress = -10;

      ffmpeg(file.path)
        .videoCodec("libx264")
        .audioCodec("aac")
        .videoFilters("scale=trunc(iw/2)*2:trunc(ih/2)*2")
        .outputOptions([
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-b:a",
          "128k",
          "-force_key_frames",
          "expr:gte(t,n_forced*10)",
          "-hls_time",
          "10",
          "-hls_playlist_type",
          "vod",
          "-hls_flags",
          "independent_segments",
          "-hls_segment_filename",
          segmentPattern,
        ])
        .format("hls")
        .on("start", () => {
          req.log.info({ videoId }, "FFmpeg a démarré l’encodage HLS");
        })
        .on("progress", (progress) => {
          if (typeof progress.percent === "number") {
            const progressStep = Math.floor(progress.percent / 10) * 10;
            if (progressStep > lastLoggedProgress) {
              lastLoggedProgress = progressStep;
              req.log.info(
                { videoId, percent: Math.min(progressStep, 100) },
                "Progression de l’encodage",
              );
            }
          }
        })
        .on("end", () => {
          req.log.info({ videoId, percent: 100 }, "Progression de l’encodage");
          resolve();
        })
        .on("error", reject)
        .save(playlistPath);
    });

    await access(playlistPath);
    try {
      await unlink(file.path);
      req.log.info({ videoId }, "Fichier vidéo original supprimé");
    } catch (cleanupError) {
      req.log.error(
        { err: cleanupError, videoId },
        "L’encodage est terminé, mais la suppression du fichier original a échoué",
      );
    }

    const playlistUrl = getPublicPlaylistUrl(req, videoId);
    const [readyVideo] = await db
      .update(videosTable)
      .set({
        status: "ready",
        playlistUrl,
        durationSeconds,
        updatedAt: new Date(),
      })
      .where(eq(videosTable.id, videoId))
      .returning();
    req.log.info(
      { videoId, playlistUrl },
      "Encodage HLS terminé et fiche vidéo publiée",
    );
    const summary = await getVideoSummary(readyVideo.id);
    res.status(201).json(UploadVideoResponse.parse(summary));
  } catch (error) {
    req.log.error({ err: error, videoId }, "Échec de l’encodage HLS");
    if (videoRecordCreated) {
      await db
        .update(videosTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(videosTable.id, videoId))
        .catch((databaseError: unknown) => {
          logger.error(
            { err: databaseError, videoId },
            "Impossible de marquer la vidéo comme échouée",
          );
        });
    }
    await Promise.all([
      unlink(file.path).catch(() => undefined),
      rm(videoOutputDir, { recursive: true, force: true }).catch((cleanupError) =>
        logger.error(
          { err: cleanupError, videoId },
          "Impossible de supprimer les fichiers HLS incomplets",
        ),
      ),
    ]);
    res.status(500).json({
      error: "La conversion HLS a échoué.",
      videoId,
    });
  }
}

router.post("/upload", requireAuth, (req, res, next) => {
  upload.single("video")(req, res, (error: unknown) => {
    if (error) {
      next(error);
      return;
    }

    void transcodeUploadedVideo(req, res).catch(next);
  });
});

export default router;
