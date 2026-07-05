#!/usr/bin/env bash
# Включает ежедневный бэкап (03:40) и еженедельную очистку диска (вс, 04:30),
# затем делает пробный бэкап. Повторный запуск безопасен (без дублей).
set -euo pipefail
cd "$(dirname "$0")"
chmod +x backup.sh

TMP="$(mktemp)"
# Читаем текущее расписание; на пустом кроне команда «падает» — это нормально.
{ crontab -l 2>/dev/null || true; } | grep -v -e 'backup.sh' -e 'docker image prune' > "$TMP" || true
echo "40 3 * * * cd $(pwd) && bash backup.sh > /dev/null 2>&1" >> "$TMP"
echo "30 4 * * 0 docker image prune -f > /dev/null 2>&1 && docker builder prune -f --keep-storage 1GB > /dev/null 2>&1" >> "$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "Расписание установлено:"
crontab -l
echo
echo "Делаю пробный бэкап прямо сейчас..."
bash backup.sh
echo "Проверьте Telegram: бот должен был прислать файл."
