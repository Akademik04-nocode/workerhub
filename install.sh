#!/usr/bin/env bash
#
# WorkerHub — установка на чистый сервер Ubuntu одной командой.
#
# Что делает скрипт:
#   1) ставит Docker и всё необходимое;
#   2) настраивает файрвол (открыты только SSH и веб);
#   3) задаёт три вопроса: домен, токен бота, ваш Telegram ID;
#   4) сам генерирует пароли, пишет настройки и запускает приложение
#      с автоматическим HTTPS-сертификатом.
#
# Запуск (из папки проекта): sudo bash install.sh
# Повторный запуск безопасен: настройки можно пересоздать или оставить.

set -euo pipefail

# ---------- оформление ----------
B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
say()  { echo "${B}${G}==>${N} ${B}$*${N}"; }
warn() { echo "${B}${Y}!!${N}  $*"; }
die()  { echo "${B}${R}Ошибка:${N} $*" >&2; exit 1; }

# ---------- проверки окружения ----------
[ "$(id -u)" -eq 0 ] || die "запустите от root: sudo bash install.sh"

cd "$(cd "$(dirname "$0")" && pwd)"
[ -f docker-compose.yml ] && [ -f Caddyfile ] \
  || die "запустите скрипт из папки проекта worker-hub (рядом с docker-compose.yml)"

if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) : ;;
    *) warn "Скрипт рассчитан на Ubuntu/Debian, у вас: ${PRETTY_NAME:-неизвестно}. Продолжаю, но без гарантий." ;;
  esac
fi

echo
echo "${B}Установка WorkerHub${N}"
echo "Нужно ответить на три вопроса. Подготовьте:"
echo "  • домен, направленный на этот сервер (A-запись на его IP);"
echo "  • токен бота от @BotFather (/newbot);"
echo "  • ваш Telegram ID (узнать: напишите боту @userinfobot)."
echo

# ---------- вопросы ----------
ask() { # ask "вопрос" regex "подсказка при ошибке"
  local q="$1" re="$2" hint="$3" v
  while true; do
    read -r -p "${B}${q}${N} " v
    v="$(echo "$v" | tr -d '[:space:]')"
    if [[ "$v" =~ $re ]]; then echo "$v"; return; fi
    warn "$hint"
  done
}

DOMAIN=$(ask "Домен (без https://), например workerhub-spb.ru:" \
  '^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$' \
  "Введите только домен, без https:// и без слэшей, например: workerhub-spb.ru")
DOMAIN="${DOMAIN,,}"

BOT_TOKEN=$(ask "Токен бота от @BotFather:" \
  '^[0-9]{5,}:[A-Za-z0-9_-]{30,}$' \
  "Токен выглядит как 1234567890:AAE...— скопируйте его целиком из @BotFather")

ADMIN_ID=$(ask "Ваш Telegram ID (только цифры):" \
  '^[0-9]{5,15}$' \
  "Это число. Узнать: напишите @userinfobot в Telegram, он ответит вашим ID")

echo
echo "${B}Проверьте:${N}"
echo "  Домен:        https://${DOMAIN}"
echo "  Токен бота:   ${BOT_TOKEN:0:12}… (скрыт)"
echo "  Админ ID:     ${ADMIN_ID}"
read -r -p "Всё верно? [y/N] " OK
[[ "${OK,,}" == "y" || "${OK,,}" == "yes" || "${OK,,}" == "д" || "${OK,,}" == "да" ]] || die "установка отменена, запустите скрипт заново"

# ---------- пакеты и Docker ----------
say "Устанавливаю базовые пакеты…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git openssl ca-certificates dnsutils >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  say "Устанавливаю Docker (2–3 минуты)…"
  curl -fsSL https://get.docker.com | sh >/dev/null
else
  say "Docker уже установлен — пропускаю."
fi
docker compose version >/dev/null 2>&1 || die "docker compose недоступен — перезайдите на сервер и запустите скрипт снова"

# ---------- swap (страховка для маленьких серверов при сборке) ----------
if [ "$(free -m | awk '/Swap/{print $2}')" -eq 0 ]; then
  say "Добавляю 1 ГБ подкачки (нужна при первой сборке на серверах с 2 ГБ памяти)…"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- файрвол ----------
if command -v ufw >/dev/null 2>&1; then
  say "Настраиваю файрвол (открыты только SSH, HTTP, HTTPS)…"
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# ---------- проверка DNS ----------
say "Проверяю, что домен указывает на этот сервер…"
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
DOMAIN_IP="$(dig +short A "$DOMAIN" @1.1.1.1 | head -1 || true)"
if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" = "$DOMAIN_IP" ]; then
  echo "    Отлично: ${DOMAIN} → ${SERVER_IP}"
else
  warn "Домен ${DOMAIN} сейчас указывает на «${DOMAIN_IP:-ничего}», а IP сервера — ${SERVER_IP:-неизвестен}."
  warn "Если вы только что создали A-запись, она может обновляться до часа."
  warn "Без правильной записи HTTPS-сертификат не выпустится и сайт не откроется."
  read -r -p "Продолжить всё равно? [y/N] " GO
  [[ "${GO,,}" == "y" || "${GO,,}" == "да" || "${GO,,}" == "д" ]] || die "поправьте DNS и запустите скрипт снова — все ответы придётся ввести один раз заново, это быстро"
fi

# ---------- .env ----------
if [ -f .env ]; then
  warn "Файл настроек .env уже существует."
  read -r -p "Пересоздать с новыми ответами? Пароль базы данных сохранится. [y/N] " RE
  if [[ "${RE,,}" != "y" && "${RE,,}" != "да" && "${RE,,}" != "д" ]]; then
    say "Оставляю текущий .env без изменений."
    SKIP_ENV=1
  fi
fi

if [ -z "${SKIP_ENV:-}" ]; then
  # пароль БД: берём прежний (чтобы не потерять данные) или генерируем новый
  if [ -f .env ] && grep -q '^POSTGRES_PASSWORD=..*' .env; then
    DB_PASS="$(grep '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2-)"
    say "Использую прежний пароль базы данных (данные сохранятся)."
  else
    DB_PASS="$(openssl rand -hex 24)"
  fi

  say "Записываю настройки в .env…"
  cat > .env << ENVEOF
# Сгенерировано install.sh $(date '+%Y-%m-%d %H:%M'). Токен и пароль никому не показывайте.
DOMAIN=${DOMAIN}

# Telegram
BOT_TOKEN=${BOT_TOKEN}
WEBAPP_URL=https://${DOMAIN}

# База данных
POSTGRES_USER=postgres
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=workerhub

# Backend
CORS_ORIGIN=https://${DOMAIN}
INIT_DATA_TTL=86400
ADMIN_TELEGRAM_IDS=${ADMIN_ID}
TZ=Europe/Moscow

# Frontend
VITE_API_URL=https://${DOMAIN}
ENVEOF
  chmod 600 .env
fi

# ---------- запуск ----------
say "Собираю и запускаю приложение (первый раз — 5–10 минут, это нормально)…"
docker compose up -d --build

# Очистка промежуточных слоёв сборки — критично для дисков на 10 ГБ.
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --keep-storage 1GB >/dev/null 2>&1 || true

# Ежедневный бэкап базы с отправкой в Telegram (03:40).
chmod +x backup.sh 2>/dev/null || true
BACKUP_CRON="40 3 * * * cd $(pwd) && bash backup.sh > /dev/null 2>&1"
( crontab -l 2>/dev/null | grep -v 'backup.sh' ; echo "$BACKUP_CRON" ) | crontab -

# Еженедельная автоочистка старых образов (воскресенье, 04:30).
CRON_LINE='30 4 * * 0 docker image prune -f > /dev/null 2>&1 && docker builder prune -f --keep-storage 1GB > /dev/null 2>&1'
( crontab -l 2>/dev/null | grep -v 'docker image prune' ; echo "$CRON_LINE" ) | crontab -

# ---------- проверка здоровья ----------
say "Жду, пока приложение поднимется и получит HTTPS-сертификат…"
OKAY=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://${DOMAIN}/health" 2>/dev/null | grep -q '"ok"'; then
    OKAY=1; break
  fi
  sleep 5
done

echo
if [ -n "$OKAY" ]; then
  echo "${B}${G}Готово! Приложение работает: https://${DOMAIN}${N}"
  echo
  echo "${B}Остался один шаг — привязать кнопку в Telegram:${N}"
  echo "  1. Откройте @BotFather → /mybots → выберите бота."
  echo "  2. Bot Settings → Menu Button → Configure menu button."
  echo "  3. Пришлите адрес: https://${DOMAIN}"
  echo
  echo "После этого напишите своему боту /start — появится кнопка «Открыть WorkerHub»."
  echo "Вы (ID ${ADMIN_ID}) автоматически станете администратором при первом входе."
  echo
  echo "Полезные команды (выполнять в папке $(pwd)):"
  echo "  docker compose logs --tail=50    — что происходит внутри (при проблемах пришлите вывод)"
  echo "  docker compose restart           — перезапустить"
  echo "  git pull && docker compose up -d --build   — обновить до свежей версии"
  echo "  df -h /                          — сколько осталось места на диске"
else
  warn "Приложение запускается, но https://${DOMAIN}/health пока не отвечает."
  warn "Частая причина — DNS ещё не обновился (до часа). Подождите и откройте адрес в браузере."
  warn "Диагностика: docker compose logs --tail=100"
  warn "Скопируйте вывод этой команды, если нужна помощь."
fi
