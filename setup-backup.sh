#!/usr/bin/env bash
# Включает ежедневный бэкап (03:40) и сразу делает пробный.
set -euo pipefail
cd "$(dirname "$0")"
chmod +x backup.sh
CRON_LINE="40 3 * * * cd $(pwd) && bash backup.sh > /dev/null 2>&1"
( crontab -l 2>/dev/null | grep -v 'backup.sh' ; echo "$CRON_LINE" ) | crontab -
echo "Расписание установлено: ежедневно в 03:40."
echo "Делаю пробный бэкап прямо сейчас..."
bash backup.sh
echo "Проверьте Telegram: бот должен был прислать файл."
