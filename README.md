# vizaje-chat

Standalone support-chat сервис для vizaje-nica.com (Jivo/Intercom-style). Не связан с legacy-кодом сайта — подключается через `<script>` виджет.

## Стек

- **Runtime:** Bun
- **Framework:** Elysia
- **БД:** PostgreSQL + Drizzle ORM
- **Auth:** JWT (отдельно для admin-операторов и анонимных widget-сессий)
- **Realtime:** WebSocket (нативный, через Elysia `.ws()`)

## Структура монорепо

```
vizaje-chat-api/      — API + WebSocket (Bun, Elysia, Drizzle)
  src/
    auth/             — admin login, JWT создание/проверка
    chat/             — сообщения, беседы, статус, rate-limit, публикация в WS
    widget/           — анонимные widget-сессии
    db/               — Drizzle schema + client
    routes/           — HTTP/WS роуты по доменам
    scripts/          — разовые скрипты (create-admin, test-realtime)
    config.ts         — переменные окружения
    index.ts          — сборка приложения
vizaje-chat-admin/    — веб-админка операторов (Vite + React)
vizaje-chat-widget/   — виджет для сайта (widget.js) и тестовая страница
```

## Локальный запуск

Нужны [Bun](https://bun.com) и Docker (для Postgres).

### 1. API (порт 3001)

```bash
cd vizaje-chat-api
bun install

# Postgres в докере
docker run --name vizaje-chat-db -e POSTGRES_PASSWORD=dev -p 5433:5432 -d postgres:16

# переменные окружения
cp .env.example .env    # затем впишите JWT_SECRET

# применить схему (таблицы и индексы)
bunx drizzle-kit push

# создать первого админа
bun run src/scripts/create-admin.ts admin@example.com пароль

# запуск
bun run src/index.ts
```

Проверка: `curl localhost:3001/health` возвращает `{"status":"ok"}`.

### 2. Админка (порт 5173)

```bash
cd vizaje-chat-admin
bun install
cp .env.example .env    # необязательно: по умолчанию API на http://localhost:3001
bun run dev
```

### 3. Виджет (порт 8080)

```bash
cd vizaje-chat-widget
bun run dev --port 8080    # порт по умолчанию 8080
```

Откройте `http://localhost:8080`. Адрес API задаётся атрибутом `data-api` на теге `<script>` в `index.html`. Для встраивания на сайт:

```html
<script src="https://your-cdn/widget.js" data-api="https://chat.example.com"></script>
```

Необязательные атрибуты тега `<script>`:

| Атрибут | По умолчанию | Что делает |
|---|---|---|
| `data-theme` | `auto` | `auto` — системная тема посетителя, либо `light` / `dark` |
| `data-title` | `Поддержка Vizaje-Nica` | Заголовок панели и превью |
| `data-agent` | `Поддержка` | Подпись сотрудника под сообщениями |

Возвращающийся посетитель подключается к чату в фоне, поэтому на кнопке появляется бейдж непрочитанных, а над ней превью нового сообщения. Новым посетителям сессия создаётся только когда они открывают чат.

## Переменные окружения

### API (`vizaje-chat-api/.env`, шаблон в `.env.example`)

| Переменная | Обязательна | По умолчанию | Что делает |
|---|---|---|---|
| `DATABASE_URL` | да | — | Строка подключения к PostgreSQL |
| `JWT_SECRET` | да | — | Секрет подписи JWT; без него сервер не стартует |
| `ALLOWED_ORIGINS` | нет | `http://localhost:5173,http://localhost:8080` | Origins для CORS через запятую. Добавьте сюда домен сайта с виджетом и домен админки |
| `TRUST_PROXY` | нет | `false` | `true`, если API за reverse proxy: IP клиента берётся из `X-Forwarded-For` (нужно для rate-limit) |

### Админка (`vizaje-chat-admin/.env`)

| Переменная | Обязательна | По умолчанию | Что делает |
|---|---|---|---|
| `VITE_API_URL` | нет | `http://localhost:3001` | Адрес API; адрес WebSocket строится из него. Подставляется при сборке |

## Тест realtime без фронта

```bash
cd vizaje-chat-api
bun run src/scripts/test-realtime.ts
```

Прогоняет полный цикл: создание widget-сессии → admin login → оба WS коннектятся → обмен сообщениями в обе стороны. Полезно после любых правок WS-логики — быстрее, чем тестировать руками через браузер. Скрипт логинится под админом, которого вы создали через `create-admin.ts`; учётные данные берёт из переменных окружения:

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=пароль bun run src/scripts/test-realtime.ts
```

## Планы

- Мобильная админка (React Native)
