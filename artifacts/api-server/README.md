# Afritube Backend

Node.js/Express API for Afritube. It stores profiles, channels, video metadata,
comments, likes, subscriptions and unique views in PostgreSQL. FFmpeg converts
uploaded videos to HLS; public and unlisted playlists are served from
`/api/output`.

## Run locally

From the repository root:

```sh
pnpm --filter @workspace/api-server run dev
```

The Replit environment installs FFmpeg through Nix. For another machine, install
FFmpeg and make the `ffmpeg` executable available on `PATH` before starting the
server.

## Authentication

Clerk manages account authentication. The first authenticated `GET /api/me`
creates a local Afritube profile linked to the Clerk user ID. Protected routes
require a valid Clerk session. For requests from the separate Vercel origin,
send the Clerk session token in the `Authorization: Bearer …` header; do not
place the Clerk secret key in the frontend or repository.

`FRONTEND_ORIGINS` must contain the exact Vercel origin:
`https://afri-tube.vercel.app`. CORS credentials and authorization headers are
enabled for that origin.

## Upload a video

Create a channel first with `POST /api/channels`, then send a
`multipart/form-data` request to `POST /api/upload`. The file field is `video`;
the other fields are `channelId`, `title`, and optional `description`,
`category`, and `visibility` (`public`, `unlisted`, or `private`).

```sh
curl -X POST "$AFRITUBE_API/api/upload" \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" \
  -F "video=@./sample.mp4" \
  -F "channelId=$CHANNEL_ID" \
  -F "title=My video" \
  -F "description=Video description" \
  -F "category=Musique" \
  -F "visibility=public"
```

The `201` response is the saved video record and includes its `id` and public
`playlistUrl`. HLS segments are 10 seconds long. The raw upload is deleted after
successful transcoding. Private video assets require the owner’s authenticated
session; public and unlisted assets can be read by the player.

## API overview

All routes use the `/api` prefix.

- Health: `GET /api/healthz`
- Account: `GET/PATCH /api/me`, `GET /api/me/channels`,
  `GET /api/me/subscriptions`, `GET /api/me/videos`
- Channels: create with `POST /api/channels`; read by ID or handle; update with
  `PATCH /api/channels/:channelId`
- Discovery: `GET /api/videos?q=...&category=...&sort=recent|popular&page=1&pageSize=20`,
  `GET /api/categories`, and channel video listings
- Video management: `GET/PATCH/DELETE /api/videos/:videoId`
- Engagement: comments, likes, views and channel subscriptions under their
  corresponding `/api/videos/:videoId/...` and
  `/api/channels/:channelId/subscription` routes
- HLS playback: `GET /api/output/:videoId/playlist.m3u8`

Views count once per authenticated account per video. Comments and interactions
are tied to the verified Clerk account, not a client-supplied user ID.

## Environment variables

- `FRONTEND_ORIGINS`: comma-separated list of allowed frontend origins, for
  example `https://afri-tube.vercel.app`. In development, all origins are
  allowed when this variable is unset; production must use explicit origins.
- `DATABASE_URL`: PostgreSQL connection supplied to the API and schema tools.
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`: managed by Replit Clerk setup;
  never commit or expose the secret key.
- `PUBLIC_API_URL`: optional public API base URL including `/api`, used to build
  absolute playlist URLs when forwarded request headers are not sufficient.
- `MAX_UPLOAD_SIZE_MB`: maximum upload size in megabytes; defaults to `1024`.

## Database and storage notes

The Drizzle schema is in `lib/db/src/schema`; the API contract is
`lib/api-spec/openapi.yaml`. After schema changes, apply them to the development
database with `pnpm --filter @workspace/db run push`. Replit’s Publish flow
handles the production database schema diff.

Uploads and HLS segments are currently stored on the local filesystem in
`uploads/` and `output/`; both directories are ignored by Git. This is suitable
for an MVP, but media needs persistent object storage before relying on it across
Replit restarts or production redeploys.
