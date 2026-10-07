# Video HLS API

Express API for accepting a video upload, converting it to HLS with FFmpeg, and
serving the generated playlist and MPEG-TS segments.

## Run locally

From the repository root:

```sh
pnpm --filter @workspace/api-server run dev
```

The Replit environment installs FFmpeg through Nix. For another machine, install
FFmpeg and make the `ffmpeg` executable available on `PATH` before starting the
server.

## Upload a video

Send a `multipart/form-data` request to `POST /api/upload`, using `video` as the
file field:

```sh
curl -X POST http://localhost:8080/api/upload \
  -F "video=@./sample.mp4"
```

The response includes `videoId` and `playlistUrl`. The playlist is public at
`GET /api/output/:videoId/playlist.m3u8`; its `.ts` segments are served from the
same public directory. The raw upload is deleted after successful encoding.

## Environment variables

- `FRONTEND_ORIGINS`: comma-separated list of allowed frontend origins, for
  example `https://your-app.vercel.app`. In development, all origins are
  allowed when this variable is unset; in production, configure the exact
  frontend origin(s).
- `PUBLIC_API_URL`: optional public API base URL including `/api`, used to
  construct the returned playlist URL when the proxy host should not be used.
- `MAX_UPLOAD_SIZE_MB`: maximum upload size in megabytes; defaults to `1024`.

Uploaded files and generated HLS output are stored on the local filesystem in
`uploads/` and `output/`. These directories are ignored by Git.
