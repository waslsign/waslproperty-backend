# Wasl Property Backend

Backend services and APIs for **Wasl Property** — an independent property-management SaaS product.

## Architecture

Wasl Property is an independent application with its own backend, database and domain models.

WaslSign provides the underlying agreement, approval, signing and audit capabilities through API integration only — Wasl Property never accesses the WaslSign database directly.

## Status

🚧 Slice 1 in progress — Property Foundation (Organisation, Property, Space, PropertyContact, PropertyMembership).

## Stack

- Node.js 22, TypeScript, Express
- Prisma + PostgreSQL (own database instance)
- Zod for request validation
- Pino for structured logging with request correlation IDs
- Vitest + Supertest for tests

## Local development

```bash
corepack enable
pnpm install
cp .env.example .env   # edit DATABASE_URL etc.
docker compose up -d   # starts a local Postgres on port 5433
pnpm prisma:migrate
pnpm dev                # http://localhost:4100
```

## Scripts

- `pnpm dev` — run the API with hot reload
- `pnpm build` / `pnpm start` — production build and run
- `pnpm lint` / `pnpm format` — ESLint / Prettier
- `pnpm typecheck` — TypeScript project check
- `pnpm test` — Vitest unit/integration tests
- `pnpm prisma:migrate` — run Prisma migrations locally
