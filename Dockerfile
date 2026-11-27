# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=nowchatbot-pnpm-11,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
ARG NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY
ARG NEXT_PUBLIC_SUPPORT_EMAIL
RUN CHURCH_STANDALONE=1 pnpm build

FROM scratch AS transport-wheels
COPY requirements-transport.txt /

FROM node:24-bookworm-slim AS runtime-base
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CHURCH_DATA_DIR=/data

COPY requirements-transport.txt ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv .local/transport-venv \
    && install -d -o node -g node -m 0700 /data

FROM runtime-base AS runtime
RUN --mount=type=bind,from=transport-wheels,target=/wheels \
    if test -f /wheels/transport-lock.txt; then \
      grep -F "$(tr -d '\r' < requirements-transport.txt | sed -n '/^ortools==/p') --hash=sha256:" /wheels/transport-lock.txt >/dev/null || exit 1; \
      set -- --no-index --find-links=/wheels --require-hashes -r /wheels/transport-lock.txt; \
    else set -- --timeout=120 --retries=3 -r requirements-transport.txt; fi; \
    .local/transport-venv/bin/pip install --no-cache-dir --only-binary=:all: "$@"

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY scripts/transport_solver.py scripts/bootstrap-admin.mjs scripts/backup-server.mjs ./scripts/
COPY lib/server/database.ts lib/server/password.ts ./lib/server/
RUN install -d -o node -g node -m 0755 /app/.next/cache

USER node
EXPOSE 3000
CMD ["node", "server.js"]
