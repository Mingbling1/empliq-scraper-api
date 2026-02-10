# ─────────────────────────────────────────────────────
# Empliq Scraper API - Production Dockerfile
# Imagen ARM64 compatible (Oracle Cloud Always Free)
# ─────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────
# Producción
# ─────────────────────────────────────────────────────
FROM node:20-slim

# Dependencias del SO para Playwright (Firefox) y Puppeteer (Chrome)
RUN apt-get update && apt-get install -y --no-install-recommends \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
  libx11-xcb1 fonts-noto-core wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Instalar browsers
RUN npx playwright install firefox --with-deps 2>/dev/null || true
RUN npx puppeteer browsers install chrome 2>/dev/null || true

# Copiar build del builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 3457

# Healthcheck para Docker y Traefik
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3457/search/health || exit 1

CMD ["node", "dist/main.js"]
