#!/bin/bash
# health-monitor.sh — Chequeo periódico del backend de prod (#295 / DEP-05).
#
# Pega al endpoint de salud local. Si NO responde 200, registra la caída con timestamp en un log
# de alertas. systemd ya reintenta el servicio (Restart=on-failure), así que este monitor NO
# reinicia: solo deja el rastro para que un checker externo / operador lo vea.
#
# Instalación (cron cada 5 min en el server):
#   */5 * * * *  /www/wwwroot/hotel.zx89.site/solmios/backend/scripts/health-monitor.sh
#
# Para una alerta ACTIVA (email/Slack/Telegram) hace falta un canal configurado — apuntar un
# servicio externo (UptimeRobot, Better Uptime) al /api/health público es lo más simple y no
# necesita credenciales acá. Este script cubre el registro local de caídas.

set -uo pipefail

HEALTH_URL="${SOLMIOS_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
ALERT_LOG="${SOLMIOS_HEALTH_LOG:-/var/log/solmios-health.log}"

CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null || echo 000)"

if [ "$CODE" != "200" ]; then
  echo "[$(date '+%F %T')] DOWN — health devolvió HTTP $CODE ($HEALTH_URL)" >> "$ALERT_LOG"
  exit 1
fi
# En verde no se escribe nada, para no llenar el log. El silencio ES la señal de OK.
exit 0
