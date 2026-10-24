# vizaje-chat-api

API и WebSocket-сервер support-чата (Bun + Elysia + Postgres/Drizzle).

Запуск, переменные окружения и структура монорепо описаны в [корневом README](../README.md). Шаблон переменных: [`.env.example`](.env.example).

```bash
bun install
cp .env.example .env
bunx drizzle-kit push
bun run src/index.ts
```
