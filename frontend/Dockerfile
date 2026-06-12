FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json index.html ./
COPY src ./src
RUN pnpm build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server.mjs ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
