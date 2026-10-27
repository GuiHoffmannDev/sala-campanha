# Build from the repository root:
#   docker build -f packages/executor/Dockerfile -t sala-executor .
# Secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) come from the host's
# environment at run time; .dockerignore keeps every .env* file out of the image.
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/executor/package.json packages/executor/package.json
RUN pnpm install --frozen-lockfile --prod --filter @sala/executor...

COPY packages/shared/src packages/shared/src
COPY packages/executor/src packages/executor/src

USER node
CMD ["node", "packages/executor/src/main.ts"]
