#!/usr/bin/env bash
#
# Ночной бэкап базы WorkerHub: pg_dump -> gzip -> отправка админу в Telegram.
# Запускается кроном (настраивает setup-backup.sh или install.sh).
# Локально хранятся последние 14 копий в ./backups (на случай проблем с Telegram).

set -euo pipefail
cd "$(dirname "$0")"

# Подтягиваем настройки (BOT_TOKEN, ADMIN_TELEGRAM_IDS, POSTGRES_*)
set -a
. ./.env
set +a

STAMP="$(date +%Y-%m-%d_%H-%M)"
mkdir -p backups
FILE="backups/workerhub-${STAMP}.sql.gz"

# Выгрузка базы из контейнера и сжатие
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-workerhub}" | gzip > "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"

# Отправляем первому ID из ADMIN_TELEGRAM_IDS
ADMIN="${ADMIN_TELEGRAM_IDS%%,*}"
if [ -n "${BOT_TOKEN:-}" ] && [ -n "$ADMIN" ]; then
  HTTP_CODE=$(curl -s -o /tmp/tg-backup-resp.json -w "%{http_code}" \
    -F "chat_id=${ADMIN}" \
    -F "document=@${FILE}" \
    -F "caption=💾 Бэкап базы WorkerHub ${STAMP} (${SIZE}). Храните файл — из него база восстанавливается целиком." \
    "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument" || echo "000")
  if [ "$HTTP_CODE" != "200" ]; then
    echo "Отправка в Telegram не удалась (HTTP ${HTTP_CODE}); копия лежит в ${FILE}" >&2
  fi
fi

# Ротация: держим последние 14 локальных копий
ls -1t backups/*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --

echo "Бэкап готов: ${FILE} (${SIZE})"
