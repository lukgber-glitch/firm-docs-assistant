# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
RUN npm install -g pnpm@10.32.1
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Bake the embedding model into the image: the runtime container is read-only and has no need for network.
RUN MODEL_CACHE_DIR=/app/models pnpm fetch-model
RUN pnpm build && pnpm prune --prod

FROM base AS run
ARG GIT_SHA=dev
ENV NODE_ENV=production GIT_SHA=${GIT_SHA} MODEL_CACHE_DIR=/app/models NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/models ./models
COPY --from=build --chown=node:node /app/package.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/corpus ./corpus
COPY --from=build --chown=node:node /app/tsconfig.json ./
USER node
EXPOSE 3140
CMD ["node_modules/.bin/next", "start", "-p", "3140", "-H", "0.0.0.0"]
