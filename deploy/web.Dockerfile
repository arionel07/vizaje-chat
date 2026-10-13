# Собирает админку (Vite) и кладёт её вместе со статикой виджета в nginx-образ.
# Контекст сборки — корень репозитория (нужен доступ и к vizaje-chat-admin, и к vizaje-chat-widget).

FROM oven/bun:1-slim AS admin-build
WORKDIR /app
COPY vizaje-chat-admin/package.json vizaje-chat-admin/bun.lock ./
RUN bun install --frozen-lockfile
COPY vizaje-chat-admin/ ./
ARG VITE_API_URL
ARG VITE_DICTATION_LANG=ru-RU
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_DICTATION_LANG=${VITE_DICTATION_LANG}
RUN bun run build

FROM nginx:1.27-alpine
COPY --from=admin-build /app/dist /usr/share/nginx/html/admin
COPY vizaje-chat-widget/widget.js /usr/share/nginx/html/widget/widget.js
COPY vizaje-chat-widget/public /usr/share/nginx/html/widget/public
COPY deploy/nginx.conf /etc/nginx/nginx.conf
