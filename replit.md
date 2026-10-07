# Afritube

Afritube is a backend-only video platform API for accounts, channels, video metadata, HLS uploads, discovery, and engagement.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (uses the Replit-injected port)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `FRONTEND_ORIGINS`; Clerk keys are managed by Replit

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/` — PostgreSQL/Drizzle tables
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/video-queries.ts` — shared video discovery queries
- `artifacts/api-server/README.md` — endpoints, auth, upload and storage notes

## Architecture decisions

- Clerk owns authentication; local profiles are keyed by Clerk user IDs.
- Public and unlisted HLS assets are served directly; private HLS assets are checked against their channel owner.
- A view is counted once per authenticated user and video.
- FFmpeg output is local for the MVP; persistent media storage is needed for reliable production retention.
- Development schema changes use Drizzle push; Replit Publish applies the production database diff.

## Product

The backend supports account profiles, channels, video metadata and HLS uploads, comments, likes, channel subscriptions, unique views, category listing, search, and recent/popular discovery. The production front-end origin is `https://afri-tube.vercel.app`.

## User preferences

- The requested scope is backend only; do not add a frontend to this project unless asked.

## Gotchas

- Uploads require an authenticated Clerk account and a channel owned by that account.
- Keep HLS playback URLs under `/api/output`; the asset guard enforces private video visibility.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
