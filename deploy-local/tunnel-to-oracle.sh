#!/usr/bin/env bash
# ─────────────────────────────────────────────────────
# Túnel SSH reverso: Oracle Cloud ← tu PC local
#
# Expone el scraper local (puerto 3458) en Oracle Cloud
# para que n8n (Docker) lo consuma vía http://172.18.0.1:3458
#
# n8n (Oracle Docker) → 172.18.0.1:3458 (gateway) → host:3458 → túnel → tu PC:3458 → scraper:3457
#
# Uso:
#   ./deploy-local/tunnel-to-oracle.sh          # foreground (ver logs)
#   ./deploy-local/tunnel-to-oracle.sh --bg     # background (daemon)
#   ./deploy-local/tunnel-to-oracle.sh --stop   # matar túnel background
# ─────────────────────────────────────────────────────

set -euo pipefail

# ── Config ───────────────────────────────────────────
ORACLE_HOST="163.176.250.185"
ORACLE_USER="ubuntu"
SSH_KEY="$HOME/.ssh/oracle_instance_key"
REMOTE_PORT=3458          # Puerto en Oracle (0.0.0.0:3458)
LOCAL_PORT=3458           # Puerto local donde Docker expone el scraper
PIDFILE="/tmp/empliq-tunnel.pid"

# ── Colores ──────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[TUNNEL]${NC} $*"; }
warn() { echo -e "${YELLOW}[TUNNEL]${NC} $*"; }
err()  { echo -e "${RED}[TUNNEL]${NC} $*" >&2; }

# ── Funciones ────────────────────────────────────────
check_local_scraper() {
    if curl -sf "http://localhost:${LOCAL_PORT}/search/health" > /dev/null 2>&1; then
        log "✅ Scraper local respondiendo en puerto ${LOCAL_PORT}"
        return 0
    else
        err "❌ Scraper local NO responde en puerto ${LOCAL_PORT}"
        err "   Arranca el container primero:"
        err "   docker compose -f deploy-local/docker-compose.local.yml up -d --build"
        return 1
    fi
}

start_tunnel() {
    local mode="${1:-foreground}"

    log "🔗 Creando túnel reverso: Oracle:${REMOTE_PORT} → local:${LOCAL_PORT}"
    log "   n8n puede consumir: http://172.18.0.1:${REMOTE_PORT}"

    local SSH_OPTS=(
        -i "$SSH_KEY"
        -o "StrictHostKeyChecking=no"
        -o "ServerAliveInterval=30"
        -o "ServerAliveCountMax=3"
        -o "ExitOnForwardFailure=yes"
        -R "0.0.0.0:${REMOTE_PORT}:localhost:${LOCAL_PORT}"
        -N                               # Sin shell remoto
        "${ORACLE_USER}@${ORACLE_HOST}"
    )

    if [[ "$mode" == "background" ]]; then
        ssh "${SSH_OPTS[@]}" &
        local PID=$!
        echo "$PID" > "$PIDFILE"
        sleep 2
        if kill -0 "$PID" 2>/dev/null; then
            log "✅ Túnel corriendo en background (PID: $PID)"
            log "   Para detener: $0 --stop"
        else
            err "❌ Túnel falló al iniciar"
            rm -f "$PIDFILE"
            return 1
        fi
    else
        log "Presiona Ctrl+C para cerrar el túnel"
        ssh "${SSH_OPTS[@]}"
    fi
}

stop_tunnel() {
    if [[ -f "$PIDFILE" ]]; then
        local PID
        PID=$(cat "$PIDFILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID"
            rm -f "$PIDFILE"
            log "✅ Túnel detenido (PID: $PID)"
        else
            warn "Proceso $PID ya no existe"
            rm -f "$PIDFILE"
        fi
    else
        warn "No hay túnel corriendo (no encontré $PIDFILE)"
        # Intentar matar cualquier túnel SSH existente
        local PIDS
        PIDS=$(pgrep -f "ssh.*${REMOTE_PORT}.*${ORACLE_HOST}" || true)
        if [[ -n "$PIDS" ]]; then
            echo "$PIDS" | xargs kill 2>/dev/null
            log "Matados procesos SSH: $PIDS"
        fi
    fi
}

# ── Main ─────────────────────────────────────────────
case "${1:-}" in
    --bg|--background)
        check_local_scraper || exit 1
        start_tunnel background
        ;;
    --stop)
        stop_tunnel
        ;;
    --status)
        if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
            log "✅ Túnel activo (PID: $(cat "$PIDFILE"))"
        else
            warn "❌ Túnel no está corriendo"
        fi
        # Test remoto
        log "Testeando desde Oracle..."
        ssh -i "$SSH_KEY" "${ORACLE_USER}@${ORACLE_HOST}" \
            "curl -sf http://localhost:${REMOTE_PORT}/search/health && echo ' ← OK' || echo 'FAIL'"
        ;;
    --help|-h)
        echo "Uso: $0 [--bg|--stop|--status|--help]"
        echo ""
        echo "  (sin args)  Inicia túnel en foreground"
        echo "  --bg        Inicia túnel en background"
        echo "  --stop      Detiene túnel background"
        echo "  --status    Verifica estado del túnel"
        ;;
    *)
        check_local_scraper || exit 1
        start_tunnel foreground
        ;;
esac
