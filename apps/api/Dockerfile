# API image (PoV / local demo). Build context: repository root. No secret is baked in; configuration comes from the environment.
FROM node:24.21.0-slim
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && mkdir -p /var/data/files && chown -R node:node /app /var/data
USER node
ENV HOST=0.0.0.0
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
