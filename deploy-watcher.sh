#!/bin/bash
# Обновлятор WorkerHub.
#
# Проверяет флаг deploy_requested в Redis (его ставит команда /obnovit в боте)
# и, если он установлен, обновляет приложение из GitHub и сообщает
# администратору в Telegram о результате.
#
# Запускается кроном раз в минуту под flock, чтобы два обновления не наложились:
#   * * * * * /usr/bin/flock -n /tmp/wh-deploy.lock /opt/worker-hub/deploy-watcher.sh
#
# Бот НЕ обращается к Docker или файлам сервера напрямую — он лишь ставит флаг;
# все привилегированные действия выполняет этот скрипт на самом сервере.

cd /opt/worker-hub || exit 0

# Флаг читаем через сам контейнер Redis (порт наружу закрыт по проекту).
FLAG=$(docker compose exec -T redis redis-cli GET deploy_requested 2>/dev/null | tr -d '[:space:]')
[ "$FLAG" = "1" ] || exit 0

# Сбрасываем флаг сразу: повторный /obnovit во время сборки не запустит второй деплой.
docker compose exec -T redis redis-cli DEL deploy_requested >/dev/null 2>&1

echo "=== $(date '+%F %T') обновление запущено ===" >> deploy.log
git pull >> deploy.log 2>&1
docker compose up -d --build backend frontend bot >> deploy.log 2>&1
STATUS=$?
echo "=== $(date '+%F %T') завершено (код $STATUS) ===" >> deploy.log

# Сообщаем администратору. BOT_TOKEN и первый ID берём из .env (значения без кавычек).
BOT_TOKEN=$(grep '^BOT_TOKEN=' .env | head -1 | cut -d= -f2-)
ADMIN=$(grep '^ADMIN_TELEGRAM_IDS=' .env | head -1 | cut -d= -f2- | cut -d, -f1)
if [ -n "$BOT_TOKEN" ] && [ -n "$ADMIN" ]; then
  if [ "$STATUS" -eq 0 ]; then
    MSG="✅ Обновление завершено."
  else
    MSG="❌ Ошибка при обновлении. Загляни в /opt/worker-hub/deploy.log на сервере."
  fi
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode chat_id="$ADMIN" \
    --data-urlencode text="$MSG" >/dev/null 2>&1
fi
