# vizaje-chat

Standalone support-chat сервис для vizaje-nica.com (Jivo/Intercom-style). Не связан с legacy-кодом сайта — подключается через `<script>` виджет.

## Стек

- **Runtime:** Bun
- **Framework:** Elysia
- **БД:** PostgreSQL + Drizzle ORM
- **Auth:** JWT (отдельно для admin-операторов и анонимных widget-сессий)
- **Realtime:** WebSocket (нативный, через Elysia `.ws()`)

## Структура

src/
auth/ — admin login, JWT создание/проверка
chat/ — сообщения, беседы, смена статуса
widget/ — анонимные widget-сессии
db/ — Drizzle schema + client
routes/ — HTTP/WS роуты, сгруппированные по домену
scripts/ — разовые скрипты (create-admin, test-realtime)
index.ts — сборка приложения


## Локальный запуск

```bash
bun install

# Postgres в докере
docker run --name vizaje-chat-db -e POSTGRES_PASSWORD=dev -p 5433:5432 -d postgres:16

# .env
DATABASE_URL=postgres://postgres:dev@localhost:5433/postgres
JWT_SECRET=любая-длинная-строка
# origins с CORS через запятую (по умолчанию localhost:5173 и localhost:8080)
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8080

# применить схему
bunx drizzle-kit push

# создать первого админа
bun run src/scripts/create-admin.ts admin@example.com пароль

# запуск
bun run src/index.ts
```

Сервер поднимется на `localhost:3001`.

## Виджет

```bash
cd vizaje-chat-widget
bun run dev --port 8080   # порт по умолчанию 8080
```

Тестовая страница откроется на `http://localhost:8080`. Адрес API задаётся атрибутом `data-api` на теге `<script>` в `index.html`. Origin страницы должен быть в `ALLOWED_ORIGINS` API.

## Тест realtime без фронта

```bash
bun run src/scripts/test-realtime.ts
```

Прогоняет полный цикл: создание widget-сессии → admin login → оба WS коннектятся → обмен сообщениями в обе стороны. Полезно после любых правок WS-логики — быстрее, чем тестировать руками через браузер.

## Связанные репозитории

- Веб-админка: [vizaje-chat-admin](https://github.com/arionel07/vizaje-chat-admin) (Vite + React)
- Мобильная админка: планируется (React Native)
