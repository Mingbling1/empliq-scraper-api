# ─────────────────────────────────────────────────────
# Empliq Scraper API - Production Dockerfile
# Imagen ARM64 compatible (Oracle Cloud Always Free)
# 100% HTTP puro — sin browser engines — build ultra rápido
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

# Sólo deps mínimas del SO (ca-certificates para HTTPS, dumb-init para signals)
RUN apt-get update && apt-get install -y --no-install-recommends \
  wget ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Usuario no-root para seguridad
RUN groupadd -r scraper && useradd -r -g scraper -m scraper

WORKDIR /app

# Instalar solo deps de producción
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copiar build compilado
COPY --from=builder /app/dist ./dist

# Permisos
RUN chown -R scraper:scraper /app

USER scraper

EXPOSE 3457

# Healthcheck para Docker y Traefik
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3457/search/health || exit 1

# dumb-init evita problemas con señales y procesos zombie
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
