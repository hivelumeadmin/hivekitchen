# syntax=docker/dockerfile:1.7
# Multi-stage Docker build for @hivekitchen/api.
# Build context: workspace root (docker build -f apps/api/Dockerfile -t hivekitchen-api:local .)

ARG NODE_VERSION=22
ARG PNPM_VERSION=9.15.0

# ---------- builder ----------
FROM node:${NODE_VERSION}-alpine AS builder
ARG PNPM_VERSION
WORKDIR /repo

# Pin pnpm via Corepack to match root package.json packageManager field.
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy workspace manifest + lockfile first so pnpm install is cached by layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .npmrc ./

# Copy every workspace package manifest so pnpm can resolve the full graph
# without needing the source files yet.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/marketing/package.json apps/marketing/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/tsconfig/base.json packages/tsconfig/node.json \
     packages/tsconfig/react.json packages/tsconfig/astro.json \
     packages/tsconfig/
COPY packages/ui/package.json packages/ui/package.json

# Install every workspace's deps (incl. devDeps; required for the build step).
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy sources needed to build the API.
# apps/web and apps/marketing are intentionally NOT copied — this Dockerfile is API-only.
COPY packages/contracts/ packages/contracts/
COPY packages/types/ packages/types/
COPY apps/api/ apps/api/

# Compile the API (tsc -> apps/api/dist).
RUN pnpm --filter @hivekitchen/api build

# Produce a flattened, prod-only bundle at /out via pnpm deploy.
RUN pnpm --filter @hivekitchen/api --prod deploy /out

# ---------- runner ----------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Run as non-root.
RUN addgroup -S hk && adduser -S hk -G hk
USER hk

COPY --from=builder --chown=hk:hk /out /app

EXPOSE 3001
CMD ["node", "dist/server.js"]
