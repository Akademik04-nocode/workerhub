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

# ВАЖНО: статус git pull проверяем ОТДЕЛЬНО. Раньше $? брался только от
# docker compose, поэтому упавший git pull (конфликт, обрыв сети) оставался
# незамеченным: старый код успешно пересобирался, и админ получал «✅
# Обновление завершено», хотя новых изменений на сервере не было.
# --ff-only: не создаём merge-коммитов, при расхождении веток честно падаем.
STATUS=0
if ! git pull --ff-only >> deploy.log 2>&1; then
  echo "!!! git pull не удался — обновление прервано, пересборку не запускаем" >> deploy.log
  STATUS=1
# Пересобираем ВСЕ сервисы, а не только backend/frontend/bot: изменения
# Caddyfile или docker-compose.yml иначе не применялись бы.
elif ! docker compose up -d --build >> deploy.log 2>&1; then
  echo "!!! docker compose up не удался" >> deploy.log
  STATUS=1
fi

echo "=== $(date '+%F %T') завершено (код $STATUS) ===" >> deploy.log

# Сборка «прошла» ещё не значит «приложение работает»: контейнер мог упасть
# на старте (битая миграция, опечатка в .env). Прежде чем рапортовать успех,
# ждём ответа /health до 60 секунд.
if [ "$STATUS" -eq 0 ]; then
  HEALTHY=1
  for _ in $(seq 1 30); do
    if docker compose exec -T backend wget -qO- http://localhost:3000/health >/dev/null 2>&1; then
      HEALTHY=0
      break
    fi
    sleep 2
  done
  if [ "$HEALTHY" -ne 0 ]; then
    echo "!!! backend не отвечает на /health после обновления" >> deploy.log
    STATUS=1
  fi
fi

# Сообщаем администратору. BOT_TOKEN и первый ID берём из .env (значения без кавычек).
BOT_TOKEN=$(grep '^BOT_TOKEN=' .env | head -1 | cut -d= -f2-)
ADMIN=$(grep '^ADMIN_TELEGRAM_IDS=' .env | head -1 | cut -d= -f2- | cut -d, -f1)
if [ -n "$BOT_TOKEN" ] && [ -n "$ADMIN" ]; then
  if [ "$STATUS" -eq 0 ]; then
    MSG="✅ Обновление завершено, приложение отвечает."
  else
    MSG="❌ Обновление НЕ применено. Загляни в /opt/worker-hub/deploy.log на сервере."
  fi
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode chat_id="$ADMIN" \
    --data-urlencode text="$MSG" >/dev/null 2>&1
fi
