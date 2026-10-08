# Web image (PoV / local demo). Build context: repository root. CETEM_QC_API_URL is read from the environment at runtime.
FROM node:24.21.0-slim
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @cetem-qc/web build && chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "exec", "next", "start", "--hostname", "0.0.0.0"]
