# WaslProperty Backend

Backend services and APIs for **WaslProperty** — an independent property & strata operations SaaS product.

## Architecture

WaslProperty is an independent application with its own backend, database and domain models.

WaslSign provides the underlying approval, signature and audit capabilities through API integration only — WaslProperty never accesses the WaslSign database directly, and the integration is optional (see `WASLSIGN_*` below).

## Stack

- Node.js 22, TypeScript, Express
- Prisma + PostgreSQL (own database instance)
- Zod for request validation
- Pino for structured logging with request correlation IDs
- Vitest + Supertest for tests

## Prerequisites

- Node.js 22+ (see `engines` in `package.json`)
- pnpm (via [Corepack](https://nodejs.org/api/corepack.html), bundled with Node.js)
- Docker (for the local PostgreSQL instance via `docker-compose.yml`) — or any local PostgreSQL 16 server if you'd rather not use Docker

## Local development

```bash
corepack enable
pnpm install
cp .env.example .env            # edit DATABASE_URL etc. if not using the default docker-compose setup
docker compose up -d            # starts local Postgres on localhost:5433
pnpm prisma:generate
pnpm prisma:migrate             # applies migrations to DATABASE_URL (non-interactive: use prisma:migrate:deploy)
pnpm db:seed                    # optional — creates a demo organisation (see prisma/seed.ts for credentials)
pnpm dev                        # http://localhost:4100
```

`.env.example` documents every environment variable, including which are optional. At minimum, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `FRONTEND_URL` (CORS origin — must match the frontend dev server, default `http://localhost:5174`) are required to start the API. The `WASLSIGN_*`, `AWS_*`/S3, and `SMTP_*` variables are optional in development — the app degrades gracefully (e.g. `WaslSignService` treats an unset `WASLSIGN_API_BASE_URL` as "unavailable," and unset `SMTP_HOST` falls back to a logged Ethereal test inbox) rather than failing to start.

For a Backoffice (internal admin) account, use `pnpm platform:create-user` (see `prisma/create-platform-user.ts`).

## Scripts

- `pnpm dev` — run the API with hot reload (http://localhost:4100)
- `pnpm build` / `pnpm start` — production build (`dist/`) and run
- `pnpm typecheck` — TypeScript project check, no emit
- `pnpm lint` / `pnpm lint:fix` — ESLint
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm test` — Vitest unit/integration tests (requires a running database — see `.env.test`)
- `pnpm test:watch` — Vitest in watch mode
- `pnpm prisma:generate` — regenerate the Prisma client after a schema change
- `pnpm prisma:migrate` — create/apply migrations interactively (local dev)
- `pnpm prisma:migrate:deploy` — apply existing migrations non-interactively (CI, or a non-interactive shell)
- `pnpm prisma:studio` — open Prisma Studio against `DATABASE_URL`
- `pnpm db:seed` — seed a demo organisation
- `pnpm platform:create-user` — create a Backoffice (platform) user

## Tests

Integration tests run against a real Postgres database configured by `.env.test` (a separate database from `.env`'s `DATABASE_URL`, so `pnpm test` never touches your dev data). Apply the same migrations to it before running tests:

```bash
DATABASE_URL="$(grep '^DATABASE_URL' .env.test | cut -d= -f2-)" pnpm prisma:migrate:deploy
pnpm test
```

## Before committing

```bash
pnpm typecheck && pnpm lint && pnpm test
```
