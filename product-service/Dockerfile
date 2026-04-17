FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache wget

FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

FROM base AS final
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1
CMD ["node", "src/index.js"]
