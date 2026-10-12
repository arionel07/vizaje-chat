# Деплой на VPS (Docker Compose)

> Весь функционал сейчас в ветке `claude/elegant-pascal-i21xym` (PR #1,
> не смёржен в `main`) — клонировать и обновлять нужно именно её, пока PR
> не смёржен.

Схема: `chat.<домен>` — API + статика виджета (widget.js, /public/*) + WebSocket.
`admin.<домен>` — админка (SPA). Оба за Cloudflare (proxied), TLS до origin —
через Cloudflare Origin Certificate.

## 1. Docker

```
curl -fsSL https://get.docker.com | sh
```

## 2. Код на сервере

Репозиторий публичный — клонируем по HTTPS, без ключей:

```
git clone -b claude/elegant-pascal-i21xym https://github.com/arionel07/vizaje-chat.git /opt/vizaje-chat
cd /opt/vizaje-chat
```

## 3. Cloudflare Origin Certificate

Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate.
Hostnames: `chat.vizaje-nica.com`, `admin.vizaje-nica.com` (или `*.vizaje-nica.com`).
Format: PEM. Сохранить оба файла на сервере:

```
mkdir -p deploy/certs
nano deploy/certs/cloudflare-origin.pem      # вставить Origin Certificate
nano deploy/certs/cloudflare-origin-key.pem  # вставить Private Key
```

В Cloudflare: SSL/TLS → Overview → режим **Full (strict)**.

## 4. .env

```
cp deploy/.env.example .env
openssl rand -hex 32   # вставить как JWT_SECRET
openssl rand -hex 24   # вставить как DB_PASSWORD
nano .env
```

## 5. Запуск

```
docker compose up -d --build
docker compose logs -f api   # проверить, что поднялся
```

## 6. Схема БД и первый админ (один раз)

`drizzle-kit` — devDependency, в прод-образе `api` его нет (`bun install
--production`), поэтому `bunx drizzle-kit push` внутри контейнера не
сработает («Cannot find package 'drizzle-kit'»). Применить схему проще всего
с машины, где есть исходники и установлен Bun (или временно
`bun install` локально в `vizaje-chat-api`), указав `DATABASE_URL` на
опубликованный наружу порт `db` — либо накатить нужные `ALTER TABLE`
вручную через `docker compose exec db psql -U vizaje -d vizaje_chat -c "..."`:

```
docker compose exec api bun run src/scripts/create-admin.ts admin@vizaje-nica.com '<пароль>'
```

## 7. Проверка

```
curl https://chat.vizaje-nica.com/health
```

Открыть `https://admin.vizaje-nica.com` в браузере.

## 8. Telegram-бот (необязательно)

Токен от @BotFather — в `.env` как `TELEGRAM_BOT_TOKEN`. Секрет для вебхука —
любая случайная строка (`openssl rand -hex 24`), тоже в `.env` как
`TELEGRAM_WEBHOOK_SECRET`. После `docker compose up -d --build api`
зарегистрировать вебхук (один раз, с машины, где есть токен — можно прямо
на сервере):

```
curl -X POST "https://api.telegram.org/bot<ТОКЕН>/setWebhook" \
  -d "url=https://chat.vizaje-nica.com/telegram/webhook" \
  -d "secret_token=<ТОТ ЖЕ TELEGRAM_WEBHOOK_SECRET>"
```

Проверка: `curl "https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo"` —
`url` должен совпадать, `last_error_message` — пустой. Написать боту в
Telegram — сообщение должно появиться в админке с пометкой Telegram;
ответ оператора из админки должен прийти в тот же чат.

## 9. Загруженные в чат картинки

Хранятся на диске контейнера `api` в `/app/uploads`, смонтированном как
именованный том `uploads_data` (см. `docker-compose.yml`) — переживают
`docker compose up -d --build`, пересоздавать не нужно. Старше
`ATTACHMENT_RETENTION_DAYS` (по умолчанию 3 дня) бот удаляет сам, раз в сутки.

## Обновление после новых коммитов

```
cd /opt/vizaje-chat
git pull
docker compose up -d --build
```
