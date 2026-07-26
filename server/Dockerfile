FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY extension/package.json extension/package.json
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY extension/package.json extension/package.json
RUN npm ci --no-audit --no-fund
COPY server ./server
RUN mkdir -p server/public
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
RUN npm run build --workspace server

FROM node:20-alpine AS runner
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=builder /app/server/.next ./.next
COPY --from=builder /app/server/public ./public
COPY --from=builder /app/server/next.config.js ./next.config.js
COPY --from=builder /app/server/package.json ./package.json
COPY --from=builder /app/server/drizzle ./drizzle
COPY --from=deps /app/node_modules /app/node_modules
EXPOSE 3000
CMD ["npm", "run", "start"]
