#!/bin/bash
# Одноразовая настройка команды /obnovit.
# Делает обновлятор исполняемым и ставит крон-задачу, которая раз в минуту
# проверяет флаг обновления (его ставит /obnovit в боте) и обновляет приложение.
set -e
cd /opt/worker-hub

chmod +x deploy-watcher.sh

LINE="* * * * * /usr/bin/flock -n /tmp/wh-deploy.lock /opt/worker-hub/deploy-watcher.sh"
# Убираем возможную старую строку и добавляем актуальную (без дублей).
( crontab -l 2>/dev/null | grep -v 'deploy-watcher.sh'; echo "$LINE" ) | crontab -

echo "Готово. Крон-задача установлена:"
crontab -l | grep 'deploy-watcher.sh' || true

# На всякий случай убеждаемся, что служба cron запущена.
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now cron >/dev/null 2>&1 || systemctl enable --now crond >/dev/null 2>&1 || true
fi

echo "Теперь отправьте боту команду /obnovit — обновление начнётся в течение минуты."
