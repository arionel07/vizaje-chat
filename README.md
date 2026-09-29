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
| `PORT` | нет | `3001` | Порт HTTP/WS сервера |

### Админка (`vizaje-chat-admin/.env`)

| Переменная | Обязательна | По умолчанию | Что делает |
|---|---|---|---|
| `VITE_API_URL` | нет | `http://localhost:3001` | Адрес API; адрес WebSocket строится из него. Подставляется при сборке |

## WebSocket-протокол

Подключение: `ws://host/ws?token=...` (токен посетителя или админа). Клиент → сервер:

| Сообщение | Кто | Что делает |
|---|---|---|
| `{ text, replyToId?, clientId? }` | посетитель | Сообщение в свою беседу; `replyToId` — ответ на сообщение (только из этой же беседы) |
| `{ conversationId, text, replyToId?, clientId? }` | админ | Сообщение в беседу, в том числе ответ на сообщение |
| `{ type: 'typing', conversationId? }` | оба | «Печатает» (не сохраняется, не чаще раза в секунду) |

Сервер → клиент — обычные сообщения (`{ id, conversationId, sender, text, createdAt, replyToId, replyTo }`, где `replyTo` — цитата `{ id, sender, text }` до 200 символов или `null`) и служебные события с полем `type`:

| `type` | Кому | Поля |
|---|---|---|
| `sent` | отправителю | `clientId`, `id`, `conversationId`, `createdAt` — подтверждение, серверные id и время |
| `error` | отправителю | `error`, `clientId` — сообщение отклонено (валидация, лимит) |
| `typing` | собеседнику | `from` (`visitor` / `admin`), `conversationId` |
| `read` | собеседнику и админам | `by` (`visitor` / `admin`), `conversationId`, `at` — «прочитано» |

«Прочитано» считается по серверному времени: оператор отмечает беседу прочитанной (`POST /admin/conversations/:id/read`), посетитель — когда виджет открыт (`POST /widget/read`); виджет читает состояние через `GET /widget/state`.

## Автотесты

Тесты API (`bun test`) поднимают приложение на случайном порту и работают с **отдельной** тестовой БД: перед каждым файлом они очищают таблицы, поэтому имя БД обязано содержать `test`, иначе тесты не запустятся.

```bash
cd vizaje-chat-api
docker exec vizaje-chat-db createdb -U postgres vizaje_chat_test     # один раз
export TEST_DATABASE_URL=postgres://postgres:dev@localhost:5433/vizaje_chat_test
DATABASE_URL=$TEST_DATABASE_URL bunx drizzle-kit push                # схема в тестовой БД
bun test
```

Покрыто: разделение токенов по `type`, rate-limit (вход, сессии, сообщения), REST и пагинация виджета, список бесед (сортировка, фильтры, счётчики, прочитанность), валидация WS-сообщений и `clientId` в ошибках, доставка сообщений и системных событий в реальном времени.

В CI (`.github/workflows/ci.yml`) на каждый pull request: typecheck и тесты API с Postgres, lint и сборка админки, проверка синтаксиса виджета.

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
