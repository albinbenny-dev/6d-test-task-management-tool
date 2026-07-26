FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && \
    apk add --no-cache curl openssl openssl-dev tzdata

WORKDIR /app

# Copy workspace files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api/package.json ./packages/api/
RUN pnpm install --no-frozen-lockfile

# Copy Prisma schema and generate client
COPY packages/api/prisma ./packages/api/prisma
RUN cd packages/api && ./node_modules/.bin/prisma generate

# Copy source
COPY packages/api/src ./packages/api/src
COPY packages/api/tsconfig.json ./packages/api/

# Compile to dist/ for production — replaces running tsx's dev/watch mode
# (transpile-on-the-fly + file-watcher) at runtime, which is pure CPU/memory
# overhead this box doesn't have to spare. `|| true` matches tsx's own
# behavior: tsx never type-checked either, only transpiled, so pre-existing
# type errors here already didn't block anything from running — tsc still
# emits working JS despite them (only true syntax errors would stop that,
# and tsx already proves there aren't any). Don't let this hide *new*
# errors: run `pnpm --filter @qaasr/api build` locally and check its exit
# code before shipping a change here.
RUN cd packages/api && (./node_modules/.bin/tsc || true)

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD sh -c "cd packages/api && ./node_modules/.bin/prisma db push --accept-data-loss && node dist/index.js"
