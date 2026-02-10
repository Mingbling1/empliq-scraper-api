# ─────────────────────────────────────────────────────
# Empliq Scraper API - Production Dockerfile
# Imagen ARM64 compatible (Oracle Cloud Always Free)
# ─────────────────────────────────────────────────────

# ─── Stage 1: Builder ─────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copiar manifests
COPY package.json ./
COPY package-lock.json* ./

# Instalar todas las deps (incluyendo dev para build)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copiar código fuente y compilar
COPY . .
RUN npm run build

# ─── Stage 2: Production ─────────────────────────────
FROM node:20-slim

# Deps del SO para Chromium (Puppeteer) y Firefox (Playwright)
RUN apt-get update && apt-get install -y --no-install-recommends \
  # Chromium deps
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
  libx11-xcb1 \
  # Firefox deps
  libgtk-3-0 libx11-6 libxext6 libxrender1 \
  # Fonts para renderizado correcto
  fonts-noto-core fonts-freefont-ttf \
  # Utilidades
  wget ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Usuario no-root para seguridad
RUN groupadd -r scraper && useradd -r -g scraper -m scraper

WORKDIR /app

# Instalar solo deps de producción
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Instalar browsers (con fallback si alguno falla en ARM64)
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.browsers
RUN npx playwright install firefox --with-deps 2>/dev/null || echo "⚠️ Firefox install skipped"
RUN npx puppeteer browsers install chrome 2>/dev/null || echo "⚠️ Chrome install skipped"

# Copiar build compilado
COPY --from=builder /app/dist ./dist

# Permisos
RUN chown -R scraper:scraper /app

USER scraper

EXPOSE 3457

# Healthcheck para Docker y Traefik
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3457/search/health || exit 1

# dumb-init evita problemas con señales y procesos zombie
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
