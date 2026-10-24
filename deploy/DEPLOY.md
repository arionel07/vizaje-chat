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

Если используете Telegram (раздел 8): `docker-compose.yml` сам прокидывает
`api`-контейнеру `PUBLIC_API_URL` = тот же `ADMIN_API_URL` из `.env` — ничего
отдельно настраивать не нужно, картинки в ответах оператора будут доходить
до Telegram-беседы как фото, не только текстом.

## 10. Уведомления в браузер админки (необязательно)

Push-уведомления о новых сообщениях — приходят даже при закрытой вкладке,
на телефоне ведут себя как у приложения (на iOS Safari — только после
«Добавить на экран Домой», это ограничение самого iOS). Нужна пара ключей
VAPID — сгенерировать один раз (`web-push` уже в обычных, не dev-, зависимостях
`api`, поэтому доступен в собранном контейнере — в отличие от `drizzle-kit`
из раздела 6):

```
docker compose run --rm api bunx web-push generate-vapid-keys
```

Публичный и приватный ключ — в `.env` как `VAPID_PUBLIC_KEY` и
`VAPID_PRIVATE_KEY`, затем `docker compose up -d --build api`. Сохранить эти
ключи навсегда: замена сбросит все текущие подписки операторов, каждому
придётся заново разрешить уведомления в браузере.

Проверка: открыть `https://admin.vizaje-nica.com`, разрешить уведомления по
запросу браузера (спрашивает один раз, как обычно) — дальше любое новое
сообщение от посетителя должно приходить уведомлением, даже если вкладка
админки не активна.

## 11. Instagram (необязательно)

Через Meta Graph API — Instagram-аккаунт должен быть Business/Creator и
связан с Facebook-страницей, с которой он получает сообщения. В Meta for
Developers создать приложение → добавить продукт Instagram → в нём раздел
Webhooks:

- **Callback URL**: `https://chat.vizaje-nica.com/instagram/webhook`
- **Verify token**: любая случайная строка (`openssl rand -hex 24`) — та же,
  что в `.env` как `INSTAGRAM_VERIFY_TOKEN`

Прежде чем жать «Verify and save» на этом экране — задеплоить код с
обработчиком вебхука (`docker compose up -d --build api`), иначе проверка
не пройдёт.

В `.env`, кроме `INSTAGRAM_VERIFY_TOKEN`:
- `INSTAGRAM_APP_SECRET` — Settings → Basic приложения, подписывает каждый
  вебхук-запрос (без него подпись не проверяется — для прода обязательно)
- `INSTAGRAM_PAGE_ACCESS_TOKEN` — токен связанной Facebook-страницы с правами
  `instagram_business_basic`, `instagram_business_manage_messages`; нужен для
  отправки ответов оператора (без него входящие всё равно примутся и
  сохранятся, просто ответить из админки не получится)

После `docker compose up -d --build api` в разделе Webhooks подписаться на
поле `messages` (galochka у `instagram_manage_messages` subscription),
**не** подписываться на `message_echoes` — иначе собственные отправленные
ответы будут приходить обратно как входящие сообщения (код и так их
игнорирует по `is_echo`, но лишняя нагрузка ни к чему).

Меню и путь к оператору — тот же, что в Telegram (язык → тема → опишите
вопрос), только на quick replies вместо inline-кнопок: они не остаются
кликабельными навсегда, Instagram сам прячет их, как только собеседник
ответил — снимать вручную, как с Telegram, не нужно.

Проверка: написать аккаунту в Direct — должно прийти меню выбора языка;
сообщение после выбора темы должно появиться в админке с пометкой Instagram;
ответ оператора — прийти в тот же Direct.

## Обновление после новых коммитов

```
cd /opt/vizaje-chat
git pull
docker compose up -d --build
```

Если менялась схема БД (`vizaje-chat-api/src/db/schema.ts` в diff) — этот
шаг её не применяет сам, нужно отдельно накатить миграцию (раздел 6) **до
или сразу после** `docker compose up -d --build`. Признак, что забыли:
в `docker compose logs api` ошибка вида `column "..." does not exist` или
`relation "..." does not exist` — сразу у всех каналов разом (виджет,
Telegram, Instagram), не только у того, что добавлял новую колонку/таблицу,
потому что код приложения ожидает полную схему во всех запросах к общим
таблицам (`conversations`, `messages`), а не только в тех местах, где
новое поле реально используется.
