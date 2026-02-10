#!/bin/bash
set -e

echo "🚀 Deploying Empliq Scraper API..."

APP_DIR="/opt/empliq-scraper"
CONTAINER_NAME="empliq-scraper"
IMAGE_NAME="empliq-scraper:latest"
NETWORK="chatwoot-network"
PORT=3457

# ─── Recibir API_KEY como argumento ───
API_KEY="${SCRAPER_API_KEY}"
if [ -z "$API_KEY" ]; then
    echo "❌ ERROR: SCRAPER_API_KEY no proporcionada"
    exit 1
fi

# ─── Helpers ───
container_running() {
    sudo docker ps --filter "name=^/$1$" --format '{{.Names}}' | grep -q "^$1$"
}

remove_container_if_exists() {
    if sudo docker ps -a --filter "name=^/$1$" --format '{{.Names}}' | grep -q "^$1$"; then
        echo "  🗑️  Removiendo contenedor existente: $1"
        sudo docker stop $1 2>/dev/null || true
        sudo docker rm $1 2>/dev/null || true
    fi
}

# ─── Asegurar que la red existe ───
echo "🔧 Verificando red Docker..."
sudo docker network create --driver bridge ${NETWORK} 2>/dev/null || echo "  Red ${NETWORK} ya existe"

# ─── Clonar o actualizar repo ───
echo "📥 Actualizando código fuente..."
sudo mkdir -p ${APP_DIR}

if [ -d "${APP_DIR}/.git" ]; then
    cd ${APP_DIR}
    sudo git fetch origin main
    sudo git reset --hard origin/main
else
    sudo rm -rf ${APP_DIR}
    sudo git clone https://github.com/Mingbling1/empliq-scraper-api.git ${APP_DIR}
    cd ${APP_DIR}
fi

# ─── Build Docker image ───
echo "🔨 Construyendo imagen Docker..."
sudo docker build -t ${IMAGE_NAME} .

# ─── Stop y remove contenedor viejo ───
remove_container_if_exists ${CONTAINER_NAME}

# ─── Iniciar nuevo contenedor con Traefik labels ───
echo "🚀 Iniciando ${CONTAINER_NAME}..."
sudo docker run -d \
  --name ${CONTAINER_NAME} \
  --restart unless-stopped \
  --network ${NETWORK} \
  -e SCRAPER_PORT=${PORT} \
  -e API_KEY="${API_KEY}" \
  -e NODE_ENV=production \
  -l "traefik.enable=true" \
  -l "traefik.http.routers.scraper-secure.entrypoints=https" \
  -l "traefik.http.routers.scraper-secure.rule=Host(\`scraper.musuq.me\`)" \
  -l "traefik.http.routers.scraper-secure.tls=true" \
  -l "traefik.http.routers.scraper-secure.tls.certresolver=cloudflare" \
  -l "traefik.http.routers.scraper-secure.service=scraper" \
  -l "traefik.http.services.scraper.loadbalancer.server.port=${PORT}" \
  ${IMAGE_NAME}

# ─── Esperar y verificar ───
echo "⏳ Esperando que inicie..."
sleep 15

if container_running ${CONTAINER_NAME}; then
    echo "✅ ${CONTAINER_NAME} está corriendo"

    # Verificar healthcheck
    HEALTH=$(sudo docker exec ${CONTAINER_NAME} wget -qO- http://localhost:${PORT}/search/health 2>/dev/null || echo "waiting")
    echo "  📊 Health: ${HEALTH}"
else
    echo "❌ ${CONTAINER_NAME} NO está corriendo"
    echo "  📋 Logs:"
    sudo docker logs ${CONTAINER_NAME} --tail 30
    exit 1
fi

echo ""
echo "✅ ¡Deploy completado!"
echo ""
echo "🌐 Endpoints disponibles:"
echo "   - API:     https://scraper.musuq.me/search?q=INTERBANK"
echo "   - Health:  https://scraper.musuq.me/search/health"
echo "   - Swagger: https://scraper.musuq.me/docs"
echo "   - Interno (n8n): http://${CONTAINER_NAME}:${PORT}/search?q=EMPRESA"
echo ""
echo "🔐 Header requerido: x-api-key: <tu-api-key>"
